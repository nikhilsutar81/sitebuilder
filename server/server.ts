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

// Simple request logger to diagnose unexpected 500s in serverless
app.use((req, res, next) => {
    console.log(`Incoming request: ${req.method} ${req.url}`);
    next();
});

// Log unhandled errors to help diagnose serverless crashes
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests from same origin (no origin header means same-origin request)
        if (!origin) {
            return callback(null, true);
        }
        
        // Allow trusted origins from env
        const trustedOrigins = process.env.TRUSTED_ORIGINS?.split(',').map(o => o.trim()) || [];
        
        if (trustedOrigins.includes(origin)) {
            return callback(null, true);
        }
        
        // In development, be more permissive
        if (process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }
        
        // Block in production if not in trusted list
        callback(new Error('CORS not allowed'));
    },
    credentials: true,
}

app.use(cors(corsOptions))
app.post('/api/stripe', express.raw({type: 'application/json'}), stripeWebhook)

// Serve a no-content favicon to avoid extra function invocations for missing asset
app.get('/favicon.ico', (req: Request, res: Response) => {
    res.status(204).end();
});

// Cache the auth handler so we don't re-import on every request
let _cachedAuthHandler: any = null;
app.use('/api/auth', async (req, res, next) => {
    try {
        if (!_cachedAuthHandler) {
            const mod = await import('better-auth/node');
            const { getAuth } = await import('./lib/auth.js');
            const auth = await getAuth();
            _cachedAuthHandler = mod.toNodeHandler(auth);
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

// Global error handler to prevent crashes and log stack traces
app.use((err: any, req: Request, res: Response, next: any) => {
    console.error('Express error handler caught:', err?.stack || err);
    if (res.headersSent) return next(err);
    res.status(500).json({ message: 'Internal Server Error' });
});

// Export app for Vercel serverless
export default app;

// For local development
if (process.env.NODE_ENV === 'development' || !process.env.VERCEL) {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
    app.listen(port, () => {
        console.log(`Server is running at http://localhost:${port}`);
    });
}