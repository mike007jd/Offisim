'use client';

import { useCallback, useEffect, useState } from 'react';
import { PLATFORM_API_URL } from '../lib/config.js';

const PLATFORM_URL = PLATFORM_API_URL;
const STORAGE_KEY = 'aics-auth-token';

export interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
}

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
}

export interface UseAuthResult extends AuthState {
  login: (email: string, displayName: string) => Promise<void>;
  logout: () => void;
  registerCreator: (handle: string, displayName: string, bio?: string) => Promise<void>;
}

function decodeTokenPayload(token: string): AuthUser | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1] ?? ''));
    if (!payload.sub || !payload.email || !payload.display_name) return null;
    return {
      userId: payload.sub as string,
      email: payload.email as string,
      displayName: payload.display_name as string,
    };
  } catch {
    return null;
  }
}

export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount, hydrate from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const decoded = decodeTokenPayload(stored);
        if (decoded) {
          setToken(stored);
          setUser(decoded);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      // localStorage unavailable (SSR or restricted context) — ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, displayName: string) => {
    const res = await fetch(`${PLATFORM_URL}/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, display_name: displayName }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Login failed' }));
      throw new Error((err as { message?: string }).message ?? 'Login failed');
    }

    const data = (await res.json()) as { token: string };
    const newToken = data.token;
    const decoded = decodeTokenPayload(newToken);
    if (!decoded) throw new Error('Invalid token received from server');

    try {
      localStorage.setItem(STORAGE_KEY, newToken);
    } catch {
      // Ignore storage errors
    }
    setToken(newToken);
    setUser(decoded);
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
    setToken(null);
    setUser(null);
  }, []);

  const registerCreator = useCallback(
    async (handle: string, displayName: string, bio?: string) => {
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${PLATFORM_URL}/v1/auth/register-creator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ handle, display_name: displayName, bio }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Registration failed' }));
        throw new Error((err as { message?: string }).message ?? 'Registration failed');
      }
    },
    [token],
  );

  return { user, token, isLoading, login, logout, registerCreator };
}
