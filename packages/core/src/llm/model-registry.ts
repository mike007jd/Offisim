import type { LlmProvider } from '@offisim/shared-types';
import { Logger } from '../services/logger.js';
import { type GatewayConfig, createGateway } from './gateway-factory.js';
import type { LlmGateway } from './gateway.js';

const logger = new Logger('model-registry');

export interface ModelRegistryConfig {
  version: '1.0';
  models: ModelRegistryEntry[];
}

export interface ModelRegistryEntry {
  /** Unique ID, e.g. "gpt-4o", "claude-opus" */
  id: string;
  /** Human-readable name */
  displayName: string;
  /** Provider adapter type — must match a known LlmProvider */
  provider: LlmProvider;
  /** Model name passed to the adapter */
  model: string;
  /** API key — supports $ENV_VAR and literal values */
  apiKey: string;
  /** For openai-compat providers */
  baseURL?: string;
  /** Extra headers */
  defaultHeaders?: Record<string, string>;
  /** Default temperature */
  temperature?: number;
  /** Default max tokens */
  maxTokens?: number;
  /** Real model context window used by conversation budgeting */
  contextWindow?: number;
  /** Provider supports Anthropic prompt-cache cache_control blocks */
  supportsPromptCaching?: boolean;
  /** Whether this is the default model */
  isDefault?: boolean;
  /** Use as deterministic fallback when another profile repeatedly hits provider capacity. */
  fallbackForCapacity?: boolean;
}

/**
 * Config-driven model catalog.
 *
 * Separation of concerns:
 * - ModelRegistry: "what models are available?" (catalog) — JSON config
 * - ModelResolver: "which model should this employee use?" (policy) — DB
 *
 * The registry owns gateway lifecycle: gateways are created lazily and
 * cached until `disposeAll()` is called.
 */
export interface ModelRegistryOptions {
  /**
   * Credential-isolated transport that every gateway built by `getGateway`
   * MUST use. This is legacy testing/factory infrastructure; the active
   * desktop product now delegates provider auth/model execution to the
   * official Pi Agent Host. When omitted, `getGateway` refuses to build a real
   * gateway (fails closed), preventing accidental raw-key SDK clients in any
   * remaining compatibility path.
   *
   * Any future production wiring for this legacy registry must pass
   * `transportFetch` here.
   */
  transportFetch?: typeof fetch;
}

export class ModelRegistry {
  private entries = new Map<string, ModelRegistryEntry>();
  private entriesByModel = new Map<string, ModelRegistryEntry>();
  private gateways = new Map<string, LlmGateway>();
  private defaultId: string | null = null;
  private capacityFallbackId: string | null = null;
  private capacityFailures = new Map<string, number>();
  private readonly capacityFailureThreshold = 2;
  private readonly transportFetch?: typeof fetch;

  constructor(options: ModelRegistryOptions = {}) {
    this.transportFetch = options.transportFetch;
  }

  /** Load models from parsed config. Does not do file I/O. */
  loadConfig(config: ModelRegistryConfig): void {
    if (config.version !== '1.0') {
      logger.warn(`Unknown model registry config version: ${config.version}`);
    }

    // Dispose previous gateways before clearing
    this.disposeAll();
    this.entries.clear();
    this.entriesByModel.clear();
    this.capacityFailures.clear();
    this.defaultId = null;
    this.capacityFallbackId = null;

    for (const entry of config.models) {
      if (!entry.id || !entry.provider || !entry.model) {
        logger.warn(`Skipping invalid model entry: ${JSON.stringify(entry)}`);
        continue;
      }
      // Resolve env vars in apiKey
      const resolved: ModelRegistryEntry = {
        ...entry,
        apiKey: this.resolveEnvVars(entry.apiKey),
      };
      this.entries.set(resolved.id, resolved);
      if (!this.entriesByModel.has(resolved.model)) {
        this.entriesByModel.set(resolved.model, resolved);
      }
      if (resolved.isDefault) {
        this.defaultId = resolved.id;
      }
      if (resolved.fallbackForCapacity === true && !this.capacityFallbackId) {
        this.capacityFallbackId = resolved.id;
      }
    }

    logger.info(`Loaded ${this.entries.size} models`, {
      ids: [...this.entries.keys()],
      defaultId: this.defaultId,
    });
  }

