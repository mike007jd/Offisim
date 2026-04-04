import { RegistryClient } from '@offisim/registry-client';
import { useMemo } from 'react';

export const REGISTRY_AUTH_TOKEN_STORAGE_KEY = 'offisim.registry.auth-token';
export const REGISTRY_BASE_URL_STORAGE_KEY = 'offisim.registry.base-url';

export function getRegistryBaseUrl(): string {
  try {
    const saved = localStorage.getItem(REGISTRY_BASE_URL_STORAGE_KEY)?.trim();
    if (saved) return saved.replace(/\/$/, '');
  } catch {}
  return (import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:4100').replace(/\/$/, '');
}

export function loadRegistryAuthToken(): string | null {
  try {
    const token = localStorage.getItem(REGISTRY_AUTH_TOKEN_STORAGE_KEY)?.trim();
    return token ? token : null;
  } catch {
    return null;
  }
}

export function saveRegistryAuthToken(token: string | null): void {
  try {
    if (token?.trim()) {
      localStorage.setItem(REGISTRY_AUTH_TOKEN_STORAGE_KEY, token.trim());
      return;
    }
    localStorage.removeItem(REGISTRY_AUTH_TOKEN_STORAGE_KEY);
  } catch {}
}

export function useRegistryClient(authToken?: string | null): RegistryClient {
  const resolvedToken = authToken === undefined ? loadRegistryAuthToken() : authToken;

  return useMemo(
    () =>
      new RegistryClient({
        baseUrl: getRegistryBaseUrl(),
        credentials: 'include',
        ...(resolvedToken ? { authToken: resolvedToken } : {}),
      }),
    [resolvedToken],
  );
}
