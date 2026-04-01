import type {
  LlmProvider,
  ModelPolicyConfig,
  ModelProfile,
  RuntimeExecutionMode,
  RuntimeMemoryPolicy,
  RuntimePolicyConfig,
  RuntimeSummarizationPolicy,
  RuntimeToolPermissionBehavior,
  RuntimeToolPermissionsPolicy,
  RuntimeToolSearchPolicy,
} from '@offisim/shared-types';
import { isProductionProvider } from '@offisim/shared-types';
import { isTauri } from './env';

export interface ProviderConfig {
  provider: LlmProvider;
  apiKey?: string;
  baseURL?: string;
  model: string;
  defaultHeaders?: Record<string, string>;
  acpCommand?: string;
  acpArgs?: string[];
  runtimePolicy?: Partial<RuntimePolicyConfig>;
}

const STORAGE_KEY = 'offisim-provider-config';

const DEFAULT_EXECUTION_MODE: RuntimeExecutionMode = 'auto';
const DEFAULT_SUMMARIZATION: RuntimeSummarizationPolicy = {
  enabled: true,
  triggerTokens: 60_000,
  keepRecentMessages: 30,
};
const DEFAULT_MEMORY: RuntimeMemoryPolicy = {
  enabled: true,
  injectionEnabled: true,
  maxFacts: 50,
  factConfidenceThreshold: 0.7,
};
const DEFAULT_TOOL_SEARCH: RuntimeToolSearchPolicy = {
  enabled: true,
};
const DEFAULT_TOOL_PERMISSIONS: RuntimeToolPermissionsPolicy = {
  enabled: true,
  defaultBehavior: 'allow',
  rules: [],
};
const DEFAULT_MODEL_PROFILE_NAME = 'runtime-default';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLlmProvider(value: unknown): value is LlmProvider {
  return (
    value === 'anthropic' ||
    value === 'openai' ||
    value === 'openai-compat' ||
    value === 'subscription'
  );
}

function isRuntimeExecutionMode(value: unknown): value is RuntimeExecutionMode {
  return value === 'auto' || value === 'desktop-trusted' || value === 'browser-limited';
}

function normalizeExecutionMode(value: unknown): RuntimeExecutionMode {
  return isRuntimeExecutionMode(value) ? value : DEFAULT_EXECUTION_MODE;
}

function normalizeModelProfile(
  candidate: unknown,
  provider: LlmProvider,
  model: string,
): ModelProfile {
  const profile = isRecord(candidate) ? candidate : {};
  return {
    profileName:
      typeof profile.profileName === 'string' && profile.profileName.trim()
        ? profile.profileName
        : DEFAULT_MODEL_PROFILE_NAME,
    provider,
    model,
    ...(typeof profile.temperature === 'number' ? { temperature: profile.temperature } : {}),
    ...(typeof profile.maxTokens === 'number' ? { maxTokens: profile.maxTokens } : {}),
  };
}

function normalizeModelPolicy(
  candidate: unknown,
  provider: LlmProvider,
  model: string,
): ModelPolicyConfig {
  const policy = isRecord(candidate) ? candidate : {};
  const normalizedOverrides: Record<string, ModelProfile> = {};

  if (isRecord(policy.overrides)) {
    for (const [roleSlug, override] of Object.entries(policy.overrides)) {
      if (!isRecord(override)) continue;
      const overrideProvider = override.provider;
      const overrideModel = override.model;
      if (
        !isLlmProvider(overrideProvider) ||
        typeof overrideModel !== 'string' ||
        !overrideModel.trim()
      ) {
        continue;
      }

      normalizedOverrides[roleSlug] = {
        profileName:
          typeof override.profileName === 'string' && override.profileName.trim()
            ? override.profileName
            : roleSlug,
        provider: overrideProvider,
        model: overrideModel,
        ...(typeof override.temperature === 'number' ? { temperature: override.temperature } : {}),
        ...(typeof override.maxTokens === 'number' ? { maxTokens: override.maxTokens } : {}),
      };
    }
  }

  return {
    default: normalizeModelProfile(policy.default, provider, model),
    ...(Object.keys(normalizedOverrides).length > 0 ? { overrides: normalizedOverrides } : {}),
  };
}

