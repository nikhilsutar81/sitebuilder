import 'dotenv/config';
import prisma from "./prisma.js";

const trustedOrigins = process.env.TRUSTED_ORIGINS?.split(',') || []

let _authInstance: any = null;

export async function getAuth() {
  if (_authInstance) return _authInstance;
  // Dynamically import better-auth and its prisma adapter to avoid ESM/require
  const { betterAuth } = await import('better-auth');
  const { prismaAdapter } = await import('better-auth/adapters/prisma');

  _authInstance = betterAuth({
    database: prismaAdapter(prisma, {
      provider: "postgresql",
    }),
    emailAndPassword: { 
      enabled: true, 
    },
    user: {
      deleteUser: {enabled: true}
    },
    trustedOrigins,
    baseURL: process.env.BETTER_AUTH_URL!,
    secret: process.env.BETTER_AUTH_SECRET!,
    advanced: {
      cookies: {
        session_token: {
          name: 'auth_session',
          attributes: {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ?'none':'lax',
            path: '/',
          }
        }
      }
    }
  });

  return _authInstance;
}