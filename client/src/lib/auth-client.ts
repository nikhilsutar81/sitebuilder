import { createAuthClient } from "better-auth/react"

// For same-domain deployments, use relative URL
// For separate domain deployments, use the env var
const baseURL = import.meta.env.VITE_BASEURL || './';

if (typeof window !== 'undefined') {
    console.log('[Auth Client] Base URL:', baseURL);
    if (import.meta.env.MODE === 'production' && !import.meta.env.VITE_BASEURL) {
        console.log('[Auth Client] Using relative URL for same-domain setup');
    }
}

export const authClient = createAuthClient({
    baseURL,
    fetchOptions: {credentials: 'include'},
})

export const { signIn, signUp, useSession } = authClient;