function normalizeSummarization(candidate: unknown): RuntimeSummarizationPolicy {
  const policy = isRecord(candidate) ? candidate : {};
  return {
    enabled: typeof policy.enabled === 'boolean' ? policy.enabled : DEFAULT_SUMMARIZATION.enabled,
    triggerTokens:
      typeof policy.triggerTokens === 'number' && policy.triggerTokens > 0
        ? policy.triggerTokens
        : DEFAULT_SUMMARIZATION.triggerTokens,
    keepRecentMessages:
      typeof policy.keepRecentMessages === 'number' && policy.keepRecentMessages >= 0
        ? policy.keepRecentMessages
        : DEFAULT_SUMMARIZATION.keepRecentMessages,
  };
}

function normalizeMemory(candidate: unknown): RuntimeMemoryPolicy {
  const policy = isRecord(candidate) ? candidate : {};
  return {
    enabled: typeof policy.enabled === 'boolean' ? policy.enabled : DEFAULT_MEMORY.enabled,
    injectionEnabled:
      typeof policy.injectionEnabled === 'boolean'
        ? policy.injectionEnabled
        : DEFAULT_MEMORY.injectionEnabled,
    maxFacts:
      typeof policy.maxFacts === 'number' && policy.maxFacts > 0
        ? policy.maxFacts
        : DEFAULT_MEMORY.maxFacts,
    factConfidenceThreshold:
      typeof policy.factConfidenceThreshold === 'number' &&
      policy.factConfidenceThreshold >= 0 &&
      policy.factConfidenceThreshold <= 1
        ? policy.factConfidenceThreshold
        : DEFAULT_MEMORY.factConfidenceThreshold,
  };
}

function normalizeToolSearch(candidate: unknown): RuntimeToolSearchPolicy {
  const policy = isRecord(candidate) ? candidate : {};
  return {
    enabled: typeof policy.enabled === 'boolean' ? policy.enabled : DEFAULT_TOOL_SEARCH.enabled,
  };
}

function isRuntimeToolPermissionBehavior(value: unknown): value is RuntimeToolPermissionBehavior {
  return value === 'allow' || value === 'deny' || value === 'ask';
}

function normalizeToolPermissions(candidate: unknown): RuntimeToolPermissionsPolicy {
  const policy = isRecord(candidate) ? candidate : {};
  return {
    enabled:
      typeof policy.enabled === 'boolean' ? policy.enabled : DEFAULT_TOOL_PERMISSIONS.enabled,
    defaultBehavior: isRuntimeToolPermissionBehavior(policy.defaultBehavior)
      ? policy.defaultBehavior
      : DEFAULT_TOOL_PERMISSIONS.defaultBehavior,
    rules: Array.isArray(policy.rules)
      ? policy.rules.flatMap((rule) => {
          if (!isRecord(rule)) return [];
          if (
            typeof rule.pattern !== 'string' ||
            !rule.pattern.trim() ||
            !isRuntimeToolPermissionBehavior(rule.behavior)
          ) {
            return [];
          }
          return [{ pattern: rule.pattern.trim(), behavior: rule.behavior }];
        })
      : DEFAULT_TOOL_PERMISSIONS.rules,
  };
}

export function createDefaultRuntimePolicy(
  provider: LlmProvider,
  model: string,
): RuntimePolicyConfig {
  return {
    executionMode: DEFAULT_EXECUTION_MODE,
    modelPolicy: {
      default: normalizeModelProfile(undefined, provider, model),
    },
    summarization: { ...DEFAULT_SUMMARIZATION },
    memory: { ...DEFAULT_MEMORY },
    toolSearch: { ...DEFAULT_TOOL_SEARCH },
    toolPermissions: { ...DEFAULT_TOOL_PERMISSIONS },
  };
}

export function normalizeRuntimePolicy(
  policy: unknown,
  provider: LlmProvider,
  model: string,
): RuntimePolicyConfig {
  const candidate = isRecord(policy) ? policy : {};
  return {
    executionMode: normalizeExecutionMode(candidate.executionMode),
    modelPolicy: normalizeModelPolicy(candidate.modelPolicy, provider, model),
    summarization: normalizeSummarization(candidate.summarization),
    memory: normalizeMemory(candidate.memory),
    toolSearch: normalizeToolSearch(candidate.toolSearch),
    toolPermissions: normalizeToolPermissions(candidate.toolPermissions),
  };
}

