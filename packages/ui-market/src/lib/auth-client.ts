'use client';

import { createAuthClient } from 'better-auth/react';
import { PLATFORM_API_URL } from './config.js';

/**
 * Better Auth client for the AICS marketplace.
 * We use `any` for the internal client to avoid exposing unresolvable
 * internal types from better-auth in declaration files.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _client: any = createAuthClient({
  baseURL: PLATFORM_API_URL,
});

/**
 * React hook returning current session state.
 * Returns { data, isPending, error }.
 */
export const useSession: () => {
  data: { user: { id: string; name: string; email: string; image: string | null } } | null;
  isPending: boolean;
  error: unknown;
} = _client.useSession;

/**
 * Sign-in methods.
 */
export const signIn: {
  email: (params: { email: string; password: string }) => Promise<{ error?: { message?: string } }>;
  social: (params: { provider: string; callbackURL?: string }) => Promise<void>;
} = _client.signIn;

/**
 * Sign-up methods.
 */
export const signUp: {
  email: (params: { email: string; password: string; name: string }) => Promise<{ error?: { message?: string } }>;
} = _client.signUp;

/**
 * Sign out the current user.
 */
export const signOut: () => Promise<void> = _client.signOut;
