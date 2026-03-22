import type { LlmProvider } from '@aics/shared-types';

export interface ProviderConfig {
  provider: LlmProvider;
  apiKey: string;
  baseURL?: string;
  model: string;
  defaultHeaders?: Record<string, string>;
  /** ACP server command for subscription mode (default: 'claude'). */
  acpCommand?: string;
  /** Extra arguments for the ACP server command. */
  acpArgs?: string[];
}

const STORAGE_KEY = 'aics-provider-config';

export function loadProviderConfig(): ProviderConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Runtime validation — reject stale or corrupt config
    // Subscription mode may have empty apiKey/model
    if (
      !parsed ||
      typeof parsed.provider !== 'string' ||
      (parsed.provider !== 'subscription' && typeof parsed.apiKey !== 'string') ||
      (parsed.provider !== 'subscription' && typeof parsed.model !== 'string')
    ) {
      return null;
    }
    return parsed as ProviderConfig;
  } catch {
    return null;
  }
}

export function saveProviderConfig(config: ProviderConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearProviderConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}
