import { Request, Response } from "express"
import prisma from "../lib/prisma.js";
import openai from "../configs/openai.js";
// Stripe removed — payments handled internally (no external provider)

//get User credits

export const getUserCredits = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId }
        })

        res.json({ credits: user?.credits })
    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

//controller function to create new project

export const createUserProject = async (req: Request, res: Response) => {
    const userId = req.userId;
    try {
        const { initial_prompt } = req.body;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId }
        })

        if (user && user.credits < 5) {
            return res.status(403).json({ message: 'add credits to create more projects' });
        }
        //create a new project
        const project = await prisma.websiteProject.create({
            data: {
                name: initial_prompt.length > 50 ? initial_prompt.substring(0, 47) + '...' : initial_prompt,
                initial_prompt,
                userId
            }
        })

        //update user's total  creation
        await prisma.user.update({
            where: { id: userId },
            data: { totalCreation: { increment: 1 } }
        })

        await prisma.conversation.create({
            data: {
                role: 'user',
                content: initial_prompt,
                projectId: project.id
            }
        })

        await prisma.user.update({
            where: { id: userId },
            data: { credits: { decrement: 5 } }
        })

        // respond immediately with project id, then run generation in background
        res.json({ projectId: project.id })

        ;(async () => {
            try {
                const modelName = process.env.AI_MODEL || 'z-ai/glm-4.5-air:free'

                // Enhance user prompt (with fallback to user's original prompt on failure)
                let enhancedPrompt = initial_prompt
                try {
                    const promptEnhanceResponse = await openai.chat.completions.create({
                        model: modelName,
                        messages: [
                            {
                                role: 'system',
                                content: `
                    You are a prompt enhancement specialist. Take the user's website request and expand it into a detailed, comprehensive prompt that will help create the best possible website.
                    
                    Enhance this prompt by:
                    1. Adding specific design details (layout, color scheme, typography)
                    2. Specifying key sections and features
                    3. Describing the user experience and interactions
                    4. Including modern web design best practices
                    5. Mentioning responsive design requirements
                    6. Adding any missing but important elements
                    
                    Return ONLY the enhanced prompt, nothing else. Make it detailed but concise (2-3 paragraphs max).
                    `
                            },
                            {
                                role: 'user',
                                content: initial_prompt
                            }
                        ]
                    })

                    enhancedPrompt = promptEnhanceResponse.choices?.[0]?.message?.content || initial_prompt

                    await prisma.conversation.create({
                        data: {
                            role: 'assistant',
                            content: `I've enhanced  your prompt to: "${enhancedPrompt}"`,
                            projectId: project.id
                        }
                    })
                } catch (enhanceErr: any) {
                    console.error('Prompt enhancement failed, using original prompt:', enhanceErr?.message || enhanceErr)
                    await prisma.conversation.create({
                        data: {
                            role: 'assistant',
                            content: `Prompt enhancement failed; proceeding with original prompt. Error: ${enhanceErr?.message || 'unknown'}`,
                            projectId: project.id
                        }
                    })
                    // enhancedPrompt remains as initial_prompt
                }
                await prisma.conversation.create({
                    data: {
                        role: 'assistant',
                        content: 'now generating your website...',
                        projectId: project.id
                    }
                })

                // generate website code with model fallbacks and retries
                // Use the configured AI_MODEL (defaulting to z-ai/glm-4.5-air:free) and any explicit fallback.
                const modelsToTry = Array.from(new Set([modelName, process.env.AI_FALLBACK_MODEL].filter(Boolean)))
                let code = ''
                let lastError: any = null

                for (const m of modelsToTry) {
                    if (!m) continue
                    try {
                        console.log(`Attempting code generation with model: ${m}`)
                        const codeGenerationResponse = await openai.chat.completions.create({
                            model: m,
                            messages: [
                                {
                                    role: 'system',
                                    content: `
                    You are an expert web developer. Create a complete, production-ready, single-page website based on this request: "${enhancedPrompt}"
                    CRITICAL REQUIREMENTS:
                    - You MUST output valid HTML ONLY. 
                    - Use Tailwind CSS for ALL styling
                    - Include this EXACT script in the <head>: <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
                    - Use Tailwind utility classes extensively for styling, animations, and responsiveness
                    - Make it fully functional and interactive with JavaScript in <script> tag before closing </body>
                    - Use modern, beautiful design with great UX using Tailwind classes
                    - Make it responsive using Tailwind responsive classes (sm:, md:, lg:, xl:)
                    - Use Tailwind animations and transitions (animate-*, transition-*) 
                    - Include all necessary meta tags
                    - Use Google Fonts CDN if needed for custom fonts
                    - Use placeholder images from https://placehold.co/600x400
                    - Use Tailwind gradient classes for beautiful backgrounds
                    - Make sure all buttons, cards, and components use Tailwind styling
                    
                    CRITICAL HARD RULES:
                    1. You MUST put ALL output ONLY into message.content.
                    2. You MUST NOT place anything in "reasoning", "analysis", "reasoning_details", or any hidden fields.
                    3. You MUST NOT include internal thoughts, explanations, analysis, comments, or markdown.
                    4. Do NOT include markdown, explanations, notes, or code fences.
                    
                    The HTML should be complete and ready to render as-is with Tailwind CSS.`
                                },
                                {
                                    role: 'user',
                                    content: enhancedPrompt || 'codeGenerationResponse'
                                }
                            ]
                        })

                        code = codeGenerationResponse?.choices?.[0]?.message?.content || ''
                        if (code && code.trim().length > 0) {
                            console.log(`Code generation succeeded with model: ${m}`)
                            break
                        }
                        lastError = new Error('Empty code returned')
                    } catch (genErr: any) {
                        console.error(`Generation failed with model ${m}:`, genErr?.message || genErr)
                        lastError = genErr
                        // try next model
                    }
                }

                if (!code) {
                    await prisma.conversation.create({
                        data: {
                            role: 'assistant',
                            content: `Unable to generate the code. ${lastError?.message || ''}`,
                            projectId: project.id
                        }
                    })
                    await prisma.user.update({
                        where: { id: userId },
                        data: { credits: { increment: 5 } }
                    })
                    return;
                }

                // create version for the project
                const version = await prisma.version.create({
                    data: {
                        code: code.replace(/```[a-z]*\n?/gi, '')
                            .replace(/```$/g, '')
                            .trim(),
                        description: 'Initial version',
                        projectId: project.id
                    }
                })

                await prisma.conversation.create({
                    data: {
                        role: 'assistant',
                        content: "I've created your website! You can now preview it and request any changes.",
                        projectId: project.id
                    }
                })

                await prisma.websiteProject.update({
                    where: { id: project.id },
                    data: {
                        current_code: code.replace(/```[a-z]*\n?/gi, '')
                            .replace(/```$/g, '')
                            .trim(),
                        current_version_index: version.id
                    }
                })

            } catch (bgError: any) {
                console.error('Background generation error:', bgError?.message || bgError)
                // Refund credits on failure
                try {
                    await prisma.user.update({
                        where: { id: userId },
                        data: { credits: { increment: 5 } }
                    })
                    await prisma.conversation.create({
                        data: {
                            role: 'assistant',
                            content: `Generation failed: ${bgError?.message || 'unknown error'}`,
                            projectId: project.id
                        }
                    })
                } catch (dbErr) {
                    console.error('Error handling generation failure:', dbErr)
                }
            }
        })()

    } catch (error: any) {
        await prisma.user.update({
            where: { id: userId },
            data: { credits: { increment: 5 } }
        })
        console.log(error);
        res.status(500).json({ message: error.message });
    }
}

