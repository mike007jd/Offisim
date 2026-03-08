import { describe, it, expect } from 'vitest';
import { recordedLlmCall, recordedLlmStream } from '../../llm/recorded-call.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { MockLlmGateway } from '../helpers/mock-gateway.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { TEST_COMPANY } from '../helpers/fixtures.js';
import type { RuntimeEvent } from '@aics/shared-types';

function makeCtx() {
  const repos = createMemoryRepositories();
  const eventBus = new InMemoryEventBus();
  const gateway = new MockLlmGateway();
  const resolver = new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json!));
  repos.seed.companies([TEST_COMPANY]);

  const events: RuntimeEvent<any>[] = [];
  eventBus.on('', (e) => events.push(e));

  const runtimeCtx = createRuntimeContext({
    repos, eventBus, llmGateway: gateway, modelResolver: resolver,
    toolExecutor: new MockToolExecutor(), companyId: 'c-test-1', threadId: 't-1',
  });

  return { runtimeCtx, gateway, events, repos };
}

describe('recordedLlmCall', () => {
  it('records llm_call row with usage and latency', async () => {
    const { runtimeCtx, gateway, repos } = makeCtx();
    gateway.pushResponse({ content: 'hello', usage: { inputTokens: 50, outputTokens: 20 } });

    const response = await recordedLlmCall(runtimeCtx, {
      messages: [{ role: 'user', content: 'hi' }],
      model: 'claude-sonnet-4-20250514',
    }, { nodeName: 'boss', provider: 'anthropic', model: 'claude-sonnet-4-20250514' });

    expect(response.content).toBe('hello');

    const calls = await repos.llmCalls.findByThread('t-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input_tokens).toBe(50);
    expect(calls[0]!.output_tokens).toBe(20);
    expect(calls[0]!.node_name).toBe('boss');
    expect(calls[0]!.latency_ms).toBeGreaterThanOrEqual(0);
    expect(calls[0]!.error_code).toBeNull();
  });

  it('emits llm.call.started and llm.call.completed events', async () => {
    const { runtimeCtx, gateway, events } = makeCtx();
    gateway.pushResponse({ content: 'ok' });

    await recordedLlmCall(runtimeCtx, {
      messages: [{ role: 'user', content: 'test' }],
      model: 'test',
    }, { nodeName: 'employee', provider: 'anthropic', model: 'test' });

    const started = events.filter((e) => e.type === 'llm.call.started');
    const completed = events.filter((e) => e.type === 'llm.call.completed');
    const usage = events.filter((e) => e.type === 'llm.usage.recorded');

    expect(started).toHaveLength(1);
    expect(completed).toHaveLength(1);
    expect(usage).toHaveLength(1);
  });

  it('records error_code on failure', async () => {
    const { runtimeCtx, gateway, repos } = makeCtx();
    gateway.pushResponse({ content: '' }); // won't be used
    // Override chat to throw
    gateway.chat = async () => { throw new Error('boom'); };

    await expect(
      recordedLlmCall(runtimeCtx, {
        messages: [{ role: 'user', content: 'fail' }],
        model: 'test',
      }, { nodeName: 'boss', provider: 'anthropic', model: 'test' }),
    ).rejects.toThrow('boom');

    const calls = await repos.llmCalls.findByThread('t-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.error_code).toBe('boom');
  });
});

describe('recordedLlmStream', () => {
  it('records llm_call row after stream completes', async () => {
    const { runtimeCtx, gateway, repos } = makeCtx();
    gateway.pushStreamResponse({ content: 'streamed hello', usage: { inputTokens: 30, outputTokens: 15 } });

    const chunks: any[] = [];
    const result = await recordedLlmStream(runtimeCtx, {
      messages: [{ role: 'user', content: 'hi' }],
      model: 'claude-sonnet-4-20250514',
    }, { nodeName: 'boss_summary', provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    (chunk) => chunks.push(chunk));

    expect(result.fullContent).toContain('streamed');
    expect(chunks.length).toBeGreaterThan(0);

    const calls = await repos.llmCalls.findByThread('t-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input_tokens).toBe(30);
    expect(calls[0]!.output_tokens).toBe(15);
    expect(calls[0]!.node_name).toBe('boss_summary');
  });

  it('emits all three LLM events for streaming calls', async () => {
    const { runtimeCtx, gateway, events } = makeCtx();
    gateway.pushStreamResponse({ content: 'ok', usage: { inputTokens: 10, outputTokens: 5 } });

    await recordedLlmStream(runtimeCtx, {
      messages: [{ role: 'user', content: 'test' }],
      model: 'test',
    }, { nodeName: 'boss_summary', provider: 'anthropic', model: 'test' }, () => {});

    expect(events.filter(e => e.type === 'llm.call.started')).toHaveLength(1);
    expect(events.filter(e => e.type === 'llm.call.completed')).toHaveLength(1);
    expect(events.filter(e => e.type === 'llm.usage.recorded')).toHaveLength(1);
  });

  it('records error on stream failure', async () => {
    const { runtimeCtx, gateway, repos } = makeCtx();
    // Make chatStream throw
    (gateway as any).chatStream = async function* () { throw new Error('stream fail'); };

    await expect(
      recordedLlmStream(runtimeCtx, {
        messages: [{ role: 'user', content: 'fail' }],
        model: 'test',
      }, { nodeName: 'boss_summary', provider: 'anthropic', model: 'test' }, () => {}),
    ).rejects.toThrow('stream fail');

    const calls = await repos.llmCalls.findByThread('t-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.error_code).toBe('stream fail');
  });
});
