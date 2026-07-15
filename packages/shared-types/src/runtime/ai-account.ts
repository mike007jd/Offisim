export type AiBillingMode = 'api' | 'subscription';

export type AiCapabilityState =
  | { readonly status: 'available' }
  | { readonly status: 'unavailable'; readonly reason: string };

export interface AiAccountCapabilities {
  readonly execute: AiCapabilityState;
  readonly models: AiCapabilityState;
  readonly usage: AiCapabilityState;
  readonly cost: AiCapabilityState;
}

export interface AiSubscriptionUsageWindow {
  readonly kind: 'primary' | 'secondary' | 'spendControl';
  readonly windowDurationMins?: number;
  readonly used: number | string;
  readonly remaining: number | string;
  readonly remainingIsDerived: boolean;
  readonly resetAt?: string;
  readonly limit?: number | string;
}

export interface AiSubscriptionUsageLimit {
  readonly limitId: string;
  readonly label: string;
  readonly planType?: string;
  readonly reachedType?: string;
  readonly windows: readonly AiSubscriptionUsageWindow[];
  readonly credits?: number | string;
}

export interface AiSubscriptionUsageActivity {
  readonly lifetimeTokens?: number;
  readonly peakDailyTokens?: number;
  readonly longestRunningTurnSec?: number;
  readonly currentStreakDays?: number;
  readonly longestStreakDays?: number;
}

/** Provider-native subscription usage. Every native limit bucket and window
 * stays distinct; derived remaining percentages are labelled, and subscription
 * activity is never converted to API cost. */
export interface AiSubscriptionUsageSnapshot {
  readonly kind: 'subscription';
  readonly source: 'native';
  readonly limits: readonly AiSubscriptionUsageLimit[];
  /** Provider-issued rate-limit reset credits, distinct from plan credit balance. */
  readonly resetCredits?: number | string;
  readonly activity?: AiSubscriptionUsageActivity;
  readonly updatedAt?: string;
}

export interface AiAccountDescriptor {
  readonly engineId: string;
  readonly accountId: string;
  readonly billingMode: AiBillingMode;
  readonly displayName: string;
  readonly status: 'available' | 'unavailable';
  readonly statusReason?: string;
  readonly capabilities: AiAccountCapabilities;
  readonly usage?: AiSubscriptionUsageSnapshot;
}

export interface AiModelSource {
  readonly kind: 'official-api' | 'native';
  readonly sourceUrl: string;
  readonly checkedAt: string;
}

export interface AiModelCapabilities {
  readonly textInput: boolean;
  readonly imageInput: boolean;
  readonly tools: boolean;
  readonly reasoning: boolean;
}

export interface AiModelPricing {
  readonly currency: 'USD';
  readonly inputPerMillion?: number;
  readonly outputPerMillion?: number;
  readonly cacheReadPerMillion?: number;
  readonly cacheWritePerMillion?: number;
  readonly sourceUrl: string;
  readonly checkedAt: string;
}

/** Native reasoning preset reported for one exact catalog selector. */
interface AiModelReasoningEffort {
  readonly id: string;
  readonly description?: string;
}

export interface AiModelCatalogEntry {
  readonly engineId: string;
  readonly accountId: string;
  readonly billingMode: AiBillingMode;
  readonly modelId: string;
  readonly displayName: string;
  /** Adapter-private registry selector. Product UI must never display it. */
  readonly runtimeModelRef: string;
  readonly availability: 'available' | 'expiring' | 'unavailable';
  readonly availabilityReason?: string;
  readonly expiresAt?: string;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly defaultReasoningEffort?: string;
  readonly reasoningEfforts?: readonly AiModelReasoningEffort[];
  readonly capabilities: AiModelCapabilities;
  readonly pricing?: AiModelPricing;
  readonly source: AiModelSource;
}

/** Exact execution selection frozen before a run crosses its paid side-effect boundary. */
export interface AiExecutionTarget {
  readonly engineId: string;
  readonly accountId: string;
  readonly billingMode: AiBillingMode;
  readonly modelId: string;
  readonly modelSource: AiModelSource;
}

export interface TurnExecutionProvenance extends AiExecutionTarget {
  readonly runId: string;
  /** Exact native selector used for this Turn. Preserves preset identity when leaves match. */
  readonly runtimeModelRef?: string;
  /** Diagnostic-only implementation identity; never a product/account label. */
  readonly adapter?: {
    readonly id: string;
    readonly version: string;
  };
}

export interface AiRuntimeStatus {
  readonly accounts: readonly AiAccountDescriptor[];
  readonly models: readonly AiModelCatalogEntry[];
  readonly checkedAt: string;
}
