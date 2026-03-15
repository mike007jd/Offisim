'use client';

import { useCallback } from 'react';
import { useSession, signIn, signUp, signOut } from '../lib/auth-client.js';
import { PLATFORM_API_URL } from '../lib/config.js';

export interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
  image?: string | null;
}

export interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
}

export interface UseAuthResult extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  loginWithGithub: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => void;
  registerCreator: (handle: string, displayName: string, bio?: string) => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const session = useSession();
  const isPending = session.isPending;
  const sessionData = session.data;

  const user: AuthUser | null = sessionData?.user
    ? {
        userId: sessionData.user.id,
        email: sessionData.user.email,
        displayName: sessionData.user.name,
        image: sessionData.user.image,
      }
    : null;

  const login = useCallback(async (email: string, password: string) => {
    const result = await signIn.email({ email, password });
    if (result.error) {
      throw new Error(result.error.message ?? 'Login failed');
    }
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const result = await signUp.email({ email, password, name });
    if (result.error) {
      throw new Error(result.error.message ?? 'Registration failed');
    }
  }, []);

  const loginWithGithub = useCallback(async () => {
    await signIn.social({
      provider: 'github',
      callbackURL: window.location.origin + '/dashboard',
    });
  }, []);

  const loginWithGoogle = useCallback(async () => {
    await signIn.social({
      provider: 'google',
      callbackURL: window.location.origin + '/dashboard',
    });
  }, []);

  const doLogout = useCallback(() => {
    signOut().catch(() => {});
  }, []);

  const registerCreator = useCallback(
    async (handle: string, displayName: string, bio?: string) => {
      if (!user) throw new Error('Not authenticated');

      const res = await fetch(`${PLATFORM_API_URL}/v1/auth/register-creator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ handle, display_name: displayName, bio }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Registration failed' }));
        throw new Error((err as { message?: string }).message ?? 'Registration failed');
      }
    },
    [user],
  );

  return {
    user,
    isLoading: isPending,
    login,
    register,
    loginWithGithub,
    loginWithGoogle,
    logout: doLogout,
    registerCreator,
  };
}
