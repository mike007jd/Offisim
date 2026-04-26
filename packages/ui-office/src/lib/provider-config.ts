import type {
  EmployeeRuntimeBinding,
  EngineId,
  LlmExecutionLane,
  LlmProvider,
  ModelPolicyConfig,
  ModelProfile,
  ProviderAuthStrategy,
  ProviderProductAccessMode,
  ProviderProductId,
  RuntimeExecutionMode,
  RuntimeMemoryPolicy,
  RuntimePolicyConfig,
  RuntimeSummarizationPolicy,
  RuntimeToolPermissionBehavior,
  RuntimeToolPermissionsPolicy,
  RuntimeToolSearchPolicy,
} from '@offisim/shared-types';
import { isTauri } from './env';
import {
  findProviderProductIdByLegacyRoute,
  getDefaultProviderAccessMode,
  getDefaultProviderVariantId,
  getProviderProduct,
  getProviderProductAccess,
  getProviderVariant,
  getSupportedExecutionLanesForProduct,
  isProviderCompatibility,
  isProviderProductAccessMode,
  isProviderProductId,
  type ProviderCapabilities,
  type ProviderCompatibility,
  type ProviderProductAccessDefinition,
  type ProviderProductDefinition,
  type ProviderRegion,
  type ProviderSurface,
  type ProviderVariantDefinition,
  type ProviderVendor,
} from './provider-product-taxonomy';

export type {
  ProviderCapabilities,
  ProviderCompatibility,
  ProviderProductAccessDefinition,
  ProviderProductDefinition,
  ProviderRegion,
  ProviderSurface,
  ProviderVariantDefinition,
  ProviderVendor,
};

export interface ProviderConfigMigrationSource {
  readonly kind: 'legacy-provider-record';
  readonly legacyProvider?: string;
  readonly legacyVariantId?: string;
  readonly legacyVendor?: string;
}

export interface ProviderConfig {
  productId: ProviderProductId;
  accessMode: ProviderProductAccessMode;
  executionLane: LlmExecutionLane;
  model: string;
  providerVariantId?: string;
  endpointOverride?: string;
  defaultHeaders?: Record<string, string>;
  apiKey?: string;
  runtimePolicy?: Partial<RuntimePolicyConfig>;
  requiresReconfigure?: boolean;
  migrationSource?: ProviderConfigMigrationSource;
  /** Derived fields hydrated at load time for consumers that still need them. */
  provider?: LlmProvider;
  baseURL?: string;
  vendor?: ProviderVendor;
  region?: ProviderRegion;
  compatibility?: ProviderCompatibility;
  surface?: ProviderSurface;
  capabilities?: ProviderCapabilities;
}

export type ProviderAvailabilityCode =
  | 'host-unavailable'
  | 'resolver-missing'
  | 'requires-reconfigure'
  | 'invalid-config'
  | 'invalid-product';

export interface ProviderAvailabilityState {
  readonly available: boolean;
  readonly code?: ProviderAvailabilityCode;
  readonly message?: string;
}

export interface ResolvedTransportProfile {
  readonly provider: LlmProvider;
  readonly baseURL?: string;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
  readonly executionLane: LlmExecutionLane;
  readonly authStrategy: ProviderAuthStrategy;
}

export interface ResolvedProviderConfig {
  readonly config: ProviderConfig;
  readonly product: ProviderProductDefinition;
  readonly access: ProviderProductAccessDefinition;
  readonly variant: ProviderVariantDefinition | null;
  readonly provider: LlmProvider;
  readonly model: string;
  readonly executionLane: LlmExecutionLane;
  readonly transport: ResolvedTransportProfile;
  readonly capabilities?: ProviderCapabilities;
  readonly availability: ProviderAvailabilityState;
}

const STORAGE_KEY = 'offisim-provider-config';

const DEFAULT_EXECUTION_MODE: RuntimeExecutionMode = 'auto';
export const DEFAULT_EXECUTION_LANE: LlmExecutionLane = 'gateway';
export const PRODUCT_RUNTIME_HOST_SUPPORTED_EXECUTION_LANES: readonly LlmExecutionLane[] = [
  'gateway',
  'claude-agent-sdk',
  'codex-agent-sdk',
  'openai-agents-sdk',
];
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
const EXECUTION_LANES = new Set<LlmExecutionLane>([
  'gateway',
  'claude-agent-sdk',
  'codex-agent-sdk',
  'openai-agents-sdk',
]);
const ENGINE_IDS = new Set<EngineId>(['codex-engine', 'claude-engine']);

