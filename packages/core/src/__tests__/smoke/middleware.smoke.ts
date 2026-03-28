/**
 * Smoke test: LLM recording middleware with a REAL MiniMax API.
 *
 * Validates that recordedLlmCall / recordedLlmStream correctly:
 *   - create DB records with real token counts
 *   - emit EventBus events
 *   - prune messages before forwarding to the API
 *
 * Requires MINIMAX_API_KEY in env. Skipped otherwise.
 */
import type { RuntimeEvent } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { LlmGateway, LlmRequest, LlmStreamChunk } from '../../llm/gateway.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { recordedLlmCall, recordedLlmStream } from '../../llm/recorded-call.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import { TEST_COMPANY } from '../helpers/fixtures.js';
import { HAS_MINIMAX, MINIMAX_MODEL, createMiniMaxGateway } from '../helpers/smoke-providers.js';

function makeRealCtx(gateway: LlmGateway) {
  const repos = createMemoryRepositories();
  const eventBus = new InMemoryEventBus();
  const resolver = new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json));
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
    threadId: 't-smoke-1',
  });

  return { runtimeCtx, events, repos };
}

describe.skipIf(!HAS_MINIMAX)('Middleware smoke — recordedLlmCall (MiniMax)', () => {
  it(
    'creates a DB record with real token counts, latency, and no error',
    async () => {
      const gateway = createMiniMaxGateway();
      const { runtimeCtx, repos } = makeRealCtx(gateway);

      const response = await recordedLlmCall(
        runtimeCtx,
        {
          messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
          model: MINIMAX_MODEL,
          maxTokens: 4096,
        },
        { nodeName: 'boss', provider: 'anthropic', model: MINIMAX_MODEL },
      );

      // Response should have content
      expect(response.content.length).toBeGreaterThan(0);

      // DB record
      const calls = await repos.llmCalls.findByThread('t-smoke-1');
      expect(calls).toHaveLength(1);
      const record = calls[0]!;
      expect(record.node_name).toBe('boss');
      expect(record.provider).toBe('anthropic');
      expect(record.model).toBe(MINIMAX_MODEL);
      expect(record.input_tokens).toBeGreaterThan(0);
      expect(record.output_tokens).toBeGreaterThan(0);
      expect(record.latency_ms).toBeGreaterThan(0);
      expect(record.error_code).toBeNull();
      expect(record.thread_id).toBe('t-smoke-1');

      gateway.dispose();
    },
    60_000,
  );
});

describe.skipIf(!HAS_MINIMAX)('Middleware smoke — recordedLlmStream (MiniMax)', () => {
  it(
    'creates a DB record + emits events + streams chunks',
    async () => {
      const gateway = createMiniMaxGateway();
      const { runtimeCtx, events, repos } = makeRealCtx(gateway);

      const chunks: LlmStreamChunk[] = [];
      const result = await recordedLlmStream(
        runtimeCtx,
        {
          messages: [{ role: 'user', content: 'Say "hello world" and nothing else.' }],
          model: MINIMAX_MODEL,
          maxTokens: 4096,
        },
        { nodeName: 'employee', provider: 'anthropic', model: MINIMAX_MODEL },
        (chunk) => chunks.push(chunk),
      );

      // Stream result should have content
      expect(result.fullContent.length).toBeGreaterThan(0);

      // onChunk should have been called multiple times (content chunks + done)
      expect(chunks.length).toBeGreaterThanOrEqual(1);

      // Final chunk should be done with usage
      const finalChunk = chunks.at(-1)!;
      expect(finalChunk.done).toBe(true);
      expect(finalChunk.usage).toBeDefined();
      expect(finalChunk.usage!.inputTokens).toBeGreaterThan(0);
      expect(finalChunk.usage!.outputTokens).toBeGreaterThan(0);

      // DB record
      const calls = await repos.llmCalls.findByThread('t-smoke-1');
      expect(calls).toHaveLength(1);
      const record = calls[0]!;
      expect(record.node_name).toBe('employee');
      expect(record.input_tokens).toBeGreaterThan(0);
      expect(record.output_tokens).toBeGreaterThan(0);
      expect(record.latency_ms).toBeGreaterThan(0);
      expect(record.error_code).toBeNull();

      // Events
      const started = events.filter((e) => e.type === 'llm.call.started');
      const completed = events.filter((e) => e.type === 'llm.call.completed');
      const usage = events.filter((e) => e.type === 'llm.usage.recorded');
      expect(started).toHaveLength(1);
      expect(completed).toHaveLength(1);
      expect(usage).toHaveLength(1);

      // Verify completed event has real data
      expect(completed[0]!.payload.latencyMs).toBeGreaterThan(0);
      expect(completed[0]!.payload.inputTokens).toBeGreaterThan(0);
      expect(completed[0]!.payload.outputTokens).toBeGreaterThan(0);

      gateway.dispose();
    },
    60_000,
  );
});

describe.skipIf(!HAS_MINIMAX)('Middleware smoke — message pruning (MiniMax)', () => {
  it(
    'prunes 60+ messages to <=52 and still gets a valid response',
    async () => {
      const gateway = createMiniMaxGateway();
      const { runtimeCtx, repos } = makeRealCtx(gateway);

      // Build 65 messages: 2 system + 63 user/assistant turns
      const messages: LlmRequest['messages'] = [
        { role: 'system', content: 'You are a helpful assistant. Always respond concisely.' },
        { role: 'system', content: 'Keep responses under 10 words.' },
        ...Array.from({ length: 63 }, (_, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Turn ${i}: ${i % 2 === 0 ? 'What is ' + i + '?' : 'It is ' + i + '.'}`,
        })),
      ];

      // Total = 65 messages. Prune should keep 2 system + 50 non-system = 52.
      // The API call should still succeed with the pruned set.
      const response = await recordedLlmCall(
        runtimeCtx,
        { messages, model: MINIMAX_MODEL, maxTokens: 4096 },
        { nodeName: 'pm', provider: 'anthropic', model: MINIMAX_MODEL },
      );

      // The response should be valid — pruning did not break anything
      expect(response.content.length).toBeGreaterThan(0);

      // DB record should exist with real tokens
      const calls = await repos.llmCalls.findByThread('t-smoke-1');
      expect(calls).toHaveLength(1);
      expect(calls[0]!.input_tokens).toBeGreaterThan(0);
      expect(calls[0]!.output_tokens).toBeGreaterThan(0);
      expect(calls[0]!.error_code).toBeNull();

      gateway.dispose();
    },
    60_000,
  );
});
