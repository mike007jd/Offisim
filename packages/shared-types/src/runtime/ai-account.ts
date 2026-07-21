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

export type AiModelSource =
  | {
      readonly kind: 'official-api';
      readonly sourceUrl: string;
      readonly checkedAt: string;
    }
  | {
      /** The engine itself owns model/version discovery. No fabricated catalog
       * URL or check timestamp may be attached to this native identity. */
      readonly kind: 'native';
      readonly sourceUrl?: never;
      readonly checkedAt?: never;
    };

export type RuntimeEnginePermissionMode = 'plan' | 'ask' | 'auto' | 'full';

export type RuntimeInteractionRouteSource = 'engine-native' | 'offisim-local' | 'mcp';

/** One interaction path an engine lane can expose. `runtime-determined` means
 * the engine supports the route but live machine state (for example the local
 * desktop driver) decides whether it is ready for this run. */
export interface RuntimeInteractionRoute {
  readonly id: string;
  readonly source: RuntimeInteractionRouteSource;
  readonly label: string;
  readonly availability: 'available' | 'runtime-determined' | 'setup-required' | 'unsupported';
  readonly reason?: string;
}

/** Product controls and event projections that one runtime actually supports. */
export interface RuntimeEngineCapabilityManifest {
  readonly stop: boolean;
  readonly steer: boolean;
  readonly resume: boolean;
  readonly attachmentInput: {
    /** Text/code/document files are parsed by Offisim and sent as bounded text context. */
    readonly textFiles: boolean;
    /** API engines still defer native image truth to the exact model catalog row. */
    readonly images: 'supported' | 'model-dependent' | 'unsupported';
  };
  readonly permissionModes: readonly RuntimeEnginePermissionMode[];
  readonly interactions: {
    readonly approval: boolean;
    readonly userInput: boolean;
  };
  readonly processEvents: {
    readonly reasoning: boolean;
    readonly toolCalls: boolean;
    readonly fileChanges: boolean;
  };
  /** Explicit route truth. Product surfaces must not infer native Browser or
   * Computer Use support from an engine brand name. */
  readonly interactionRoutes: {
    readonly browser: readonly RuntimeInteractionRoute[];
    readonly computer: readonly RuntimeInteractionRoute[];
  };
}

/** Safe status projection for an external CLI orchestration engine. Credentials,
 * account health, model catalogs, and subscription usage never cross this seam. */
export interface OrchestrationEngineStatus {
  readonly engineId: string;
  readonly displayName: string;
  readonly state: 'not-installed' | 'not-signed-in' | 'ready' | 'unavailable';
  readonly version?: string;
  readonly statusReason?: string;
  readonly loginCommand: string;
  readonly docsUrl: string;
  /** Official source used to verify this adapter's CLI orchestration contract. */
  readonly sourceUrl?: string;
  readonly checkedAt: string;
  readonly capabilities: RuntimeEngineCapabilityManifest;
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
  /** Optional for user-authored Pi provider/model entries. When present,
   * official sources remain fully verified; orchestration engines use native. */
  readonly source?: AiModelSource;
}

/** Exact execution selection frozen before a run crosses its paid side-effect boundary. */
export interface AiExecutionTarget {
  readonly engineId: string;
  readonly accountId: string;
  readonly billingMode: AiBillingMode;
  readonly modelId: string;
  /** User-authored API models may omit provenance. Subscription orchestration
   * targets must carry the engine-owned native identity. */
  readonly modelSource?: AiModelSource;
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
  readonly orchestrationEngines: readonly OrchestrationEngineStatus[];
  readonly checkedAt: string;
}
