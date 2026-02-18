import express, { Request, Response } from 'express';
import 'dotenv/config';
import cors from 'cors';
// Note: `better-auth` initialization can throw if required env vars
// are missing in serverless environments. We import it lazily
// inside the auth route to avoid crashing the whole function at startup.
import userRouter from './routes/userRoutes.js';
import projectRouter from './routes/projectRoutes.js';
import { stripeWebhook } from './controllers/stripeWebhook.js';

const app = express();

const corsOptions = {
    origin: process.env.TRUSTED_ORIGINS?.split(',') || [],
    credentials: true,
}

app.use(cors(corsOptions))
app.post('/api/stripe', express.raw({type: 'application/json'}), stripeWebhook)

// Cache the auth handler so we don't re-import on every request
let _cachedAuthHandler: any = null;
app.use('/api/auth', async (req, res, next) => {
    try {
        if (!_cachedAuthHandler) {
            const mod = await import('better-auth/node');
            const authMod = await import('./lib/auth.js');
            _cachedAuthHandler = mod.toNodeHandler(authMod.auth);
        }

        // Call the handler and wait for it to finish or fail via the next callback
        await new Promise<void>((resolve, reject) => {
            try {
                _cachedAuthHandler(req as any, res as any, (err: any) => {
                    if (err) return reject(err);
                    resolve();
                });
            } catch (err) {
                reject(err);
            }
        });
    } catch (err) {
        console.error('Auth route initialization failed:', (err as any)?.message || err);
        // If response headers already sent, delegate to next to avoid double-send
        if (res.headersSent) return next?.(err);
        res.status(500).json({ message: 'Auth not available' });
    }
});

app.use(express.json({limit: '50mb'}))


app.get('/', (req: Request, res: Response) => {
    res.send('Server is Live!');
});

app.use('/api/user', userRouter);
app.use('/api/project', projectRouter);

// Export app for Vercel serverless
export default app;

// For local development
if (process.env.NODE_ENV === 'development' || !process.env.VERCEL) {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
    app.listen(port, () => {
        console.log(`Server is running at http://localhost:${port}`);
    });
}