/**
 * Supported LLM provider transports.
 *
 * `subscription` is a Node-only adapter (runs `claude acp` via `node:child_process`)
 * and is therefore gated to the desktop/Tauri environment by a runtime check in
 * `gateway-factory.ts` (`shouldRejectSubscriptionInRenderer`). All other providers
 * are BYO-key adapters and are equally valid in browser and desktop.
 */
export type LlmProvider = 'subscription' | 'openai' | 'anthropic' | 'openai-compat';

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

/** Unified runtime policy stored alongside the provider configuration. */
export interface RuntimePolicyConfig {
  readonly executionMode: RuntimeExecutionMode;
  readonly modelPolicy: ModelPolicyConfig;
  readonly summarization: RuntimeSummarizationPolicy;
  readonly memory: RuntimeMemoryPolicy;
  readonly toolSearch: RuntimeToolSearchPolicy;
  readonly toolPermissions: RuntimeToolPermissionsPolicy;
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
