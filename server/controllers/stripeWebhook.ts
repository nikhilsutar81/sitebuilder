import { Request, Response } from 'express';

// Stripe webhook removed — keep a stub for any still-registered routes
export const stripeWebhook = async (_request: Request, response: Response) => {
    response.status(410).json({ message: 'Payment webhooks removed' });
}