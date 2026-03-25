import type { LlmProvider } from '@aics/shared-types';
import { isTauri } from './env';

export interface ProviderConfig {
  provider: LlmProvider;
  apiKey?: string;
  baseURL?: string;
  model: string;
  defaultHeaders?: Record<string, string>;
  /** ACP server command for subscription mode (default: 'claude'). */
  acpCommand?: string;
  /** Extra arguments for the ACP server command. */
  acpArgs?: string[];
}

const STORAGE_KEY = 'aics-provider-config';

function validateProviderConfig(parsed: unknown): ProviderConfig | null {
  if (!parsed || typeof parsed !== 'object') return null;

  const candidate = parsed as Record<string, unknown>;
  const provider = candidate.provider;
  const model = candidate.model;
  const apiKey = candidate.apiKey;

  if (typeof provider !== 'string' || typeof model !== 'string') {
    return null;
  }

  if (provider !== 'subscription' && apiKey !== undefined && typeof apiKey !== 'string') {
    return null;
  }

  return {
    provider: provider as LlmProvider,
    model,
    ...(typeof apiKey === 'string' ? { apiKey } : {}),
    ...(typeof candidate.baseURL === 'string' ? { baseURL: candidate.baseURL } : {}),
    ...(typeof candidate.defaultHeaders === 'object' && candidate.defaultHeaders !== null
      ? { defaultHeaders: candidate.defaultHeaders as Record<string, string> }
      : {}),
    ...(typeof candidate.acpCommand === 'string' ? { acpCommand: candidate.acpCommand } : {}),
    ...(Array.isArray(candidate.acpArgs)
      ? { acpArgs: candidate.acpArgs.filter((arg): arg is string => typeof arg === 'string') }
      : {}),
  };
}

function toPersistedConfig(config: ProviderConfig): ProviderConfig {
  if (!isTauri()) return config;

  const { apiKey: _apiKey, ...persisted } = config;
  return persisted;
}

export function loadProviderConfig(): ProviderConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = validateProviderConfig(JSON.parse(raw));
    if (!parsed) return null;
    if (isTauri() && parsed.provider !== 'subscription') {
      const { apiKey: _apiKey, ...desktopConfig } = parsed;
      return desktopConfig;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveProviderConfig(config: ProviderConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersistedConfig(config)));
}

export function clearProviderConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Build the subscription portion of GatewayConfig from ProviderConfig (shared by all runtimes). */
export function buildSubscriptionGatewayConfig(
  config: ProviderConfig,
): { command?: string; args?: string[] } | undefined {
  if (config.provider !== 'subscription') return undefined;
  return {
    command: config.acpCommand ?? 'claude',
    args: config.acpArgs ?? ['acp'],
  };
}
