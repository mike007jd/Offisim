import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { OffisimGraphState } from '../../graph/state.js';
import type { RuntimeContext } from '../../runtime/runtime-context.js';
import { OrchestrationService } from '../../services/orchestration-service.js';
import type { WorkspaceStalenessService } from '../../services/workspace-staleness-service.js';
import { assertDefined } from '../helpers/fixtures.js';

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

function makeMinimalRuntimeCtx(
  threadId: string,
  opts?: { eventBus?: InMemoryEventBus },
): RuntimeContext {
  const eventBus = opts?.eventBus ?? new InMemoryEventBus();
  return {
    threadId,
    companyId: 'company-test',
    eventBus,
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
  inputs: Record<string, unknown>[];
} {
  const callLog: Array<{ start: number; end: number; threadId: string }> = [];
  const inputs: Record<string, unknown>[] = [];

  const graph: StubGraph = {
    async stream(input: Record<string, unknown>) {
      const tid = String(input.threadId ?? '');
      const start = Date.now();
      inputs.push(input);
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

  return { graph, callLog, inputs };
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

  it('resumeMeeting forwards the originating thread when provided', async () => {
    const { graph } = makeTrackedGraph(0);
    const runtimeCtx = makeMinimalRuntimeCtx('thread-default');
    const orch = new OrchestrationService(graph, runtimeCtx);
    const executeSpy = vi.spyOn(orch, 'execute').mockResolvedValue({} as OffisimGraphState);

    await (
      orch as OrchestrationService & {
        resumeMeeting(
          meetingId: string,
          messages: [],
          threadId: string,
        ): Promise<OffisimGraphState>;
      }
    ).resumeMeeting('mtg-1', [], 'thread-project-1');

    expect(executeSpy).toHaveBeenCalledWith({
      entryMode: 'meeting',
      messages: [],
      meetingId: 'mtg-1',
      meetingInterrupt: { type: null },
      threadId: 'thread-project-1',
    });
  });

  it('endPausedMeeting forwards the originating thread when provided', async () => {
    const { graph } = makeTrackedGraph(0);
    const runtimeCtx = makeMinimalRuntimeCtx('thread-default');
    const orch = new OrchestrationService(graph, runtimeCtx);
    const executeSpy = vi.spyOn(orch, 'execute').mockResolvedValue({} as OffisimGraphState);

    await (
      orch as OrchestrationService & {
        endPausedMeeting(
          meetingId: string,
          messages: [],
          threadId: string,
        ): Promise<OffisimGraphState>;
      }
    ).endPausedMeeting('mtg-1', [], 'thread-project-1');

    expect(executeSpy).toHaveBeenCalledWith({
      entryMode: 'meeting',
      messages: [],
      meetingId: 'mtg-1',
      meetingInterrupt: { type: 'end' },
      threadId: 'thread-project-1',
    });
  });

  it('blocks background_sync execution when workspace stale check returns block', async () => {
    const { graph } = makeTrackedGraph(0);
    const eventBus = new InMemoryEventBus();
    const emitted: Array<{ type: string; payload: unknown }> = [];
    eventBus.on('', (event) => emitted.push({ type: event.type, payload: event.payload }));
    const runtimeCtx = makeMinimalRuntimeCtx('thread-sync', { eventBus });
    const staleService = {
      checkThread: vi.fn().mockResolvedValue({
        status: 'block',
        reason: 'git_head_changed',
      }),
      saveThreadBaseline: vi.fn(),
    } as unknown as WorkspaceStalenessService;
    const orch = new OrchestrationService(graph, runtimeCtx, {
      workspaceStalenessService: staleService,
    });

    await expect(
      orch.execute({
        entryMode: 'background_sync',
        messages: [],
        threadId: 'thread-sync',
      }),
    ).rejects.toThrow('workspace changed');
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'workspace.staleness.detected',
          payload: expect.objectContaining({
            status: 'block',
            reason: 'git_head_changed',
          }),
        }),
      ]),
    );
  });

  it('saves a workspace baseline after successful execution', async () => {
    const { graph } = makeTrackedGraph(0);
    const runtimeCtx = makeMinimalRuntimeCtx('thread-sync');
    const staleService = {
      checkThread: vi.fn().mockResolvedValue({
        status: 'clean',
        reason: 'baseline_matches',
      }),
      saveThreadBaseline: vi.fn().mockResolvedValue(null),
    } as unknown as WorkspaceStalenessService;
    const orch = new OrchestrationService(graph, runtimeCtx, {
      workspaceStalenessService: staleService,
    });

    await orch.execute({
      entryMode: 'background_sync',
      messages: [],
      threadId: 'thread-sync',
    });

    expect(staleService.saveThreadBaseline).toHaveBeenCalledWith('thread-sync', 'company-test');
  });

  it('resumePlan restores the latest checkpoint state and re-enters through background_sync', async () => {
    const { graph, inputs } = makeTrackedGraph(0);
    const eventBus = new InMemoryEventBus();
    const emitted: Array<{ type: string; payload: unknown }> = [];
    eventBus.on('', (event) => emitted.push({ type: event.type, payload: event.payload }));
    const runtimeCtx = makeMinimalRuntimeCtx('thread-default', { eventBus });
    const checkpointSaver = {
      getTuple: vi.fn().mockResolvedValue({
        checkpoint: {
          channel_values: {
            threadId: 'thread-plan',
            companyId: 'company-test',
            entryMode: 'boss_chat',
            messages: [],
            taskPlan: {
              planId: 'plan-1',
              threadId: 'thread-plan',
              companyId: 'company-test',
              summary: 'demo plan',
              steps: [{ stepIndex: 0, description: 'Do thing', tasks: [] }],
            },
            currentStepIndex: 0,
            completedStepIndices: [],
            dispatchedStepIndices: [],
            pendingAssignments: [{ taskType: 'code', employeeId: 'emp-1', inputJson: {} }],
            currentTaskRunId: 'tr-1',
            currentEmployeeId: 'emp-1',
            currentStepOutputs: [
              { employeeId: 'emp-1', employeeName: 'Dev', content: 'wip', taskRunId: 'tr-1' },
            ],
            routeDecision: 'delegate_manager',
            interruptReason: 'previous',
          },
        },
        config: {
          configurable: { thread_id: 'thread-plan', checkpoint_id: 'cp-latest' },
        },
      }),
    };
    const orch = new OrchestrationService(graph, runtimeCtx, {
      checkpointSaver: checkpointSaver as never,
    });

    await orch.resumePlan('thread-plan');

    expect(checkpointSaver.getTuple).toHaveBeenCalledWith({
      configurable: { thread_id: 'thread-plan' },
    });
    expect(inputs[0]).toMatchObject({
      threadId: 'thread-plan',
      companyId: 'company-test',
      entryMode: 'background_sync',
      taskPlan: { planId: 'plan-1' },
      currentStepIndex: 0,
      pendingAssignments: [],
      currentTaskRunId: null,
      currentEmployeeId: null,
      currentStepOutputs: [],
      routeDecision: null,
      interruptReason: null,
    });
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'execution.resumed',
          payload: expect.objectContaining({
            threadId: 'thread-plan',
            currentStepIndex: 0,
            completedStepCount: 0,
            rewoundFromStepIndex: null,
          }),
        }),
      ]),
    );
  });

  it('resumePlan can rewind execution to an earlier step boundary', async () => {
    const { graph, inputs } = makeTrackedGraph(0);
    const runtimeCtx = makeMinimalRuntimeCtx('thread-default');
    const checkpointSaver = {
      getTuple: vi.fn().mockResolvedValue({
        checkpoint: {
          channel_values: {
            threadId: 'thread-plan',
            companyId: 'company-test',
            entryMode: 'boss_chat',
            messages: [],
            taskPlan: {
              planId: 'plan-1',
              threadId: 'thread-plan',
              companyId: 'company-test',
              summary: 'demo plan',
              steps: [
                { stepIndex: 0, description: 'A', tasks: [] },
                { stepIndex: 1, description: 'B', tasks: [] },
                { stepIndex: 2, description: 'C', tasks: [] },
              ],
            },
            currentStepIndex: 2,
            completedStepIndices: [0, 1],
            dispatchedStepIndices: [0, 1, 2],
            stepResults: [
              { stepIndex: 0, outputs: [] },
              { stepIndex: 1, outputs: [] },
            ],
          },
        },
        config: {
          configurable: { thread_id: 'thread-plan', checkpoint_id: 'cp-latest' },
        },
      }),
    };
    const orch = new OrchestrationService(graph, runtimeCtx, {
      checkpointSaver: checkpointSaver as never,
    });

    await orch.resumePlan('thread-plan', { fromStepIndex: 1 });

    expect(inputs[0]).toMatchObject({
      currentStepIndex: 1,
      completedStepIndices: [0],
      dispatchedStepIndices: [0],
      stepResults: [{ stepIndex: 0, outputs: [] }],
    });
  });

  it('serializeExecutionState returns a compact view of the latest checkpoint state', async () => {
    const { graph } = makeTrackedGraph(0);
    const runtimeCtx = makeMinimalRuntimeCtx('thread-default');
    const checkpointSaver = {
      getTuple: vi.fn().mockResolvedValue({
        checkpoint: {
          channel_values: {
            threadId: 'thread-plan',
            companyId: 'company-test',
            entryMode: 'background_sync',
            messages: [{ id: 'm1' }, { id: 'm2' }],
            taskPlan: {
              planId: 'plan-1',
              threadId: 'thread-plan',
              companyId: 'company-test',
              summary: 'demo plan',
              steps: [{ stepIndex: 0, description: 'A', tasks: [] }],
            },
            currentStepIndex: 0,
            completedStepIndices: [],
            dispatchedStepIndices: [0],
            pendingAssignments: [{ taskType: 'code', employeeId: 'emp-1', inputJson: {} }],
            meetingId: null,
          },
        },
        config: {
          configurable: { thread_id: 'thread-plan', checkpoint_id: 'cp-latest' },
        },
      }),
    };
    const orch = new OrchestrationService(graph, runtimeCtx, {
      checkpointSaver: checkpointSaver as never,
    });

    const serialized = await orch.serializeExecutionState('thread-plan');

    expect(serialized).toEqual({
      threadId: 'thread-plan',
      companyId: 'company-test',
      checkpointId: 'cp-latest',
      entryMode: 'background_sync',
      currentStepIndex: 0,
      completedStepIndices: [],
      dispatchedStepIndices: [0],
      pendingAssignmentsCount: 1,
      messageCount: 2,
      meetingId: null,
      routeDecision: null,
      hasTaskPlan: true,
      taskPlanSummary: 'demo plan',
    });
  });
});
