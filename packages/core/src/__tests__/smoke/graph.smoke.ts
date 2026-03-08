import { describe, it, expect } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import { AnthropicAdapter } from '../../llm/anthropic-adapter.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { buildAicsGraph } from '../../graph/main-graph.js';
import { TEST_COMPANY, TEST_COMPANY_ID, makeEmployee, makeManager } from '../helpers/fixtures.js';

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

function createSmokeRuntime() {
  const repos = createMemoryRepositories();
  const eventBus = new InMemoryEventBus();
  const gateway = new AnthropicAdapter(process.env.ANTHROPIC_API_KEY!);
  const resolver = new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json!));
  const toolExecutor = new MockToolExecutor();

  repos.seed.companies([TEST_COMPANY]);
  repos.seed.employees([makeManager(), makeEmployee()]);

  const threadId = `t-smoke-${Date.now()}`;
  const runtimeCtx = createRuntimeContext({
    repos, eventBus, llmGateway: gateway, modelResolver: resolver,
    toolExecutor, companyId: TEST_COMPANY_ID, threadId,
  });

  const graph = buildAicsGraph();
  return { graph, repos, runtimeCtx, threadId };
}

describe.skipIf(!HAS_API_KEY)('full graph smoke (live API)', () => {
  it('boss_chat completes and persists all expected records', async () => {
    const { graph, repos, runtimeCtx, threadId } = createSmokeRuntime();

    const result = await graph.invoke(
      {
        threadId,
        companyId: TEST_COMPANY_ID,
        entryMode: 'boss_chat' as const,
        messages: [new HumanMessage('Write a simple project plan for a TODO app')],
      },
      { configurable: { thread_id: threadId, runtimeCtx } },
    );

    // Structural assertions — 100% deterministic
    expect(result.completed).toBe(true);

    const taskRuns = await repos.taskRuns.findByThread(threadId);
    expect(taskRuns.length).toBeGreaterThan(0);

    const handoffs = await repos.handoffs.findByThread(threadId);
    expect(handoffs.length).toBeGreaterThan(0);

    const llmCalls = await repos.llmCalls.findByThread(threadId);
    expect(llmCalls.length).toBeGreaterThan(0);
    expect(llmCalls.every(c => c.input_tokens > 0)).toBe(true);
    expect(llmCalls.every(c => c.latency_ms != null && c.latency_ms >= 0)).toBe(true);
  }, 120000);
});
