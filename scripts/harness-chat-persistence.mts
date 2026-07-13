import assert from 'node:assert/strict';
import {
  type ConversationRunController,
  createConversationRunController,
} from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.js';
// `chat-message-events.js` → `thread-message-events.js` import `data/adapters.js`,
// whose `reposOrNull` normally needs the Tauri SQL plugin. The harness registers
// `harness-chat-persistence.loader.mjs` (via NODE_OPTIONS --import, before module
// linking) which swaps `adapters.js` for an in-memory `reposOrNull` backed by the
// store the harness installs on `globalThis.__OFFISIM_FAKE_REPOS__`. The
// controller needs no mock — it takes repos via constructor DI.
import {
  loadPersistedChatMessages,
  persistChatMessage,
} from '../apps/desktop/renderer/src/data/chat-message-events.js';
import type { ChatMessage } from '../apps/desktop/renderer/src/data/types.js';
import { AgentRunPersistenceQueue } from '../apps/desktop/renderer/src/runtime/agent-run-persistence-queue.js';
import type {
  DesktopAgentRunInput,
  DesktopAgentRunResult,
} from '../apps/desktop/renderer/src/runtime/desktop-agent-runtime.js';
import {
  InMemoryEventBus,
  type NewAgentEvent,
  type RuntimeRepositories,
  createMemoryRepositories,
} from '../packages/core/src/browser.js';

type ScenarioEvidence = Record<string, unknown>;

// ---------------------------------------------------------------------------
// P1 — deterministic chat-history load (data layer, via the adapters loader)
// ---------------------------------------------------------------------------

/** Install a fresh in-memory agent-event store the faked `reposOrNull` returns.
 *  `setNow` lets a scenario advance the `created_at` clock deterministically so
 *  we can force a long reply's checkpoints to be the newest writes. */
function installFakeAgentEvents(): {
  setNow: (ms: number) => void;
  chatRowCount: (threadId: string) => Promise<number>;
  appendRaw: (event: NewAgentEvent) => Promise<void>;
} {
  const repos = createMemoryRepositories();
  let now = Date.parse('2026-06-24T00:00:00.000Z');
  const agentEvents = repos.agentEvents;
  if (!agentEvents) throw new Error('memory repos missing agentEvents');
  const originalAppend = agentEvents.append.bind(agentEvents);
  agentEvents.append = async (event) =>
    originalAppend({ ...event, created_at: event.created_at ?? new Date(now).toISOString() });
  (globalThis as Record<string, unknown>).__OFFISIM_FAKE_REPOS__ = () => repos;
  return {
    setNow: (ms: number) => {
      now = ms;
    },
    chatRowCount: async (threadId) =>
      (
        await agentEvents.findByThread(threadId, {
          eventType: 'direct_chat.message',
        })
      ).length,
    appendRaw: async (event) => {
      await agentEvents.append(event);
    },
  };
}

function clearFakeAgentEvents(): void {
  (globalThis as Record<string, unknown>).__OFFISIM_FAKE_REPOS__ = undefined;
}

