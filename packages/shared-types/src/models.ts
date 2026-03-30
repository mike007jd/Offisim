/**
 * Provider classification for AI Runtime Policy enforcement.
 *
 * - SelfDevelopedProvider: Offisim's own transport adapters — valid production paths.
 * - AdapterOnlyProvider: External vendor adapters — test/adapter-layer only, never production.
 */
export type SelfDevelopedProvider = 'subscription';
export type AdapterOnlyProvider = 'openai' | 'anthropic' | 'openai-compat';
export type LlmProvider = SelfDevelopedProvider | AdapterOnlyProvider;

/** Returns true if the provider is allowed in production runtime. */
export function isProductionProvider(provider: LlmProvider): provider is SelfDevelopedProvider {
  return provider === 'subscription';
}

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

/** Unified runtime policy stored alongside the provider configuration. */
export interface RuntimePolicyConfig {
  readonly executionMode: RuntimeExecutionMode;
  readonly modelPolicy: ModelPolicyConfig;
  readonly summarization: RuntimeSummarizationPolicy;
  readonly memory: RuntimeMemoryPolicy;
  readonly toolSearch: RuntimeToolSearchPolicy;
}

/** Fully resolved model config ready for LLM call */
export interface ResolvedModel {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
}
