import { secretDecrypt, secretEncrypt } from '@/lib/local-secret.js';
import { RegistryClient } from '@offisim/registry-client';

const MARKETPLACE_BASE_URL_STORAGE_KEY = 'offisim.marketplace.baseUrl';
const MARKETPLACE_TOKEN_STORAGE_KEY = 'offisim.marketplace.apiToken';

export interface RegistryConfig {
  baseUrl: string;
  authToken?: string;
}

function trimEnv(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\/$/u, '') : null;
}

function storedMarketplaceBaseUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return trimEnv(window.localStorage.getItem(MARKETPLACE_BASE_URL_STORAGE_KEY));
  } catch {
    return null;
  }
}

function buildRegistryBaseUrl(): string | null {
  return (
    trimEnv(import.meta.env.VITE_OFFISIM_REGISTRY_BASE_URL) ??
    trimEnv(import.meta.env.VITE_OFFISIM_PLATFORM_BASE_URL)
  );
}

function configuredRegistryBaseUrl(): string | null {
  return storedMarketplaceBaseUrl() ?? buildRegistryBaseUrl();
}

export interface MarketplaceConnectionSettings {
  baseUrl: string;
  source: 'custom' | 'build' | 'none';
  tokenConfigured: boolean;
}

export function marketplaceConnectionSettings(): MarketplaceConnectionSettings {
  const stored = storedMarketplaceBaseUrl();
  const build = buildRegistryBaseUrl();
  return {
    baseUrl: stored ?? build ?? '',
    source: stored ? 'custom' : build ? 'build' : 'none',
    tokenConfigured: marketplaceTokenConfigured(),
  };
}

export function writeMarketplaceBaseUrl(baseUrl: string | null): void {
  if (typeof window === 'undefined') return;
  const normalized = trimEnv(baseUrl);
  if (normalized) window.localStorage.setItem(MARKETPLACE_BASE_URL_STORAGE_KEY, normalized);
  else window.localStorage.removeItem(MARKETPLACE_BASE_URL_STORAGE_KEY);
}

/** Raw localStorage value (still sealed). Empty/absent → undefined. */
function rawStoredMarketplaceToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem(MARKETPLACE_TOKEN_STORAGE_KEY)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The usable (decrypted) marketplace token. The value is stored sealed at rest
 * (S1/S2) via `secret_encrypt`; invalid or unsealed values fail closed. Async
 * because it crosses the Tauri command boundary.
 */
async function storedMarketplaceToken(): Promise<string | undefined> {
  const raw = rawStoredMarketplaceToken();
  if (raw === undefined) return undefined;
  const plaintext = (await secretDecrypt(raw)).trim();
  return plaintext || undefined;
}

/**
 * Presence check only — does NOT need to decrypt. Whether the stored value is a
 * sealed envelope, its existence means a token is set. Stays
 * synchronous so render-path callers don't have to await.
 */
function marketplaceTokenConfigured(): boolean {
  return rawStoredMarketplaceToken() !== undefined;
}

export async function writeMarketplaceToken(token: string | null): Promise<void> {
  if (typeof window === 'undefined') return;
  const trimmed = token?.trim() ?? '';
  if (trimmed) {
    // Seal before it ever touches localStorage (S1/S2).
    const sealed = await secretEncrypt(trimmed);
    window.localStorage.setItem(MARKETPLACE_TOKEN_STORAGE_KEY, sealed);
  } else {
    window.localStorage.removeItem(MARKETPLACE_TOKEN_STORAGE_KEY);
  }
}

export async function registryConfig(): Promise<RegistryConfig | null> {
  const baseUrl = configuredRegistryBaseUrl();
  if (!baseUrl) return null;
  return { baseUrl, authToken: await storedMarketplaceToken() };
}

export function registryClient(config: RegistryConfig): RegistryClient {
  return new RegistryClient({
    baseUrl: config.baseUrl,
    authToken: config.authToken,
    credentials: 'omit',
  });
}