const p1Scenarios: Array<{
  name: string;
  criteria: string;
  run: () => Promise<ScenarioEvidence>;
}> = [
  {
    name: 'long reply with 500+ checkpoints does not evict older real messages',
    criteria:
      'Pass when 600 streaming writes plus the final write occupy one projection row for that assistant message, while reload still returns all distinct messages and the final body.',
    run: async () => {
      const { setNow, chatRowCount } = installFakeAgentEvents();
      try {
        const threadId = 'thread-recovery';
        const baseAt = Date.parse('2026-06-24T09:00:00.000Z');

        // Older real messages, written first with the OLDEST created_at.
        setNow(baseAt);
        await persistChatMessage({
          message: msg(threadId, 'boss-1', 'boss', 'First prompt', baseAt, 'complete'),
          companyId: 'co',
          projectId: 'prj',
        });
        setNow(baseAt + 1_000);
        await persistChatMessage({
          message: msg(
            threadId,
            'assistant-1',
            'employee',
            'First reply',
            baseAt + 1_000,
            'complete',
          ),
          companyId: 'co',
          projectId: 'prj',
        });
        setNow(baseAt + 2_000);
        await persistChatMessage({
          message: msg(threadId, 'boss-2', 'boss', 'Second prompt', baseAt + 2_000, 'complete'),
          companyId: 'co',
          projectId: 'prj',
        });

        // One long assistant reply: 600 streaming checkpoints, all id=assistant-2,
        // all with the NEWEST created_at (the inflation that fills the window).
        const replyAt = baseAt + 3_000;
        for (let i = 0; i < 600; i += 1) {
          setNow(replyAt + i); // strictly newer than every older message
          await persistChatMessage({
            message: msg(threadId, 'assistant-2', 'employee', `partial ${i}`, replyAt, 'streaming'),
            companyId: 'co',
            projectId: 'prj',
          });
        }
        // Final complete row for the same reply.
        setNow(replyAt + 600);
        await persistChatMessage({
          message: msg(
            threadId,
            'assistant-2',
            'employee',
            'Final complete reply',
            replyAt,
            'complete',
          ),
          companyId: 'co',
          projectId: 'prj',
        });

        assert.equal(
          await chatRowCount(threadId),
          4,
          '600 streaming writes must occupy one projection row, not 600 checkpoint rows',
        );

        const loaded = await loadPersistedChatMessages(threadId);
        const ids = loaded.map((m) => m.id);
        const byId = new Map(loaded.map((m) => [m.id, m]));

        // Older real messages survived (not evicted by the 600-checkpoint window).
        assert.ok(ids.includes('boss-1'), 'boss-1 evicted');
        assert.ok(ids.includes('assistant-1'), 'assistant-1 evicted');
        assert.ok(ids.includes('boss-2'), 'boss-2 evicted');
        // The long reply collapsed to ONE message whose FINAL complete body wins.
        assert.equal(loaded.filter((m) => m.id === 'assistant-2').length, 1);
        assert.equal(byId.get('assistant-2')?.body, 'Final complete reply');
        assert.equal(byId.get('assistant-2')?.status, 'complete');
        // Deterministic chronological order preserved.
        assert.deepEqual(ids, ['boss-1', 'assistant-1', 'boss-2', 'assistant-2']);
        return {
          persistedRows: await chatRowCount(threadId),
          loadedIds: ids,
          finalBody: byId.get('assistant-2')?.body,
        };
      } finally {
        clearFakeAgentEvents();
      }
    },
  },
  {
    name: 'final complete projection rejects an out-of-order stale checkpoint write',
    criteria:
      'Pass when the final complete projection remains authoritative after a delayed older checkpoint reaches the repository with the same stable message id.',
    run: async () => {
      const { setNow, chatRowCount, appendRaw } = installFakeAgentEvents();
      try {
        const threadId = 'thread-tiebreak';
        const at = Date.parse('2026-06-24T10:00:00.000Z');
        // Both writes share the same stable projection id and visible message timestamp.
        setNow(at);
        await persistChatMessage({
          message: msg(threadId, 'assistant-x', 'employee', 'partial', at, 'streaming'),
          companyId: 'co',
          projectId: 'prj',
        });
        setNow(at);
        await persistChatMessage({
          message: msg(threadId, 'assistant-x', 'employee', 'final', at, 'complete'),
          companyId: 'co',
          projectId: 'prj',
        });
        await appendRaw({
          event_id: `direct-chat:${threadId}:assistant-x`,
          project_id: 'prj',
          thread_id: threadId,
          company_id: 'co',
          agent_name: 'desktop-provider',
          event_type: 'direct_chat.message',
          payload_json: JSON.stringify({
            message: msg(threadId, 'assistant-x', 'employee', 'stale partial', at, 'streaming'),
          }),
          parent_event_id: null,
          created_at: '2000-01-01T00:00:00.000Z',
        });
        const loaded = await loadPersistedChatMessages(threadId);
        assert.equal(await chatRowCount(threadId), 1);
        assert.equal(loaded.length, 1);
        assert.equal(loaded[0]?.body, 'final');
        assert.equal(loaded[0]?.status, 'complete');
        return { body: loaded[0]?.body, status: loaded[0]?.status };
      } finally {
        clearFakeAgentEvents();
      }
    },
  },
];

