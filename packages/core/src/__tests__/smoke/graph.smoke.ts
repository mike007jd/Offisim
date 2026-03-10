import type { LlmProvider, ModelPolicyConfig } from '@aics/shared-types';
import { HumanMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { buildAicsGraph } from '../../graph/main-graph.js';
import { createGateway } from '../../llm/gateway-factory.js';
import type { LlmGateway } from '../../llm/gateway.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import { makeEmployee, makeManager } from '../helpers/fixtures.js';

// --- Auto-detect first available provider ---
interface SmokeProvider {
  name: string;
  gateway: LlmGateway;
  provider: LlmProvider;
  model: string;
}

function detectProvider(): SmokeProvider | null {
  // Gemini first — more capable for structured graph output than free-tier models
  if (process.env.GEMINI_API_KEY) {
    return {
      name: 'Gemini',
      gateway: createGateway({
        provider: 'openai-compat',
        apiKey: process.env.GEMINI_API_KEY,
        baseURL:
          process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai/',
      }),
      provider: 'openai-compat',
      model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return {
      name: 'OpenRouter',
      gateway: createGateway({
        provider: 'openai-compat',
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      }),
      provider: 'openai-compat',
      model: process.env.OPENROUTER_MODEL ?? 'google/gemma-3-4b-it:free',
    };
  }
  if (process.env.KIMI_API_KEY) {
    return {
      name: 'Kimi',
      gateway: createGateway({
        provider: 'openai-compat',
        apiKey: process.env.KIMI_API_KEY,
        baseURL: process.env.KIMI_BASE_URL ?? 'https://api.kimi.com/coding/v1',
        defaultHeaders: { 'User-Agent': 'claude-code/1.0.0' },
      }),
      provider: 'openai-compat',
      model: process.env.KIMI_MODEL ?? 'kimi-for-coding',
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      name: 'Anthropic',
      gateway: createGateway({
        provider: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY,
      }),
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      name: 'OpenAI',
      gateway: createGateway({
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
      }),
      provider: 'openai',
      model: 'gpt-4o-mini',
    };
  }
  return null;
}

const smokeProvider = detectProvider();

function createSmokeRuntime() {
  if (!smokeProvider) throw new Error('No provider detected');

  const policy: ModelPolicyConfig = {
    default: {
      profileName: 'smoke',
      provider: smokeProvider.provider,
      model: smokeProvider.model,
      temperature: 0.7,
      maxTokens: 4096,
    },
  };

  const repos = createMemoryRepositories();
  const eventBus = new InMemoryEventBus();
  const resolver = new ModelResolver(policy);
  const toolExecutor = new MockToolExecutor();
  const companyId = 'c-smoke-1';

  repos.seed.companies([
    {
      company_id: companyId,
      name: 'Smoke Test Corp',
      status: 'active',
      workspace_root: null,
      default_model_policy_json: JSON.stringify(policy),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]);
  repos.seed.employees([
    makeManager({ company_id: companyId }),
    makeEmployee({ company_id: companyId }),
  ]);

  const threadId = `t-smoke-${Date.now()}`;
  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus,
    llmGateway: smokeProvider.gateway,
    modelResolver: resolver,
    toolExecutor,
    companyId,
    threadId,
  });

  const graph = buildAicsGraph();
  return { graph, repos, runtimeCtx, threadId, companyId };
}

describe.skipIf(!smokeProvider)(`full graph smoke — ${smokeProvider?.name ?? 'none'}`, () => {
  it('boss_chat completes and persists all expected records', async () => {
    const { graph, repos, runtimeCtx, threadId } = createSmokeRuntime();

    const result = await graph.invoke(
      {
        threadId,
        companyId: runtimeCtx.companyId,
        entryMode: 'boss_chat' as const,
        messages: [new HumanMessage('Write a simple project plan for a TODO app')],
      },
      { configurable: { thread_id: threadId, runtimeCtx } },
    );

    // Structural assertions
    expect(result.completed).toBe(true);

    const taskRuns = await repos.taskRuns.findByThread(threadId);
    expect(taskRuns.length).toBeGreaterThan(0);

    const handoffs = await repos.handoffs.findByThread(threadId);
    expect(handoffs.length).toBeGreaterThan(0);

    const llmCalls = await repos.llmCalls.findByThread(threadId);
    expect(llmCalls.length).toBeGreaterThan(0);
    // Token count may be 0 for compat providers without stream_options support
    expect(llmCalls.every((c) => c.latency_ms != null && c.latency_ms >= 0)).toBe(true);
  }, 120_000);
});