export function resolveEffectiveExecutionMode(
  executionMode: RuntimeExecutionMode,
  options: { tauri: boolean },
): RuntimeExecutionMode {
  if (executionMode === 'browser-limited') {
    return 'browser-limited';
  }

  return options.tauri ? 'desktop-trusted' : 'browser-limited';
}

export function resolveEffectiveRuntimePolicy(
  policy: unknown,
  provider: LlmProvider,
  model: string,
  options: { tauri: boolean },
): RuntimePolicyConfig {
  const normalized = normalizeRuntimePolicy(policy, provider, model);
  return {
    ...normalized,
    executionMode: resolveEffectiveExecutionMode(normalized.executionMode, options),
  };
}

export function getInstallEnvironmentForExecutionMode(
  executionMode: RuntimeExecutionMode,
): 'desktop' | 'web_limited' {
  return executionMode === 'browser-limited' ? 'web_limited' : 'desktop';
}

export function buildRuntimeModelPolicy(config: ProviderConfig): ModelPolicyConfig {
  return normalizeRuntimePolicy(config.runtimePolicy, config.provider, config.model).modelPolicy;
}

function normalizeProviderConfig(parsed: unknown): ProviderConfig | null {
  if (!isRecord(parsed)) return null;

  const provider = parsed.provider;
  const model = parsed.model;
  const apiKey = parsed.apiKey;

  if (!isLlmProvider(provider) || typeof model !== 'string' || !model.trim()) {
    return null;
  }

  const normalized: ProviderConfig = {
    provider,
    model,
    ...(typeof apiKey === 'string' ? { apiKey } : {}),
    ...(typeof parsed.baseURL === 'string' ? { baseURL: parsed.baseURL } : {}),
    ...(isRecord(parsed.defaultHeaders)
      ? { defaultHeaders: parsed.defaultHeaders as Record<string, string> }
      : {}),
    ...(typeof parsed.acpCommand === 'string' ? { acpCommand: parsed.acpCommand } : {}),
    ...(Array.isArray(parsed.acpArgs)
      ? { acpArgs: parsed.acpArgs.filter((arg): arg is string => typeof arg === 'string') }
      : {}),
  };

  normalized.runtimePolicy = normalizeRuntimePolicy(parsed.runtimePolicy, provider, model);
  return normalized;
}

function toPersistedConfig(config: ProviderConfig): ProviderConfig {
  const normalized = normalizeProviderConfig(config);
  if (!normalized) {
    return config;
  }

  if (!isTauri()) {
    return normalized;
  }

  const { apiKey: _apiKey, ...persisted } = normalized;
  return persisted;
}

export function loadProviderConfig(): ProviderConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = normalizeProviderConfig(JSON.parse(raw));
    if (!parsed) return null;

    // Warn about legacy vendor-direct configs that are no longer valid for production
    if (isTauri() && !isProductionProvider(parsed.provider)) {
      console.warn(
        `[Offisim] Saved provider "${parsed.provider}" is a vendor-direct adapter and is not allowed in production runtime on desktop. Please switch to a self-developed transport (e.g. "subscription") in Settings. Ignoring saved config.`,
      );
      // Return null so the desktop falls back to repos-only mode
      // instead of crashing in createTauriRuntime().
      return null;
    }

    if (!isTauri() && !import.meta.env.DEV && !isProductionProvider(parsed.provider)) {
      console.warn(
        `[Offisim] Saved provider "${parsed.provider}" is a vendor-direct adapter and is not allowed in production runtime. Ignoring saved config.`,
      );
      // Return null so the browser falls back to repos-only mode
      // instead of crashing in assertBrowserProviderAllowed().
      return null;
    }

    if (isTauri() && isProductionProvider(parsed.provider)) {
      // Self-developed providers use secure transport — strip any stored apiKey
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

/** Build the self-developed transport config from ProviderConfig (shared by all runtimes). */
export function buildSubscriptionGatewayConfig(
  config: ProviderConfig,
): { command?: string; args?: string[] } | undefined {
  if (!isProductionProvider(config.provider)) return undefined;
  return {
    command: config.acpCommand ?? 'claude',
    args: config.acpArgs ?? ['acp'],
  };
}