function msg(
  threadId: string,
  id: string,
  author: ChatMessage['author'],
  body: string,
  at: number,
  status: ChatMessage['status'],
): ChatMessage {
  return {
    id,
    threadId,
    author,
    employeeId: author === 'boss' ? null : 'emp-1',
    body,
    at,
    status,
  };
}

// ---------------------------------------------------------------------------
// P2 / P3 — controller fault injection (constructor DI, no loader needed)
// ---------------------------------------------------------------------------

class FakeRuntime {
  answers: Array<Record<string, unknown>> = [];
  onExecute: (input: DesktopAgentRunInput) => Promise<DesktopAgentRunResult> = async () => ({
    text: 'ok',
  });
  constructor(
    private readonly eventBus: InMemoryEventBus,
    private readonly companyId = 'co',
  ) {}
  async execute(input: DesktopAgentRunInput): Promise<DesktopAgentRunResult> {
    return this.onExecute(input);
  }
  abort(): void {}
  async answerUiRequest(answer: Record<string, unknown>): Promise<void> {
    this.answers.push(answer);
  }
  async resume(): Promise<null> {
    return null;
  }
  async dispose(): Promise<void> {}
  emitUiRequest(input: DesktopAgentRunInput, id = 'ui-confirm'): void {
    this.eventBus.emit({
      type: 'agent.ui.request',
      entityId: id,
      entityType: 'runtime',
      companyId: this.companyId,
      threadId: input.threadId,
      timestamp: Date.now(),
      payload: {
        requestId: `host-${id}`,
        runId: input.runId ?? 'missing-run',
        id,
        method: 'confirm',
        title: 'Approve command?',
        message: 'Pi needs a decision.',
      },
    });
  }
}

