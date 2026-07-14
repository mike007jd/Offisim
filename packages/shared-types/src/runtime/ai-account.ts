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

export interface AiAccountDescriptor {
  readonly engineId: string;
  readonly accountId: string;
  readonly billingMode: AiBillingMode;
  readonly displayName: string;
  readonly status: 'available' | 'unavailable';
  readonly statusReason?: string;
  readonly capabilities: AiAccountCapabilities;
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