function trimEnvString(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function loadEnvBackedProviderConfig(): ProviderConfig | null {
  const apiKey = trimEnvString(import.meta.env.VITE_MINIMAX_API_KEY);
  if (!apiKey) return null;

  const model = trimEnvString(import.meta.env.VITE_MINIMAX_MODEL) ?? 'MiniMax-M2.7';
  const endpointOverride = trimEnvString(import.meta.env.VITE_MINIMAX_BASE_URL);
  const config: ProviderConfig = {
    productId: 'minimax',
    accessMode: 'api-key',
    executionLane: DEFAULT_EXECUTION_LANE,
    providerVariantId: 'minimax-intl-anthropic-coding',
    apiKey,
    model,
    ...(endpointOverride ? { endpointOverride } : {}),
    runtimePolicy: createDefaultRuntimePolicy('anthropic', model),
  };

  return hydrateDerivedProviderFields(config);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLlmProvider(value: unknown): value is LlmProvider {
  return value === 'anthropic' || value === 'openai' || value === 'openai-compat';
}

export function isLlmExecutionLane(value: unknown): value is LlmExecutionLane {
  return typeof value === 'string' && EXECUTION_LANES.has(value as LlmExecutionLane);
}

export function normalizeExecutionLane(value: unknown): LlmExecutionLane {
  return isLlmExecutionLane(value) ? value : DEFAULT_EXECUTION_LANE;
}

export function normalizeSupportedExecutionLanes(value: unknown): readonly LlmExecutionLane[] {
  const normalized = Array.isArray(value)
    ? value.filter(isLlmExecutionLane)
    : ([] as LlmExecutionLane[]);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : [DEFAULT_EXECUTION_LANE];
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

function normalizeEmployeeRuntimeBinding(candidate: unknown): EmployeeRuntimeBinding | undefined {
  if (!isRecord(candidate)) return undefined;
  if (candidate.mode === 'provider') {
    return { mode: 'provider' };
  }
  if (candidate.mode === 'engine' && ENGINE_IDS.has(candidate.engineId as EngineId)) {
    return {
      mode: 'engine',
      engineId: candidate.engineId as EngineId,
    };
  }
  return undefined;
}

function normalizeEndpointOverride(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeMigrationSource(value: unknown): ProviderConfigMigrationSource | undefined {
  if (!isRecord(value)) return undefined;
  return {
    kind: 'legacy-provider-record',
    ...(typeof value.legacyProvider === 'string' ? { legacyProvider: value.legacyProvider } : {}),
    ...(typeof value.legacyVariantId === 'string'
      ? { legacyVariantId: value.legacyVariantId }
      : {}),
    ...(typeof value.legacyVendor === 'string' ? { legacyVendor: value.legacyVendor } : {}),
  };
}

function buildLegacyMigrationSource(input: {
  legacyProvider?: string | null;
  legacyVariantId?: string;
  legacyVendor?: string;
}): ProviderConfigMigrationSource | undefined {
  const { legacyProvider, legacyVariantId, legacyVendor } = input;
  if (!legacyProvider && !legacyVariantId && !legacyVendor) {
    return undefined;
  }

  return {
    kind: 'legacy-provider-record',
    ...(legacyProvider ? { legacyProvider } : {}),
    ...(legacyVariantId ? { legacyVariantId } : {}),
    ...(legacyVendor ? { legacyVendor } : {}),
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
  const employeeRuntimeDefault = normalizeEmployeeRuntimeBinding(candidate.employeeRuntimeDefault);
  return {
    executionMode: normalizeExecutionMode(candidate.executionMode),
    modelPolicy: normalizeModelPolicy(candidate.modelPolicy, provider, model),
    summarization: normalizeSummarization(candidate.summarization),
    memory: normalizeMemory(candidate.memory),
    toolSearch: normalizeToolSearch(candidate.toolSearch),
    toolPermissions: normalizeToolPermissions(candidate.toolPermissions),
    ...(employeeRuntimeDefault ? { employeeRuntimeDefault } : {}),
    ...(typeof candidate.gitAutoCommit === 'boolean'
      ? { gitAutoCommit: candidate.gitAutoCommit }
      : {}),
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

export function resolveAvailableExecutionLanes(
  supportedLanes: readonly LlmExecutionLane[] | undefined,
  executionMode: RuntimeExecutionMode,
  options: { tauri: boolean },
): readonly LlmExecutionLane[] {
  const normalized = normalizeSupportedExecutionLanes(supportedLanes);
  const effectiveMode = resolveEffectiveExecutionMode(executionMode, options);
  if (effectiveMode === 'browser-limited') {
    return [DEFAULT_EXECUTION_LANE];
  }

  const available = normalized.filter((lane) =>
    PRODUCT_RUNTIME_HOST_SUPPORTED_EXECUTION_LANES.includes(lane),
  );
  return available.length > 0 ? available : [DEFAULT_EXECUTION_LANE];
}

export function isExecutionLaneAllowed(
  executionLane: LlmExecutionLane,
  supportedLanes: readonly LlmExecutionLane[] | undefined,
  executionMode: RuntimeExecutionMode,
  options: { tauri: boolean },
): boolean {
  return resolveAvailableExecutionLanes(supportedLanes, executionMode, options).includes(
    executionLane,
  );
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
  const resolved = resolveProviderConfig(config);
  if (!resolved) {
    return normalizeRuntimePolicy(config.runtimePolicy, 'openai-compat', config.model).modelPolicy;
  }
  return normalizeRuntimePolicy(config.runtimePolicy, resolved.provider, config.model).modelPolicy;
}

export function resolveProviderConfig(
  config: ProviderConfig,
): ResolvedProviderConfig | null {
  const product = getProviderProduct(config.productId);
  if (!product) return null;

  const access = getProviderProductAccess(product, config.accessMode);
  if (!access) return null;

  const variant =
    getProviderVariant(config.providerVariantId ?? undefined) ??
    getProviderVariant(access.defaultVariantId ?? undefined) ??
    null;

  const supportedExecutionLanes = getSupportedExecutionLanesForProduct(
    product,
    access.accessMode,
    variant?.providerVariantId ?? null,
  );
  const executionLane = supportedExecutionLanes.includes(config.executionLane)
    ? config.executionLane
    : (supportedExecutionLanes[0] ?? DEFAULT_EXECUTION_LANE);
  const baseURL = config.endpointOverride?.trim() || variant?.baseURL;
  const mergedHeaders =
    variant?.defaultHeaders || config.defaultHeaders
      ? {
          ...(variant?.defaultHeaders ?? {}),
          ...(config.defaultHeaders ?? {}),
        }
      : undefined;

  const provider = variant?.provider ?? config.provider;
  if (!provider) return null;

  const availability =
    config.requiresReconfigure === true
      ? {
          available: false,
          code: 'requires-reconfigure' as const,
          message:
            'This provider configuration was migrated from a retired route and must be reviewed before use.',
        }
      : access.endpointOverrideMode === 'required' && !baseURL
        ? {
            available: false,
            code: 'invalid-config' as const,
            message:
              'This product requires an explicit endpoint override before runtime binding can be created.',
          }
        : ({ available: true } as const);

  return {
    config,
    product,
    access,
    variant,
    provider,
    model: config.model,
    executionLane,
    transport: {
      provider,
      ...(baseURL ? { baseURL } : {}),
      ...(mergedHeaders ? { defaultHeaders: mergedHeaders } : {}),
      executionLane,
      authStrategy: access.authStrategy,
    },
    capabilities: variant?.capabilities ?? config.capabilities,
    availability,
  };
}

export function resolveProviderHostAvailability(
  resolved: ResolvedProviderConfig,
  options: {
    tauri: boolean;
    trustedHostStatus?: {
      available: boolean;
      message?: string | null;
    } | null;
  },
): ProviderAvailabilityState {
  if (!resolved.availability.available) return resolved.availability;
  if (resolved.transport.authStrategy !== 'trusted-local-auth') {
    return resolved.availability;
  }
  if (!options.tauri) {
    return {
      available: false,
      code: 'host-unavailable',
      message: `${resolved.product.displayName} is unavailable in browser-limited runtime. Switch product or move to a trusted host.`,
    };
  }
  if (options.trustedHostStatus?.available) {
    return { available: true };
  }
  return {
    available: false,
    code: 'resolver-missing',
    message:
      options.trustedHostStatus?.message ??
      `${resolved.product.displayName} local auth is unavailable on this trusted host.`,
  };
}

function isInvalidResolvedConfig(resolved: ResolvedProviderConfig | null): boolean {
  return resolved?.availability.available === false && resolved.availability.code === 'invalid-config';
}

function getBrowserAvailableExecutionLanes(
  resolved: ResolvedProviderConfig,
): readonly LlmExecutionLane[] {
  return resolveAvailableExecutionLanes(
    getSupportedExecutionLanesForProduct(
      resolved.product,
      resolved.access.accessMode,
      resolved.variant?.providerVariantId ?? null,
    ),
    DEFAULT_EXECUTION_MODE,
    { tauri: false },
  );
}

function clampProviderConfigForCurrentHost(
  config: ProviderConfig,
  resolved: ResolvedProviderConfig | null,
): ProviderConfig {
  if (isTauri() || !resolved || resolved.transport.authStrategy === 'trusted-local-auth') {
    return config;
  }

  const availableExecutionLanes = getBrowserAvailableExecutionLanes(resolved);
  if (availableExecutionLanes.includes(config.executionLane)) {
    return config;
  }

  return {
    ...config,
    executionLane: availableExecutionLanes[0] ?? DEFAULT_EXECUTION_LANE,
  };
}

function hydrateDerivedProviderFields(config: ProviderConfig): ProviderConfig {
  const resolved = resolveProviderConfig(config);
  if (!resolved) return config;

  return {
    ...config,
    provider: resolved.provider,
    ...(resolved.transport.baseURL ? { baseURL: resolved.transport.baseURL } : {}),
    ...(resolved.variant?.vendor ? { vendor: resolved.variant.vendor } : {}),
    ...(resolved.variant?.region ? { region: resolved.variant.region } : {}),
    ...(resolved.variant?.compatibility ? { compatibility: resolved.variant.compatibility } : {}),
    ...(resolved.variant?.surface ? { surface: resolved.variant.surface } : {}),
    ...(resolved.capabilities ? { capabilities: resolved.capabilities } : {}),
  };
}

function normalizeProductProviderConfig(parsed: Record<string, unknown>): ProviderConfig | null {
  if (!isProviderProductId(parsed.productId)) return null;

  const productId = parsed.productId;
  const product = getProviderProduct(productId);
  if (!product) return null;

  const requestedAccessMode = isProviderProductAccessMode(parsed.accessMode)
    ? parsed.accessMode
    : getDefaultProviderAccessMode(productId);
  const access = getProviderProductAccess(product, requestedAccessMode);
  if (!access) return null;

  const model = typeof parsed.model === 'string' ? parsed.model.trim() : '';
  if (!model) return null;

  const requestedVariantId =
    typeof parsed.providerVariantId === 'string' && parsed.providerVariantId.trim()
      ? parsed.providerVariantId.trim()
      : undefined;
  const allowedVariantIds = new Set(access.variantIds ?? product.variantIds);
  const providerVariantId =
    requestedVariantId && allowedVariantIds.has(requestedVariantId)
      ? requestedVariantId
      : getDefaultProviderVariantId(productId, access.accessMode);

  const supportedExecutionLanes = getSupportedExecutionLanesForProduct(
    product,
    access.accessMode,
    providerVariantId ?? null,
  );
  const normalizedExecutionLane = normalizeExecutionLane(parsed.executionLane);
  const endpointOverride = normalizeEndpointOverride(parsed.endpointOverride);
  const defaultHeaders = isRecord(parsed.defaultHeaders)
    ? (parsed.defaultHeaders as Record<string, string>)
    : undefined;
  const migrationSource = normalizeMigrationSource(parsed.migrationSource);
  const normalized: ProviderConfig = {
    productId,
    accessMode: access.accessMode,
    executionLane: supportedExecutionLanes.includes(normalizedExecutionLane)
      ? normalizedExecutionLane
      : (supportedExecutionLanes[0] ?? DEFAULT_EXECUTION_LANE),
    model,
    ...(providerVariantId ? { providerVariantId } : {}),
    ...(endpointOverride ? { endpointOverride } : {}),
    ...(typeof parsed.apiKey === 'string' ? { apiKey: parsed.apiKey } : {}),
    ...(defaultHeaders ? { defaultHeaders } : {}),
    ...(typeof parsed.requiresReconfigure === 'boolean'
      ? { requiresReconfigure: parsed.requiresReconfigure }
      : {}),
    ...(migrationSource ? { migrationSource } : {}),
  };

  const resolved = resolveProviderConfig(normalized);
  if (!resolved) return null;
  if (isInvalidResolvedConfig(resolved)) {
    return null;
  }

  const derived = hydrateDerivedProviderFields(normalized);
  derived.runtimePolicy = normalizeRuntimePolicy(parsed.runtimePolicy, resolved.provider, model);
  return derived;
}

function migrateLegacyProviderConfig(parsed: Record<string, unknown>): ProviderConfig | null {
  const legacyProvider =
    typeof parsed.provider === 'string' && parsed.provider.trim() ? parsed.provider.trim() : null;
  const legacyVariantId =
    typeof parsed.providerVariantId === 'string' && parsed.providerVariantId.trim()
      ? parsed.providerVariantId.trim()
      : undefined;
  const legacyVendor =
    typeof parsed.vendor === 'string' && parsed.vendor.trim() ? parsed.vendor.trim() : undefined;

  if (legacyProvider === 'subscription') {
    const migrationSource = buildLegacyMigrationSource({
      legacyProvider,
      legacyVariantId,
      legacyVendor,
    });
    const migrated = normalizeProductProviderConfig({
      productId: 'claude',
      accessMode: 'subscription',
      executionLane: 'claude-agent-sdk',
      model:
        typeof parsed.model === 'string' && parsed.model.trim()
          ? parsed.model.trim()
          : 'claude-sonnet-4-20250514',
      requiresReconfigure: true,
      ...(migrationSource ? { migrationSource } : {}),
      runtimePolicy: parsed.runtimePolicy,
    });
    return migrated;
  }

  const provider = legacyProvider;
  const model = typeof parsed.model === 'string' ? parsed.model.trim() : '';
  if (!isLlmProvider(provider) || !model) {
    return null;
  }

  const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey : undefined;
  const baseURL = normalizeEndpointOverride(parsed.baseURL);
  if (!apiKey && !baseURL) {
    return null;
  }

  const productId =
    findProviderProductIdByLegacyRoute({
      provider,
      providerVariantId: legacyVariantId,
      vendor: legacyVendor,
      baseURL,
      compatibility:
        typeof parsed.compatibility === 'string' && isProviderCompatibility(parsed.compatibility)
          ? parsed.compatibility
          : undefined,
    }) ??
    (provider === 'openai'
      ? 'openai-api'
      : provider === 'anthropic'
        ? 'anthropic-api'
        : 'custom-compatible');

  const defaultVariantId = getDefaultProviderVariantId(productId, 'api-key');
  const currentVariant = legacyVariantId ? getProviderVariant(legacyVariantId) : undefined;
  const defaultVariant = getProviderVariant(defaultVariantId);
  const endpointOverride =
    baseURL && baseURL !== currentVariant?.baseURL && baseURL !== defaultVariant?.baseURL
      ? baseURL
      : undefined;
  const migrationSource = buildLegacyMigrationSource({
    legacyProvider: provider,
    legacyVariantId,
    legacyVendor,
  });
  const migrated = normalizeProductProviderConfig({
    productId,
    accessMode: 'api-key',
    executionLane: parsed.executionLane,
    providerVariantId: legacyVariantId ?? defaultVariantId,
    model,
    ...(endpointOverride ? { endpointOverride } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(isRecord(parsed.defaultHeaders) ? { defaultHeaders: parsed.defaultHeaders } : {}),
    ...(migrationSource ? { migrationSource } : {}),
    ...(typeof parsed.requiresReconfigure === 'boolean'
      ? { requiresReconfigure: parsed.requiresReconfigure }
      : {}),
    runtimePolicy: parsed.runtimePolicy,
  });

  if (!migrated) return null;
  const resolved = resolveProviderConfig(migrated);
  if (!resolved) return null;
  if (isInvalidResolvedConfig(resolved)) {
    return null;
  }
  return migrated;
}

export function normalizeProviderConfig(parsed: unknown): ProviderConfig | null {
  if (!isRecord(parsed)) return null;
  return 'productId' in parsed
    ? normalizeProductProviderConfig(parsed)
    : migrateLegacyProviderConfig(parsed);
}

function toPersistedConfig(config: ProviderConfig): ProviderConfig {
  const normalized = normalizeProviderConfig(config);
  if (!normalized) {
    return config;
  }

  const resolved = resolveProviderConfig(normalized);
  const clamped = clampProviderConfigForCurrentHost(normalized, resolved);

  const {
    apiKey: _apiKey,
    provider: _provider,
    baseURL: _baseURL,
    vendor: _vendor,
    region: _region,
    compatibility: _compatibility,
    surface: _surface,
    capabilities: _capabilities,
    ...persisted
  } = clamped;
  return isTauri()
    ? persisted
    : { ...persisted, ...(clamped.apiKey ? { apiKey: clamped.apiKey } : {}) };
}

export function loadProviderConfig(): ProviderConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return loadEnvBackedProviderConfig();
    const parsed = normalizeProviderConfig(JSON.parse(raw));
    if (!parsed) return loadEnvBackedProviderConfig();
    return clampProviderConfigForCurrentHost(parsed, resolveProviderConfig(parsed));
  } catch {
    return loadEnvBackedProviderConfig();
  }
}

export function saveProviderConfig(config: ProviderConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersistedConfig(config)));
}

export function clearProviderConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}
