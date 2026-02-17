import { Request, Response } from "express"
import prisma from "../lib/prisma.js";
import openai from "../configs/openai.js";
import Stripe from 'stripe'

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
        console.log('Project created:', project.id);

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

        // Return projectId immediately
        console.log('Sending response with projectId:', project.id);
        res.json({ projectId: project.id })
        console.log('Response sent successfully');

        // Start generation in background without blocking response
        generateProjectCode(project.id, userId, initial_prompt).catch((err) => {
            console.error('Background generation error:', err);
        });

    } catch (error: any) {
        console.error('Error creating project:', error);
        if (userId) {
            await prisma.user.update({
                where: { id: userId },
                data: { credits: { increment: 5 } }
            }).catch((err: any) => console.error('Error refunding credits:', err))
        }
        if (!res.headersSent) {
            res.status(500).json({ message: error.message || 'Error creating project' });
        }
    }
}

// Background function to generate project code without blocking response
async function generateProjectCode(projectId: string, userId: string, initial_prompt: string) {
    try {
        console.log('Starting prompt enhancement for project:', projectId);

        //Enhance user prompt
        const promptEnhanceResponse = await openai.chat.completions.create({
            model: 'kwaipilot/kat-coder-pro',
            max_tokens: 1000,
            messages: [
                {
                    role: 'system',
                    content: `You are a helpful assistant. Create a brief, friendly summary (2-3 sentences) of what website will be built based on the user's request. Focus on what the website will look like and do, not on technical details or code. Keep it simple and user-friendly.`
                },
                {
                    role: 'user',
                    content: initial_prompt
                }
            ]
        })
        console.log('Prompt enhanced');

        const enhancedPrompt = promptEnhanceResponse.choices[0].message.content;

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: `Got it! I'll create: ${enhancedPrompt}`,
                projectId: projectId
            }
        })
        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: 'Now generating your website...',
                projectId: projectId
            }
        })
        console.log('Starting code generation for project:', projectId);

        //generate website code with timeout protection
        let codeGenerationResponse: any;
        try {
            codeGenerationResponse = await Promise.race([
                openai.chat.completions.create({
                    model: 'kwaipilot/kat-coder-pro',
                    max_tokens: 12000,
                    messages: [
                        {
                            role: 'system',
                            content: `You are an expert web developer. Create a COMPLETE, PRODUCTION-READY HTML website with Tailwind CSS. 

CRITICAL REQUIREMENTS:
1. Generate the ENTIRE website - do NOT skip any sections mentioned in the requirements
2. Every section must be fully styled and polished with proper spacing, colors, and typography
3. Include proper navigation that works responsively
4. Add hero section, all content sections, and footer - DO NOT skip any
5. Use Tailwind CSS extensively for professional styling
6. Make sure all sections are complete with proper content and styling
7. Include <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
8. Output ONLY HTML code - no markdown, no explanations, no additional text

Remember: Generate the COMPLETE website. Every section mentioned MUST be included in full.`
                        },
                        {
                            role: 'user',
                            content: `Create a complete website that includes: ${enhancedPrompt}`
                        }
                    ]
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Code generation timeout after 300 seconds')), 300000)
                )
            ]);
        } catch (timeoutError: any) {
            console.error('Code generation error:', timeoutError.message);
            await prisma.conversation.create({
                data: {
                    role: 'assistant',
                    content: "Code generation took too long. Please try again with a simpler request.",
                    projectId: projectId
                }
            })
            await prisma.user.update({
                where: { id: userId },
                data: { credits: { increment: 5 } }
            })
            console.log('Generation failed for project:', projectId);
            return;
        }
        
        console.log('Code generation response received');

        const code = codeGenerationResponse.choices[0].message.content || '';
        console.log('Code extracted, length:', code.length);
        
        if (!code || code.trim().length === 0) {
            console.error('No code returned from API');
            await prisma.conversation.create({
                data: {
                    role: 'assistant',
                    content: "Unable to generate the code, Please try again",
                    projectId: projectId
                }
            })
            await prisma.user.update({
                where: { id: userId },
                data: { credits: { increment: 5 } }
            })
            return;
        }
        
        console.log('Code validation passed');

        const cleanedCode = code.replace(/```[a-z]*\n?/gi, '')
                    .replace(/```$/g, '')
                    .trim();

        //create version for the project
        const version = await prisma.version.create({
            data: {
                code: cleanedCode,
                description: 'Initial version',
                projectId: projectId
            }
        }).catch((err: any) => {
            console.error('Error creating version:', err);
            throw err;
        })
        console.log('Version created:', version.id);

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: "I've created your website! You can now preview it and request any changes.",
                projectId: projectId
            }
        }).catch((err: any) => {
            console.error('Error creating conversation:', err);
            throw err;
        })

        await prisma.websiteProject.update({
            where: { id: projectId },
            data: {
                current_code: cleanedCode,
                current_version_index: version.id
            }
        }).catch((err: any) => {
            console.error('Error updating project:', err);
            throw err;
        })
        console.log('Project updated with code:', projectId);

    } catch (error: any) {
        console.error('Background generation error for project', projectId, ':', error);
        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: "Sorry, something went wrong during code generation. Please try again.",
                projectId: projectId
            }
        }).catch((err: any) => console.error('Error creating error message:', err));
        
        await prisma.user.update({
            where: { id: userId },
            data: { credits: { increment: 5 } }
        }).catch((err: any) => console.error('Error refunding credits:', err));
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
        const { planId } = req.body as { planId: keyof typeof plans }
        const origin = req.headers.origin as string;

        const plan: Plan = plans[planId]

        if (!plan) {
            return res.status(404).json({ message: 'Plan not found' });
        }

        const transaction = await prisma.transaction.create({
            data: {
                userId: userId!,
                planId: req.body.planId,
                amount: plan.amount,
                credits: plan.credits
            }
        })

        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

        const session = await stripe.checkout.sessions.create({
            success_url: `${origin}/loading`,
            cancel_url: `${origin}`,
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `AiSiteBuilder - ${plan.credits} credits`
                        },
                        unit_amount: Math.floor(transaction.amount) * 100
                    },
                    quantity: 1
                },
            ],
            mode: 'payment',
            metadata: {
                transactionId: transaction.id,
                appId: 'ai-site-builder'
            },
            expires_at: Math.floor(Date.now() / 1000) + 30 * 60, //Expires in 30 minutes
        });

        res.json({payment_link: session.url})

    } catch (error : any) {
        console.log(error.code || error.message);
        res.status(500).json({message: error.message});
    }
}