async function waitFor(label: string, condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

interface FaultRepos {
  failHistoryCreate?: boolean;
  failFindByCompany?: number; // fail this many findByCompany calls, then succeed
  seedStale?: { threadId: string; companyId: string };
}

function makeFaultRepos(opts: FaultRepos): {
  repos: RuntimeRepositories;
  deletedThreads: string[];
  findByCompanyCalls: () => number;
} {
  const activeRows = new Map<string, Record<string, unknown>>();
  const deletedThreads: string[] = [];
  let findByCompanyCalls = 0;
  if (opts.seedStale) {
    activeRows.set(opts.seedStale.threadId, {
      thread_id: opts.seedStale.threadId,
      company_id: opts.seedStale.companyId,
      interaction_id: 'ui-stale',
      payload_json: JSON.stringify({
        source: 'pi-ui-request',
        attemptId: 'attempt-stale',
        hostRequestId: 'host-stale',
        uiRequestId: 'ui-stale',
        method: 'confirm',
        title: 'Restored approval',
        message: 'from db',
      }),
      // Recent relative to the controller's now (2026-06-24): a freshly
      // interrupted approval hydrates as `stale` (within the 24h expiry window).
      // An older seed would now classify as `expired` (A3) and is exercised by
      // the dedicated expiry scenario in harness-conversation-run-controller.
      created_at: '2026-06-24T00:00:00.000Z',
    });
  }
  const repos = {
    activeInteractions: {
      upsert: async (row: Record<string, unknown>) => {
        activeRows.set(row.thread_id as string, row);
        return row;
      },
      findByThread: async (threadId: string) => activeRows.get(threadId) ?? null,
      findByCompany: async (companyId: string) => {
        findByCompanyCalls += 1;
        if (opts.failFindByCompany && findByCompanyCalls <= opts.failFindByCompany) {
          throw new Error('transient db read failure');
        }
        return [...activeRows.values()].filter((row) => row.company_id === companyId);
      },
      deleteByThread: async (threadId: string) => {
        deletedThreads.push(threadId);
        activeRows.delete(threadId);
      },
    },
    interactionHistory: {
      create: async (row: Record<string, unknown>) => {
        if (opts.failHistoryCreate) throw new Error('history write failed');
        return row;
      },
      listByThread: async () => [],
      listByCompany: async () => [],
    },
  } as unknown as RuntimeRepositories;
  return { repos, deletedThreads, findByCompanyCalls: () => findByCompanyCalls };
}

function makeController(repos: RuntimeRepositories): {
  controller: ConversationRunController;
  runtime: FakeRuntime;
  eventBus: InMemoryEventBus;
} {
  const eventBus = new InMemoryEventBus();
  const runtime = new FakeRuntime(eventBus);
  let now = Date.parse('2026-06-24T00:00:00.000Z');
  let uuid = 0;
  const controller = createConversationRunController({
    eventBus,
    runtimeFactory: async () => runtime as never,
    reposFactory: async () => repos,
    materializeTurn: async ({ text }) => ({ promptText: text, attachments: undefined }),
    persistMessage: async () => undefined,
    appendEvent: async () => undefined,
    now: () => {
      now += 11;
      return now;
    },
    randomUUID: () => `uuid-${++uuid}`,
  });
  return { controller, runtime, eventBus };
}

const p2p3Scenarios: Array<{
  name: string;
  criteria: string;
  run: () => Promise<ScenarioEvidence>;
}> = [
  {
    name: 'P2: approval answer with failing DB write does not leave a stuck pending banner',
    criteria:
      'Pass when the DB resolve step throws after the host already answered, but the local snapshot still clears the pending approval (no stuck banner) and surfaces the failure to the caller.',
    run: async () => {
      const { repos } = makeFaultRepos({ failHistoryCreate: true });
      const { controller, runtime } = makeController(repos);
      runtime.onExecute = async (input) => {
        runtime.emitUiRequest(input, 'ui-confirm');
        await waitFor('approval answered', () => runtime.answers.length === 1);
        return { text: 'done' };
      };
      await controller.submit({
        companyId: 'co',
        projectId: 'prj',
        threadId: 'thread-1',
        employeeId: 'emp-1',
        text: 'rm something dangerous',
        stagedAttachments: [],
        source: 'office',
      });
      await waitFor(
        'approval pending',
        () => controller.getSnapshot('thread-1').phase === 'awaiting-approval',
      );
      const approval = controller.getSnapshot('thread-1').approval;
      assert.ok(approval);
      let threw = false;
      try {
        await controller.answerApproval({
          threadId: 'thread-1',
          attemptId: approval.attemptId,
          hostRequestId: approval.hostRequestId,
          uiRequestId: approval.uiRequestId,
          confirmed: true,
        });
      } catch {
        threw = true; // DB failure propagates — but the banner must still be gone.
      }
      // Host received the answer.
      assert.equal(runtime.answers[0]?.confirmed, true);
      // The pending banner is cleared despite the DB write failure (try/finally).
      const after = controller.getSnapshot('thread-1');
      assert.equal(after.approval, null, 'stuck pending banner after DB failure');
      assert.notEqual(after.phase, 'awaiting-approval');
      return { approvalAfter: after.approval, phase: after.phase, dbThrew: threw };
    },
  },
  {
    name: 'P3: stale-approval hydration retries after a transient failure',
    criteria:
      'Pass when the first hydrate fails and stays retryable, then the retry surfaces a historical stale approval without manufacturing a controllable active run.',
    run: async () => {
      const { repos } = makeFaultRepos({
        failFindByCompany: 1,
        seedStale: { threadId: 'stale-thread', companyId: 'co' },
      });
      const { controller } = makeController(repos);

      // First attempt: transient failure. Must throw AND not poison the company key.
      let firstThrew = false;
      try {
        await controller.hydrateStaleApprovals('co');
      } catch {
        firstThrew = true;
      }
      assert.ok(firstThrew, 'first hydrate should surface the transient failure');
      assert.equal(
        controller.getSnapshot('stale-thread').approval,
        null,
        'nothing should have hydrated on the failed attempt',
      );

      // Second attempt: same company key — must be allowed to re-run and succeed.
      await controller.hydrateStaleApprovals('co');
      const approval = controller.getSnapshot('stale-thread').approval;
      assert.ok(approval, 'retry did not re-hydrate (company key left poisoned)');
      assert.equal(approval.state, 'stale');
      assert.equal(controller.getSnapshot('stale-thread').phase, 'interrupted');
      assert.equal(
        controller.getGlobalSnapshot().activeRuns.some((run) => run.threadId === 'stale-thread'),
        false,
        'historical approval must not project a global Stop target',
      );
      return { firstThrew, hydratedState: approval.state, phase: 'interrupted', active: false };
    },
  },
  {
    name: 'P3: hydration stays idempotent on the happy path (no double hydrate)',
    criteria:
      'Pass when, after a successful hydrate, a second call for the same company is a no-op (the key guards against redundant re-hydration).',
    run: async () => {
      const { repos, findByCompanyCalls } = makeFaultRepos({
        seedStale: { threadId: 'stale-thread', companyId: 'co' },
      });
      const { controller } = makeController(repos);
      await controller.hydrateStaleApprovals('co');
      await controller.hydrateStaleApprovals('co');
      assert.equal(findByCompanyCalls(), 1, 'second successful hydrate should be a no-op');
      return { findByCompanyCalls: findByCompanyCalls() };
    },
  },
];

// ---------------------------------------------------------------------------
// P4 — ordered persistence recovery + stream-cursor coalescing
// ---------------------------------------------------------------------------

const p4Scenarios: Array<{
  name: string;
  criteria: string;
  run: () => Promise<ScenarioEvidence>;
}> = [
  {
    name: 'P4: one rejected persistence task does not poison later work',
    criteria:
      'Pass when a failed task is reported at its own boundary and the next queued task still executes in order.',
    run: async () => {
      const order: string[] = [];
      const errors: Array<{ label: string; message: string }> = [];
      const queue = new AgentRunPersistenceQueue({
        onError: (label, error) => {
          errors.push({
            label,
            message: error instanceof Error ? error.message : String(error),
          });
        },
      });
      queue.enqueue('first write', async () => {
        order.push('first');
        throw new Error('transient write failure');
      });
      queue.enqueue('terminal write', async () => {
        order.push('terminal');
      });
      await queue.drain();
      assert.deepEqual(order, ['first', 'terminal']);
      assert.deepEqual(errors, [{ label: 'first write', message: 'transient write failure' }]);
      queue.dispose();
      return { order, errors };
    },
  },
  {
    name: 'P4: stream cursor writes coalesce to the latest cursor at a semantic checkpoint',
    criteria:
      'Pass when several cursor events for one run produce no eager write and one explicit flush persists only the latest cursor.',
    run: async () => {
      const writes: number[] = [];
      const queue = new AgentRunPersistenceQueue({ cursorThrottleMs: 60_000 });
      const persist = async (cursor: number) => {
        writes.push(cursor);
      };
      queue.queueCursor('run-1', 1, persist);
      queue.queueCursor('run-1', 5, persist);
      queue.queueCursor('run-1', 3, persist);
      assert.deepEqual(writes, [], 'cursor writes should wait for throttle or semantic flush');
      queue.flushCursor('run-1');
      await queue.drain();
      assert.deepEqual(writes, [5]);
      queue.dispose();
      return { writes };
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const allScenarios = [...p1Scenarios, ...p2p3Scenarios, ...p4Scenarios];
const results: Array<{
  name: string;
  criteria: string;
  outcome: 'pass' | 'fail';
  evidence?: ScenarioEvidence;
  error?: string;
}> = [];

for (const scenario of allScenarios) {
  try {
    const evidence = await scenario.run();
    results.push({ name: scenario.name, criteria: scenario.criteria, outcome: 'pass', evidence });
  } catch (error) {
    results.push({
      name: scenario.name,
      criteria: scenario.criteria,
      outcome: 'fail',
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
}

const failed = results.filter((r) => r.outcome === 'fail');
console.log(JSON.stringify({ scenarioCount: allScenarios.length, results }, null, 2));
if (failed.length > 0) {
  console.error(`chat-persistence harness failed: ${failed.length}/${allScenarios.length}`);
  process.exit(1);
}
console.log(`chat-persistence harness passed: ${allScenarios.length}/${allScenarios.length}`);
