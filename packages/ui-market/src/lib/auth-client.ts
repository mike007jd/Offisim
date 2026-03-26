'use client';

import { createAuthClient } from 'better-auth/react';
import { PLATFORM_API_URL } from './config.js';

const authClient: ReturnType<typeof createAuthClient> = createAuthClient({
  baseURL: PLATFORM_API_URL,
});

type AuthClient = typeof authClient;

export const useSession: AuthClient['useSession'] = authClient.useSession;
export const signIn: AuthClient['signIn'] = authClient.signIn;
export const signUp: AuthClient['signUp'] = authClient.signUp;
export const signOut: AuthClient['signOut'] = authClient.signOut;
