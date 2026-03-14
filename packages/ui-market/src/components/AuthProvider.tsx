'use client';

import { createContext, useContext } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import type { UseAuthResult } from '../hooks/useAuth.js';

const AuthContext = createContext<UseAuthResult | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

/**
 * Consume the AuthContext. Must be used inside an AuthProvider.
 */
export function useAuthContext(): UseAuthResult {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used inside <AuthProvider>');
  }
  return ctx;
}
