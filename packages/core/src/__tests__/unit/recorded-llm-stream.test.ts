/**
 * Tests for recordedLlmStream() — focused on coverage gaps not covered by recorded-call.test.ts.
 * The existing file covers happy-path, error-path, events, and onChunk.
 * This file adds: message-pruning verification and explicit onChunk accumulation.
 */
import type { LlmRequest, LlmStreamChunk } from '../../llm/gateway.js';
import { recordedLlmStream } from '../../llm/recorded-call.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import { TEST_COMPANY } from '../helpers/fixtures.js';
import { MockLlmGateway } from '../helpers/mock-gateway.js';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '@aics/shared-types';

function makeCtx() {
  const repos = createMemoryRepositories();
  const eventBus = new InMemoryEventBus();
  const gateway = new MockLlmGateway();
  const resolver = new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json!));
  repos.seed.companies([TEST_COMPANY]);

  // biome-ignore lint/suspicious/noExplicitAny: event collector captures all payload types
  const events: RuntimeEvent<any>[] = [];
  eventBus.on('', (e) => events.push(e));

  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus,
    llmGateway: gateway,
    modelResolver: resolver,
    toolExecutor: new MockToolExecutor(),
    companyId: 'c-test-1',
    threadId: 't-1',
  });

  return { runtimeCtx, gateway, events, repos };
}

describe('recordedLlmStream — message pruning', () => {
  it('prunes messages to ≤52 before forwarding to gateway when given 60+ messages', async () => {
    const { runtimeCtx, gateway } = makeCtx();

    // Spy on chatStream to capture the actual request
    const capturedRequests: LlmRequest[] = [];
    const originalChatStream = gateway.chatStream.bind(gateway);
    // biome-ignore lint/suspicious/noExplicitAny: spying on mock method
    (gateway as any).chatStream = async function* (req: LlmRequest) {
      capturedRequests.push(req);
      yield* originalChatStream(req);
    };
    gateway.pushStreamResponse({ content: 'ok', usage: { inputTokens: 10, outputTokens: 5 } });

    // Build 65 messages: 2 system + 63 user/assistant turns
    const messages: LlmRequest['messages'] = [
      { role: 'system', content: 'you are helpful' },
      { role: 'system', content: 'second system' },
      ...Array.from({ length: 63 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `message ${i}`,
      })),
    ];

    await recordedLlmStream(
      runtimeCtx,
      { messages, model: 'test' },
      { nodeName: 'boss', provider: 'anthropic', model: 'test' },
      () => {},
    );

    expect(capturedRequests).toHaveLength(1);
    const sentMessages = capturedRequests[0]!.messages;

    // Should have 2 system + 50 non-system = 52 total
    const systemCount = sentMessages.filter((m) => m.role === 'system').length;
    const nonSystemCount = sentMessages.filter((m) => m.role !== 'system').length;
    expect(systemCount).toBe(2);
    expect(nonSystemCount).toBe(50);
    expect(sentMessages.length).toBe(52);
  });

  it('passes message array unchanged when count is within limit', async () => {
    const { runtimeCtx, gateway } = makeCtx();

    const capturedRequests: LlmRequest[] = [];
    const originalChatStream = gateway.chatStream.bind(gateway);
    // biome-ignore lint/suspicious/noExplicitAny: spying on mock method
    (gateway as any).chatStream = async function* (req: LlmRequest) {
      capturedRequests.push(req);
      yield* originalChatStream(req);
    };
    gateway.pushStreamResponse({ content: 'short' });

    const messages: LlmRequest['messages'] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];

    await recordedLlmStream(
      runtimeCtx,
      { messages, model: 'test' },
      { nodeName: 'employee', provider: 'anthropic', model: 'test' },
      () => {},
    );

    expect(capturedRequests[0]!.messages).toHaveLength(3);
  });
});

