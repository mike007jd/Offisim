import type { LlmProvider } from '@aics/shared-types';

export interface ProviderConfig {
  provider: LlmProvider;
  apiKey: string;
  baseURL?: string;
  model: string;
  defaultHeaders?: Record<string, string>;
}

const STORAGE_KEY = 'aics-provider-config';

export function loadProviderConfig(): ProviderConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ProviderConfig;
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