  /**
   * Get or create a gateway for a specific model ID. Gateways are cached.
   *
   * Note: temperature and maxTokens from the registry entry are not baked
   * into the gateway — they live on the entry and should be applied at
   * call-site via LlmRequest. Use `findById()` to read them.
   */
  getGateway(modelId: string): LlmGateway | null {
    const cached = this.gateways.get(modelId);
    if (cached) return cached;

    const entry = this.entryOrFallback(modelId);
    if (!entry) return null;
    const cacheKey = entry.id;
    const fallbackCached = this.gateways.get(cacheKey);
    if (fallbackCached) return fallbackCached;

    // Fail closed: never build a gateway holding the raw apiKey on a default
    // fetch. A real gateway requires the credential-isolated transport.
    if (!this.transportFetch) {
      logger.error(
        `Refusing to build gateway for model "${modelId}": no credential-isolated transport configured (construct ModelRegistry with { transportFetch }).`,
      );
      return null;
    }

    const gatewayConfig: GatewayConfig = {
      provider: entry.provider,
      apiKey: entry.apiKey,
      baseURL: entry.baseURL,
      defaultHeaders: entry.defaultHeaders,
      supportsPromptCaching: entry.supportsPromptCaching,
      dangerouslyAllowBrowser: true,
      fetch: this.transportFetch,
    };

    try {
      const gateway = createGateway(gatewayConfig);
      this.gateways.set(cacheKey, gateway);
      // Also cache under the requested alias so repeat lookups hit the
      // top-level cache instead of re-running entryOrFallback (and re-warning).
      if (modelId !== cacheKey) {
        this.gateways.set(modelId, gateway);
      }
      return gateway;
    } catch (err) {
      logger.error(`Failed to create gateway for model "${modelId}"`, err);
      return null;
    }
  }

  /** List all registered model entries. */
  listModels(): ModelRegistryEntry[] {
    return [...this.entries.values()];
  }

  /** Get the default model entry (if any). */
  getDefault(): ModelRegistryEntry | null {
    if (!this.defaultId) return null;
    return this.entries.get(this.defaultId) ?? null;
  }

  /** Find a model by ID. */
  findById(modelId: string): ModelRegistryEntry | null {
    return this.entryByIdOrModel(modelId);
  }

  resolveForRequest(modelId: string): ModelRegistryEntry | null {
    if ((this.capacityFailures.get(modelId) ?? 0) >= this.capacityFailureThreshold) {
      const fallback = this.capacityFallbackEntry(modelId);
      if (fallback) {
        logger.warn(
          `Model "${modelId}" has repeated capacity failures; downgrading to "${fallback.id}"`,
        );
        return fallback;
      }
    }
    return this.entryOrFallback(modelId);
  }

  recordCapacityError(modelId: string): ModelRegistryEntry | null {
    const key = this.entryByIdOrModel(modelId)?.id ?? modelId;
    const next = (this.capacityFailures.get(key) ?? 0) + 1;
    this.capacityFailures.set(key, next);
    if (next < this.capacityFailureThreshold) return null;
    return this.capacityFallbackEntry(key);
  }

  recordSuccess(modelId: string): void {
    const key = this.entryByIdOrModel(modelId)?.id ?? modelId;
    this.capacityFailures.delete(key);
  }

  /** Dispose all cached gateways. */
  disposeAll(): void {
    for (const gw of this.gateways.values()) {
      gw.dispose();
    }
    this.gateways.clear();
  }

  /**
   * Resolve environment variable references in a string.
   * - "$API_KEY" → process.env.API_KEY
   * - Literal strings pass through unchanged
   */
  resolveEnvVars(value: string): string {
    if (!value) return value;
    // $ENV_VAR pattern (must be the entire string, not ${...} template)
    if (value.startsWith('$') && !value.startsWith('${')) {
      const envName = value.slice(1);
      const resolved = typeof process !== 'undefined' ? process.env[envName] : undefined;
      if (!resolved) {
        logger.warn(`Environment variable ${envName} not found for model config`);
        return '';
      }
      return resolved;
    }
    return value;
  }

  private entryOrFallback(modelId: string): ModelRegistryEntry | null {
    const entry = this.entryByIdOrModel(modelId);
    if (entry) return entry;
    const fallback = this.getDefault() ?? this.entries.values().next().value ?? null;
    if (fallback) {
      logger.warn(`Model "${modelId}" not registered; falling back to "${fallback.id}"`);
    }
    return fallback;
  }

  private capacityFallbackEntry(modelId: string): ModelRegistryEntry | null {
    const explicit = this.capacityFallbackId ? this.entries.get(this.capacityFallbackId) : null;
    if (explicit?.id === modelId) return this.defaultFallbackEntry(modelId);
    if (explicit) return explicit;
    return this.defaultFallbackEntry(modelId);
  }

  private entryByIdOrModel(modelId: string): ModelRegistryEntry | null {
    return this.entries.get(modelId) ?? this.entriesByModel.get(modelId) ?? null;
  }

  private defaultFallbackEntry(modelId: string): ModelRegistryEntry | null {
    const defaultEntry = this.getDefault();
    if (defaultEntry && defaultEntry.id !== modelId) return defaultEntry;
    for (const entry of this.entries.values()) {
      if (entry.id !== modelId) return entry;
    }
    return null;
  }
}