//controller function to get a single user project
export const getUserProject = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const { projectId } = req.params;

        const project = await prisma.websiteProject.findUnique({
            where: { id: projectId, userId },
            include: {
                conversation: {
                    orderBy: { timestamp: 'asc' }
                },
                versions: { orderBy: { timestamp: 'asc' } }
            }
        })

        res.json({ project })
    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

//controller funtion  to get all users projects
export const getUserProjects = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const projects = await prisma.websiteProject.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' }
        })

        res.json({ projects })
    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

//contoller funnction to toggle project publish
export const togglePublish = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const { projectId } = req.params;

        const project = await prisma.websiteProject.findUnique({
            where: { id: projectId, userId }
        })

        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        await prisma.websiteProject.update({
            where: { id: projectId },
            data: { isPublished: !project.isPublished }
        })

        res.json({ message: project.isPublished ? 'Project Unpublished' : 'Project Published Successfully' })

    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// For test payments, accept any non-empty card number
const validateCardNumber = (cardNumber: string): boolean => {
    const cleaned = cardNumber.replace(/\s+/g, '');
    return cleaned.length > 0;
};

// Validate expiry date
const validateExpiryDate = (expiryDate: string): boolean => {
    const [month, year] = expiryDate.split('/');
    if (!month || !year || month.length !== 2 || year.length !== 2) return false;

    const monthNum = parseInt(month);
    const yearNum = parseInt('20' + year);
    const currentDate = new Date();
    const expiry = new Date(yearNum, monthNum - 1);

    return monthNum >= 1 && monthNum <= 12 && expiry >= currentDate;
};

