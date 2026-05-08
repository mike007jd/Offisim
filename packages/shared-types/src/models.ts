/**
 * Supported LLM provider transports.
 *
 * All current providers are BYO-key HTTP adapters and are valid in both browser
 * and desktop runtimes.
 */
export type LlmProvider = 'openai' | 'anthropic' | 'openai-compat';

/** User-facing provider product identities exposed in Settings/runtime config. */
export type ProviderProductId =
  | 'codex'
  | 'openai-api'
  | 'claude'
  | 'anthropic-api'
  | 'openrouter'
  | 'kimi'
  | 'qwen-model-studio'
  | 'minimax'
  | 'zai-glm'
  | 'custom-compatible'
  | 'gemini'
  | 'deepseek'
  | 'lmstudio';

/** How a provider product authenticates on the active host. */
export type ProviderProductAccessMode = 'api-key' | 'local-auth' | 'subscription';

/** Where the resolved provider-variant metadata originates. */
export type ProviderCatalogSource = 'curated-catalog' | 'repo-owned';

/** Runtime auth strategy after product resolution. */
export type ProviderAuthStrategy = 'api-key' | 'trusted-local-auth' | 'manual';

/** Abstract model profile — maps to a concrete provider+model */
export interface ModelProfile {
  readonly profileName: string;
  readonly provider: LlmProvider;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

/** Runtime execution mode advertised by the local policy surface. */
export type RuntimeExecutionMode = 'auto' | 'desktop-trusted' | 'browser-limited';

/** Concrete LLM execution path bound to a provider config. */
export type LlmExecutionLane =
  | 'gateway'
  | 'claude-agent-sdk'
  | 'codex-agent-sdk'
  | 'openai-agents-sdk';

/** External runtime engines that can execute a single Offisim-dispatched employee task. */
export const ENGINE_IDS = ['codex-engine', 'claude-engine'] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export type RuntimeEngineCapabilityTier =
  | 'text-only'
  | 'sandbox-native-tools'
  | 'gateway-bridged-tools'
  | 'full-agent-employee';

export type RuntimeEngineAvailability = 'production' | 'preview' | 'blocked';

export type RuntimeEngineToolModel = 'none' | 'native-sdk' | 'gateway-bridged' | 'mixed';

export type RuntimeEngineVerificationStatus = 'verified' | 'partial' | 'missing' | 'blocked';

export interface RuntimeEngineCapabilityProfile {
  readonly profileId: string;
  readonly engineId: EngineId;
  readonly displayName: string;
  readonly tier: RuntimeEngineCapabilityTier;
  readonly availability: RuntimeEngineAvailability;
  readonly trustTier: 'text-only' | 'sandboxed' | 'trusted-gateway' | 'trusted-full-agent';
  readonly supportedTaskClasses: ReadonlyArray<string>;
  readonly unsupportedTaskClasses: ReadonlyArray<string>;
  readonly toolNamespace: 'none' | 'native-engine' | 'offisim-gateway' | 'mixed';
  readonly toolModel: RuntimeEngineToolModel;
  readonly sandbox: {
    readonly boundary: 'none' | 'engine-sandbox' | 'offisim-gateway' | 'desktop-trusted';
    readonly workspaceAccess: 'none' | 'read-only' | 'write';
  };
  readonly permissions: {
    readonly model: 'none' | 'engine-native' | 'offisim-policy' | 'offisim-bridge';
    readonly deniedPath: RuntimeEngineVerificationStatus;
  };
  readonly contextRetention: RuntimeEngineVerificationStatus;
  readonly cancellation: RuntimeEngineVerificationStatus;
  readonly checkpoint: RuntimeEngineVerificationStatus;
  readonly telemetry: RuntimeEngineVerificationStatus;
  readonly rollback: RuntimeEngineVerificationStatus;
  readonly failureTaxonomy: RuntimeEngineVerificationStatus;
  readonly nativeCapabilities: {
    readonly tools: boolean;
    readonly mcp: boolean;
    readonly subagents: boolean;
    readonly handoffs: boolean;
    readonly sessionResume: boolean;
  };
  readonly verification: {
    readonly status: RuntimeEngineVerificationStatus;
    readonly evidence: ReadonlyArray<string>;
    readonly blockers: ReadonlyArray<string>;
  };
}

export type MainHarnessMode = 'offisim-core' | 'driver' | 'replacement';

export type MainHarnessOverrideScope =
  | 'system'
  | 'company'
  | 'thread'
  | 'employee'
  | 'task';

export interface MainHarnessOverridePolicyRecord {
  readonly overrideId: string;
  readonly scope: MainHarnessOverrideScope;
  readonly scopeId: string;
  readonly actorId: string;
  readonly reason: string;
  readonly previousMode: MainHarnessMode;
  readonly nextMode: MainHarnessMode;
  readonly runtimeProfileId: string;
  readonly verificationStatus: RuntimeEngineVerificationStatus;
  readonly trustedRuntimeAvailable: boolean;
  readonly timestamp: string;
  readonly rollbackCheckpoint: string;
}

export interface MainHarnessPolicyConfig {
  readonly defaultMode: 'offisim-core';
  readonly overrides?: ReadonlyArray<MainHarnessOverridePolicyRecord>;
}

/**
 * Per-employee runtime binding. Provider mode keeps the Offisim-owned
 * prompt/tool-loop runtime; engine mode delegates one assigned task to a
 * trusted runtime adapter while Offisim retains top-level SOP ownership.
 */
export type EmployeeRuntimeBinding =
  | { readonly mode: 'provider' }
  | { readonly mode: 'engine'; readonly engineId: EngineId; readonly profileId?: string };

/** Provider-variant metadata after product resolution. */
export interface ResolvedProviderVariant {
  readonly productId: ProviderProductId;
  readonly providerVariantId: string;
  readonly provider: LlmProvider;
  readonly displayName: string;
  readonly catalogSource: ProviderCatalogSource;
  readonly vendor: string;
  readonly compatibility?: string;
  readonly region?: string;
  readonly surface?: string;
  readonly baseURL?: string;
  readonly defaultModel?: string;
  readonly supportedExecutionLanes: ReadonlyArray<LlmExecutionLane>;
  readonly modelIds: ReadonlyArray<string>;
}

/** Company-level model policy stored in companies.default_model_policy_json */
export interface ModelPolicyConfig {
  readonly default: ModelProfile;
  readonly overrides?: Readonly<Record<string, ModelProfile>>;
}

export interface RuntimeSummarizationPolicy {
  readonly enabled: boolean;
  readonly triggerTokens: number;
  readonly keepRecentMessages: number;
}

export interface RuntimeMemoryPolicy {
  readonly enabled: boolean;
  readonly injectionEnabled: boolean;
  readonly maxFacts: number;
  readonly factConfidenceThreshold: number;
}

export interface RuntimeToolSearchPolicy {
  readonly enabled: boolean;
}

export type RuntimeToolPermissionBehavior = 'allow' | 'deny' | 'ask';

export interface RuntimeToolPermissionRule {
  readonly pattern: string;
  readonly behavior: RuntimeToolPermissionBehavior;
}

export interface RuntimeToolPermissionsPolicy {
  readonly enabled: boolean;
  readonly defaultBehavior: RuntimeToolPermissionBehavior;
  readonly rules: ReadonlyArray<RuntimeToolPermissionRule>;
}

export type RuntimeRecordingMode = 'metadata' | 'replay';

export interface RuntimeRecordingPolicy {
  readonly mode: RuntimeRecordingMode;
}

/** Unified runtime policy stored alongside the provider configuration. */
export interface RuntimePolicyConfig {
  readonly executionMode: RuntimeExecutionMode;
  readonly modelPolicy: ModelPolicyConfig;
  readonly summarization: RuntimeSummarizationPolicy;
  readonly memory: RuntimeMemoryPolicy;
  readonly toolSearch: RuntimeToolSearchPolicy;
  readonly toolPermissions: RuntimeToolPermissionsPolicy;
  readonly recording?: RuntimeRecordingPolicy;
  /** Company default for local employees; employee config overrides this. */
  readonly employeeRuntimeDefault?: EmployeeRuntimeBinding;
  /** Capability profiles for non-default employee runtime engines. */
  readonly runtimeEngineProfiles?: ReadonlyArray<RuntimeEngineCapabilityProfile>;
  /** Explicit policy for non-default main harness driver/replacement modes. */
  readonly mainHarnessPolicy?: MainHarnessPolicyConfig;
  /** Auto-commit file changes after each plan step (desktop only). */
  readonly gitAutoCommit?: boolean;
}

/** Fully resolved model config ready for LLM call */
export interface ResolvedModel {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
}
