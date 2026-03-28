import type { LlmProvider } from '@offisim/shared-types';
import { Logger } from '../services/logger.js';
import type { LlmGateway } from './gateway.js';
import { createGateway, type GatewayConfig } from './gateway-factory.js';

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
  /** Whether this is the default model */
  isDefault?: boolean;
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
export class ModelRegistry {
  private entries = new Map<string, ModelRegistryEntry>();
  private gateways = new Map<string, LlmGateway>();
  private defaultId: string | null = null;

  /** Load models from parsed config. Does not do file I/O. */
  loadConfig(config: ModelRegistryConfig): void {
    if (config.version !== '1.0') {
      logger.warn(`Unknown model registry config version: ${config.version}`);
    }

    // Dispose previous gateways before clearing
    this.disposeAll();
    this.entries.clear();
    this.defaultId = null;

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
      if (resolved.isDefault) {
        this.defaultId = resolved.id;
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

    const entry = this.entries.get(modelId);
    if (!entry) return null;

    const gatewayConfig: GatewayConfig = {
      provider: entry.provider,
      apiKey: entry.apiKey,
      baseURL: entry.baseURL,
      defaultHeaders: entry.defaultHeaders,
      dangerouslyAllowBrowser: true,
    };

    try {
      const gateway = createGateway(gatewayConfig);
      this.gateways.set(modelId, gateway);
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
    return this.entries.get(modelId) ?? null;
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
}