// Validate CVV
const validateCVV = (cvv: string): boolean => {
    return /^\d{3,4}$/.test(cvv);
};

//controller function to purchase credits
export const purchaseCredits = async (req: Request, res: Response) => {
    try {
        interface Plan {
            credits: number;
            amount: number;
        }

        const plans = {
            basic: { credits: 100, amount: 5 },
            pro: { credits: 400, amount: 19 },
            enterprise: { credits: 1000, amount: 49 },
        }

        const userId = req.userId;
        const { planId, cardDetails } = req.body as { 
            planId: keyof typeof plans;
            cardDetails?: {
                cardNumber: string;
                expiryDate: string;
                cvv: string;
                cardholderName: string;
            }
        }

        const plan: Plan = plans[planId]

        if (!plan) {
            return res.status(404).json({ message: 'Plan not found' });
        }

        // Validate card details if provided
        if (cardDetails) {
            if (!validateCardNumber(cardDetails.cardNumber)) {
                return res.status(400).json({ message: 'Invalid card number' });
            }

            if (!validateExpiryDate(cardDetails.expiryDate)) {
                return res.status(400).json({ message: 'Invalid or expired card' });
            }

            if (!validateCVV(cardDetails.cvv)) {
                return res.status(400).json({ message: 'Invalid CVV' });
            }

            if (!cardDetails.cardholderName || cardDetails.cardholderName.trim().length < 2) {
                return res.status(400).json({ message: 'Invalid cardholder name' });
            }

            // Simulate payment processing delay
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Simulate payment success (in real scenario, this would call payment gateway)
            // For testing, we accept any valid card format
            console.log(`Processing payment for plan ${planId}: $${plan.amount}`);
            console.log(`Card ending in: ${cardDetails.cardNumber.slice(-4)}`);
        }

        // Create transaction and mark as paid
        const transaction = await prisma.transaction.create({
            data: {
                userId: userId!,
                planId: req.body.planId,
                amount: plan.amount,
                credits: plan.credits,
                isPaid: true
            }
        })

        // Add credits to user
        await prisma.user.update({
            where: { id: userId! },
            data: { credits: { increment: plan.credits } }
        })

        res.json({ success: true, transactionId: transaction.id, credits: plan.credits })

    } catch (error : any) {
        console.log(error.code || error.message);
        res.status(500).json({message: error.message});
    }
}

