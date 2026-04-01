import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmGateway } from '../../llm/gateway.js';
import { ModelRegistry, type ModelRegistryConfig } from '../../llm/model-registry.js';

// Mock createGateway so we don't need real LLM adapters
const mockDispose = vi.fn();
const mockGateway: LlmGateway = {
  chat: vi.fn(),
  chatStream: vi.fn() as unknown as LlmGateway['chatStream'],
  dispose: mockDispose,
};

vi.mock('../../llm/gateway-factory.js', () => ({
  createGateway: vi.fn(() => mockGateway),
}));

function makeConfig(overrides?: Partial<ModelRegistryConfig>): ModelRegistryConfig {
  return {
    version: '1.0',
    models: [
      {
        id: 'gpt-4o',
        displayName: 'GPT-4o',
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test-key',
        temperature: 0.7,
        maxTokens: 4096,
      },
      {
        id: 'claude-opus',
        displayName: 'Claude Opus',
        provider: 'anthropic',
        model: 'claude-opus-4-20250514',
        apiKey: 'anthropic-test-key',
        isDefault: true,
      },
      {
        id: 'ollama-local',
        displayName: 'Ollama Local',
        provider: 'openai-compat',
        model: 'llama3',
        apiKey: 'ollama',
        baseURL: 'http://localhost:11434/v1',
      },
    ],
    ...overrides,
  };
}

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  beforeEach(() => {
    registry = new ModelRegistry();
    vi.clearAllMocks();
  });

  describe('loadConfig', () => {
    it('loads valid entries', () => {
      registry.loadConfig(makeConfig());

      expect(registry.listModels()).toHaveLength(3);
      expect(registry.findById('gpt-4o')).toBeTruthy();
      expect(registry.findById('claude-opus')).toBeTruthy();
      expect(registry.findById('ollama-local')).toBeTruthy();
    });

    it('skips entries missing required fields', () => {
      const config = makeConfig({
        models: [
          {
            id: 'valid',
            displayName: 'Valid',
            provider: 'openai',
            model: 'gpt-4o',
            apiKey: 'key',
          },
          // Missing provider
          {
            id: 'invalid',
            displayName: 'Invalid',
            provider: '' as 'openai',
            model: 'gpt-4o',
            apiKey: 'key',
          },
        ],
      });

      registry.loadConfig(config);
      expect(registry.listModels()).toHaveLength(1);
      expect(registry.findById('valid')).toBeTruthy();
      expect(registry.findById('invalid')).toBeNull();
    });

    it('clears previous entries and gateways on reload', () => {
      registry.loadConfig(makeConfig());
      // Create a cached gateway
      registry.getGateway('gpt-4o');

      // Reload with different config
      registry.loadConfig(
        makeConfig({
          models: [
            {
              id: 'new-model',
              displayName: 'New',
              provider: 'openai',
              model: 'gpt-4o-mini',
              apiKey: 'key',
            },
          ],
        }),
      );

      expect(mockDispose).toHaveBeenCalled();
      expect(registry.findById('gpt-4o')).toBeNull();
      expect(registry.findById('new-model')).toBeTruthy();
      expect(registry.listModels()).toHaveLength(1);
    });
  });

  describe('getGateway', () => {
    it('creates and caches a gateway', async () => {
      const { createGateway } = await import('../../llm/gateway-factory.js');
      registry.loadConfig(makeConfig());

      const gw1 = registry.getGateway('gpt-4o');
      const gw2 = registry.getGateway('gpt-4o');

      expect(gw1).toBe(mockGateway);
      expect(gw2).toBe(gw1); // cached
      expect(createGateway).toHaveBeenCalledTimes(1);
      expect(createGateway).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          apiKey: 'sk-test-key',
          dangerouslyAllowBrowser: true,
        }),
      );
    });

    it('returns null for unknown model', () => {
      registry.loadConfig(makeConfig());
      expect(registry.getGateway('nonexistent')).toBeNull();
    });

    it('passes baseURL and defaultHeaders for openai-compat', async () => {
      const { createGateway } = await import('../../llm/gateway-factory.js');
      registry.loadConfig(makeConfig());

      registry.getGateway('ollama-local');

      expect(createGateway).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai-compat',
          baseURL: 'http://localhost:11434/v1',
        }),
      );
    });

    it('returns null and logs error when createGateway throws', async () => {
      const { createGateway } = await import('../../llm/gateway-factory.js');
      vi.mocked(createGateway).mockImplementationOnce(() => {
        throw new Error('adapter init failed');
      });

      registry.loadConfig(makeConfig());
      const gw = registry.getGateway('gpt-4o');

      expect(gw).toBeNull();
    });
  });

  describe('listModels', () => {
    it('returns all entries as array', () => {
      registry.loadConfig(makeConfig());
      const models = registry.listModels();

      expect(models).toHaveLength(3);
      expect(models.map((m) => m.id)).toEqual(['gpt-4o', 'claude-opus', 'ollama-local']);
    });

    it('returns empty array when no config loaded', () => {
      expect(registry.listModels()).toEqual([]);
    });
  });

  describe('getDefault', () => {
    it('returns the entry marked isDefault', () => {
      registry.loadConfig(makeConfig());
      const def = registry.getDefault();

      expect(def).toBeTruthy();
      if (!def) throw new Error('Expected default model');
      expect(def.id).toBe('claude-opus');
      expect(def.provider).toBe('anthropic');
    });

    it('returns null when no default is set', () => {
      registry.loadConfig(
        makeConfig({
          models: [
            {
              id: 'no-default',
              displayName: 'No Default',
              provider: 'openai',
              model: 'gpt-4o',
              apiKey: 'key',
            },
          ],
        }),
      );

      expect(registry.getDefault()).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns the matching entry', () => {
      registry.loadConfig(makeConfig());
      const entry = registry.findById('ollama-local');

      expect(entry).toBeTruthy();
      if (!entry) throw new Error('Expected ollama-local entry');
      expect(entry.model).toBe('llama3');
      expect(entry.baseURL).toBe('http://localhost:11434/v1');
    });

    it('returns null for missing id', () => {
      registry.loadConfig(makeConfig());
      expect(registry.findById('missing')).toBeNull();
    });
  });

  describe('resolveEnvVars', () => {
    it('resolves $VAR to process.env.VAR', () => {
      process.env.TEST_MODEL_API_KEY = 'resolved-secret';

      registry.loadConfig(
        makeConfig({
          models: [
            {
              id: 'env-model',
              displayName: 'Env Model',
              provider: 'openai',
              model: 'gpt-4o',
              apiKey: '$TEST_MODEL_API_KEY',
            },
          ],
        }),
      );

      const entry = registry.findById('env-model');
      if (!entry) throw new Error('Expected env-model entry');
      expect(entry.apiKey).toBe('resolved-secret');

      Reflect.deleteProperty(process.env, 'TEST_MODEL_API_KEY');
    });

    it('returns empty string when env var is not found', () => {
      Reflect.deleteProperty(process.env, 'NONEXISTENT_VAR');

      registry.loadConfig(
        makeConfig({
          models: [
            {
              id: 'missing-env',
              displayName: 'Missing Env',
              provider: 'openai',
              model: 'gpt-4o',
              apiKey: '$NONEXISTENT_VAR',
            },
          ],
        }),
      );

      const entry = registry.findById('missing-env');
      if (!entry) throw new Error('Expected missing-env entry');
      expect(entry.apiKey).toBe('');
    });

    it('passes literal strings through unchanged', () => {
      registry.loadConfig(makeConfig());
      const entry = registry.findById('gpt-4o');
      if (!entry) throw new Error('Expected gpt-4o entry');
      expect(entry.apiKey).toBe('sk-test-key');
    });

    it('does not treat ${...} as env var syntax', () => {
      const result = registry.resolveEnvVars('${NOT_ENV}');
      expect(result).toBe('${NOT_ENV}');
    });
  });

  describe('disposeAll', () => {
    it('disposes all cached gateways and clears cache', () => {
      registry.loadConfig(makeConfig());

      // Create two gateways
      registry.getGateway('gpt-4o');
      registry.getGateway('claude-opus');

      registry.disposeAll();

      expect(mockDispose).toHaveBeenCalledTimes(2);

      // After dispose, getGateway should create a new one
      vi.clearAllMocks();
      registry.getGateway('gpt-4o');
      expect(mockDispose).not.toHaveBeenCalled(); // fresh gateway, not disposed
    });
  });
});
