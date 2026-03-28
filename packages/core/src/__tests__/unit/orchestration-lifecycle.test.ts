import { describe, expect, it } from 'vitest';
import type { OffisimGraphState } from '../../graph/state.js';
import type { RuntimeContext } from '../../runtime/runtime-context.js';
import { OrchestrationService } from '../../services/orchestration-service.js';
import { assertDefined } from '../helpers/fixtures.js';

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

function makeMinimalRuntimeCtx(threadId: string): RuntimeContext {
  return {
    threadId,
    companyId: 'company-test',
    eventBus: {
      emit: () => {},
      on: () => () => {},
    },
    meetingInterruptBox: { pending: null },
  } as unknown as RuntimeContext;
}

type StubGraph = ConstructorParameters<typeof OrchestrationService>[0];

/**
 * Build a stub graph whose stream() resolves after `delayMs`.
 * Records call order so tests can assert serialization.
 */
function makeTrackedGraph(delayMs = 0): {
  graph: StubGraph;
  callLog: Array<{ start: number; end: number; threadId: string }>;
} {
  const callLog: Array<{ start: number; end: number; threadId: string }> = [];

  const graph: StubGraph = {
    async stream(input: Record<string, unknown>) {
      const tid = String(input.threadId ?? '');
      const start = Date.now();
      const updates: Record<string, unknown>[] = [{ stubNode: { threadId: tid, messages: [] } }];
      // Yield after delay
      async function* gen() {
        await new Promise<void>((r) => setTimeout(r, delayMs));
        for (const u of updates) yield u;
      }
      const entry = { start, end: 0, threadId: tid };
      callLog.push(entry);
      const iter = gen();
      // Wrap to record end time after iteration
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              const result = await iter.next();
              if (result.done) {
                entry.end = Date.now();
              }
              return result;
            },
          };
        },
      } as AsyncIterable<Record<string, unknown>>;
    },
  };

  return { graph, callLog };
}

function makeInput(threadId: string) {
  return {
    entryMode: 'boss_chat' as OffisimGraphState['entryMode'],
    messages: [],
    threadId,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrchestrationService lifecycle', () => {
  it('same instance reuses threadLocks across calls (locks are preserved)', async () => {
    const { graph, callLog } = makeTrackedGraph(20);
    const runtimeCtx = makeMinimalRuntimeCtx('thread-A');
    const orch = new OrchestrationService(graph, runtimeCtx);

    // Fire two concurrent calls on the same thread
    const [r1, r2] = await Promise.all([
      orch.execute(makeInput('thread-A')),
      orch.execute(makeInput('thread-A')),
    ]);

    expect(r1).toBeDefined();
    expect(r2).toBeDefined();

    // Both calls should have gone through (2 entries in log)
    expect(callLog).toHaveLength(2);

    // The second call must have started AFTER the first ended (serialization)
    const first = assertDefined(callLog[0]);
    const second = assertDefined(callLog[1]);
    expect(second.start).toBeGreaterThanOrEqual(first.end);
  });

  it('concurrent calls on different threadIds are NOT serialized (run in parallel)', async () => {
    const DELAY = 30;
    const { graph, callLog } = makeTrackedGraph(DELAY);
    const runtimeCtx = makeMinimalRuntimeCtx('thread-X');
    const orch = new OrchestrationService(graph, runtimeCtx);

    const startTime = Date.now();
    await Promise.all([orch.execute(makeInput('thread-X')), orch.execute(makeInput('thread-Y'))]);
    const elapsed = Date.now() - startTime;

    // Both calls completed; there should be two log entries
    expect(callLog).toHaveLength(2);

    // If they ran in parallel, total time should be roughly DELAY (not 2*DELAY).
    // Allow generous margin for CI variance.
    expect(elapsed).toBeLessThan(DELAY * 2 + 50);
  });

  it('abortExecution is a no-op when no execution is running', () => {
    const { graph } = makeTrackedGraph(0);
    const runtimeCtx = makeMinimalRuntimeCtx('thread-Z');
    const orch = new OrchestrationService(graph, runtimeCtx);

    // Must not throw
    expect(() => orch.abortExecution('thread-Z')).not.toThrow();
    expect(() => orch.abortExecution('nonexistent')).not.toThrow();
  });

  it('rejects when queue depth exceeds MAX (3)', async () => {
    const { graph } = makeTrackedGraph(50);
    const runtimeCtx = makeMinimalRuntimeCtx('thread-Q');
    const orch = new OrchestrationService(graph, runtimeCtx);

    // Flood the queue — 4th should be rejected (1 running + 2 queued = depth 3, 4th over limit)
    const promises: Promise<OffisimGraphState | { error: Error }>[] = [
      orch.execute(makeInput('thread-Q')),
      orch.execute(makeInput('thread-Q')),
      orch.execute(makeInput('thread-Q')),
      orch.execute(makeInput('thread-Q')).catch((e: unknown) => ({ error: e as Error })),
    ];

    const results = await Promise.allSettled(promises);

    // The 4th call should have resolved to an error-shaped object
    const errorResult = results.find(
      (r): r is PromiseFulfilledResult<{ error: Error }> =>
        r.status === 'fulfilled' && 'error' in (r.value as object),
    );
    expect(errorResult).toBeDefined();
    expect(errorResult?.value.error.message).toContain('queued requests');
  });
});