describe('recordedLlmStream — onChunk callback', () => {
  it('receives all content chunks before the final done chunk', async () => {
    const { runtimeCtx, gateway } = makeCtx();
    gateway.pushStreamResponse({
      content: 'hello world foo',
      usage: { inputTokens: 8, outputTokens: 3 },
    });

    const chunks: LlmStreamChunk[] = [];
    await recordedLlmStream(
      runtimeCtx,
      { messages: [{ role: 'user', content: 'go' }], model: 'test' },
      { nodeName: 'boss_summary', provider: 'anthropic', model: 'test' },
      (chunk) => chunks.push(chunk),
    );

    // At minimum: content chunks + final done chunk
    expect(chunks.length).toBeGreaterThan(1);

    const contentChunks = chunks.filter((c) => c.content);
    expect(contentChunks.length).toBeGreaterThan(0);

    const finalChunk = chunks.at(-1);
    expect(finalChunk?.done).toBe(true);
    expect(finalChunk?.usage?.inputTokens).toBe(8);
    expect(finalChunk?.usage?.outputTokens).toBe(3);
  });

  it('onChunk is called even when stream has a single word', async () => {
    const { runtimeCtx, gateway } = makeCtx();
    gateway.pushStreamResponse({ content: 'ok', usage: { inputTokens: 1, outputTokens: 1 } });

    const callCount = vi.fn();
    await recordedLlmStream(
      runtimeCtx,
      { messages: [{ role: 'user', content: 'x' }], model: 'test' },
      { nodeName: 'boss', provider: 'anthropic', model: 'test' },
      callCount,
    );

    expect(callCount).toHaveBeenCalled();
  });
});

describe('recordedLlmStream — DB and events', () => {
  it('creates DB record with correct tokens and latency on success', async () => {
    const { runtimeCtx, gateway, repos } = makeCtx();
    gateway.pushStreamResponse({
      content: 'streamed result',
      usage: { inputTokens: 40, outputTokens: 12 },
    });

    await recordedLlmStream(
      runtimeCtx,
      { messages: [{ role: 'user', content: 'test' }], model: 'test' },
      { nodeName: 'pm_planner', provider: 'anthropic', model: 'test', taskRunId: 'tr-1' },
      () => {},
    );

    const calls = await repos.llmCalls.findByThread('t-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input_tokens).toBe(40);
    expect(calls[0]!.output_tokens).toBe(12);
    expect(calls[0]!.node_name).toBe('pm_planner');
    expect(calls[0]!.task_run_id).toBe('tr-1');
    expect(calls[0]!.error_code).toBeNull();
    expect(calls[0]!.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('creates DB record with error_code and re-throws on stream failure', async () => {
    const { runtimeCtx, gateway, repos } = makeCtx();
    // biome-ignore lint/suspicious/noExplicitAny: override mock method for error testing
    // biome-ignore lint/correctness/useYield: intentionally throws before yielding to test error path
    (gateway as any).chatStream = async function* () {
      throw new Error('network error');
    };

    await expect(
      recordedLlmStream(
        runtimeCtx,
        { messages: [{ role: 'user', content: 'fail' }], model: 'test' },
        { nodeName: 'employee', provider: 'anthropic', model: 'test' },
        () => {},
      ),
    ).rejects.toThrow('network error');

    const calls = await repos.llmCalls.findByThread('t-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.error_code).toBe('network error');
    expect(calls[0]!.input_tokens).toBe(0);
    expect(calls[0]!.output_tokens).toBe(0);
  });

  it('emits llm.call.started, llm.call.completed, and llm.usage.recorded events', async () => {
    const { runtimeCtx, gateway, events } = makeCtx();
    gateway.pushStreamResponse({ content: 'hi', usage: { inputTokens: 5, outputTokens: 2 } });

    await recordedLlmStream(
      runtimeCtx,
      { messages: [{ role: 'user', content: 'go' }], model: 'test' },
      { nodeName: 'boss', provider: 'anthropic', model: 'test' },
      () => {},
    );

    expect(events.filter((e) => e.type === 'llm.call.started')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'llm.call.completed')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'llm.usage.recorded')).toHaveLength(1);
  });
});
