import { describe, expect, it, vi } from 'vitest';
import { LlmError } from '../../errors.js';
import type { AicsGraphState } from '../../graph/state.js';
import { type RetryConfig, withRetry } from '../../llm/retry.js';
import type { RuntimeContext } from '../../runtime/runtime-context.js';
import { OrchestrationService } from '../../services/orchestration-service.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const FAST_CONFIG: RetryConfig = { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 };

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

function makeInput(threadId: string) {
  return {
    entryMode: 'boss_chat' as AicsGraphState['entryMode'],
    messages: [],
    threadId,
  };
}

// ---------------------------------------------------------------------------
// withRetry — abort signal tests
// ---------------------------------------------------------------------------

describe('withRetry with AbortSignal', () => {
  it('throws AbortError immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const fn = vi.fn().mockResolvedValue('should not be called');
    await expect(withRetry(fn, FAST_CONFIG, () => true, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });

    // fn should never have been called
    expect(fn).not.toHaveBeenCalled();
  });

  it('stops retrying when signal is aborted between retries', async () => {
    const controller = new AbortController();
    let callCount = 0;

    const fn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Abort after the first failure, before the retry
        controller.abort();
        throw new LlmError('rate limited', 'anthropic', 429);
      }
      return 'ok';
    });

    await expect(
      withRetry(fn, FAST_CONFIG, (e) => e instanceof LlmError && e.recoverable, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });

    // fn was called once, then abort prevented the retry
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('completes normally when signal is not aborted', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withRetry(fn, FAST_CONFIG, () => true, controller.signal);
    expect(result).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// OrchestrationService — abort integration
// ---------------------------------------------------------------------------

describe('OrchestrationService abort integration', () => {
  it('abortExecution cancels a running execute — returns partial state, does not throw', async () => {
    // Build a graph that yields one update then hangs indefinitely
    // until the signal fires.
    const graph: StubGraph = {
      async stream(input: Record<string, unknown>, cfg: Record<string, unknown>) {
        const signal = (cfg as { configurable?: { signal?: AbortSignal } }).configurable?.signal;
        const tid = String(input.threadId ?? '');

        async function* gen() {
          // First yield — partial state
          yield { stubNode: { threadId: tid, messages: [] } };

          // Now wait for abort (or timeout safety)
          await new Promise<void>((resolve) => {
            if (signal) {
              signal.addEventListener('abort', () => resolve());
            } else {
              // Fallback: short timeout so test doesn't hang
              setTimeout(resolve, 5000);
            }
          });
        }

        return gen();
      },
    };

    const runtimeCtx = makeMinimalRuntimeCtx('thread-abort');
    const orch = new OrchestrationService(graph, runtimeCtx);

    // Start execute in background
    const executePromise = orch.execute(makeInput('thread-abort'));

    // Give the stream time to yield its first update and reach the "waiting" state
    await new Promise((r) => setTimeout(r, 20));

    // Abort
    orch.abortExecution('thread-abort');

    // Should resolve (not throw) with partial state
    const result = await executePromise;
    expect(result).toBeDefined();
    expect(result.threadId).toBe('thread-abort');
  });

  it('AbortError from graph stream is caught gracefully — returns partial state', async () => {
    // Graph that throws AbortError after one update
    const graph: StubGraph = {
      async stream() {
        async function* gen() {
          yield { stubNode: { messages: [] } };
          throw new DOMException('Aborted', 'AbortError');
        }
        return gen();
      },
    };

    const runtimeCtx = makeMinimalRuntimeCtx('thread-dom-abort');
    const orch = new OrchestrationService(graph, runtimeCtx);

    // Should resolve, not throw
    const result = await orch.execute(makeInput('thread-dom-abort'));
    expect(result).toBeDefined();
  });

  it('abortExecution cleans up currentAborts map after execute resolves', async () => {
    const graph: StubGraph = {
      async stream(input: Record<string, unknown>) {
        const tid = String(input.threadId ?? '');
        async function* gen() {
          yield { stubNode: { threadId: tid, messages: [] } };
        }
        return gen();
      },
    };

    const runtimeCtx = makeMinimalRuntimeCtx('thread-cleanup');
    const orch = new OrchestrationService(graph, runtimeCtx);

    await orch.execute(makeInput('thread-cleanup'));

    // After completion, abortExecution should be a no-op (not throw)
    expect(() => orch.abortExecution('thread-cleanup')).not.toThrow();
  });
});
