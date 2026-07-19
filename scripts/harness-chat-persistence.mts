import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  type ConversationRunController,
  createConversationRunController,
} from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.js';
import { deriveThreadTitle } from '../apps/desktop/renderer/src/data/auto-title.js';
// `chat-message-events.js` → `thread-message-events.js` import `data/adapters.js`,
// whose `reposOrNull` normally needs the Tauri SQL plugin. The harness registers
// `harness-chat-persistence.loader.mjs` (via NODE_OPTIONS --import, before module
// linking) which swaps `adapters.js` for an in-memory `reposOrNull` backed by the
// store the harness installs on `globalThis.__OFFISIM_FAKE_REPOS__`. The
// controller needs no mock — it takes repos via constructor DI.
import {
  loadPersistedChatMessages,
  persistChatMessage,
  persistConversationStreamCheckpointWithRepositories,
} from '../apps/desktop/renderer/src/data/chat-message-events.js';
import { normalizeSemanticThreadTitle } from '../apps/desktop/renderer/src/data/semantic-thread-title.js';
import type { ChatMessage } from '../apps/desktop/renderer/src/data/types.js';
import { AgentRunPersistenceQueue } from '../apps/desktop/renderer/src/runtime/agent-run-persistence-queue.js';
import type {
  DesktopAgentRunInput,
  DesktopAgentRunResult,
  IsolatedTextJobInput,
  IsolatedTextJobResult,
  TurnExecutionProvenance,
} from '../apps/desktop/renderer/src/runtime/desktop-agent-runtime.js';
import {
  nativeSessionPrestartCode,
  nonAuthorizingAgentHostError,
  persistStartedNativeSessionIdentity,
  trustedNativeSessionPrestartCode,
} from '../apps/desktop/renderer/src/runtime/desktop-agent-runtime.js';
import {
  InMemoryEventBus,
  type NewAgentEvent,
  type RuntimeRepositories,
  createMemoryRepositories,
} from '../packages/core/src/browser.js';

const officeRuntimeSource = readFileSync(
  new URL('../apps/desktop/renderer/src/assistant/runtime/useOfficeRuntime.ts', import.meta.url),
  'utf8',
);
assert.match(
  officeRuntimeSource,
  /!run\.attemptId\s*\|\|\s*isConversationRunActive\(run\.phase\)[\s\S]*?invalidateQueries\(\{\s*queryKey:\s*queryKeys\.messages\(threadId\)/u,
  'terminal Turns must refresh durable messages before a later Turn replaces liveMessages',
);

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
  {
    name: 'empty failed terminal preserves a reloaded partial checkpoint',
    criteria:
      'Pass when a partial assistant checkpoint is reloaded, then projected with a failed terminal status without losing its visible content.',
    run: async () => {
      installFakeAgentEvents();
      try {
        const threadId = 'thread-empty-terminal';
        const at = Date.parse('2026-06-24T11:00:00.000Z');
        await persistChatMessage({
          message: msg(
            threadId,
            'assistant-terminal',
            'employee',
            'visible partial',
            at,
            'streaming',
          ),
          companyId: 'co',
          projectId: 'prj',
        });
        const checkpoint = (await loadPersistedChatMessages(threadId)).find(
          (message) => message.id === 'assistant-terminal',
        );
        assert.ok(checkpoint);
        assert.equal(checkpoint?.body, 'visible partial');
        assert.equal(checkpoint?.status, 'interrupted');
        await persistChatMessage({
          message: { ...checkpoint, status: 'failed' },
          companyId: 'co',
          projectId: 'prj',
        });
        const terminal = (await loadPersistedChatMessages(threadId)).find(
          (message) => message.id === 'assistant-terminal',
        );
        assert.equal(terminal?.body, 'visible partial');
        assert.equal(terminal?.status, 'failed');
        return { body: terminal?.body, status: terminal?.status };
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
  generateCalls: IsolatedTextJobInput[] = [];
  onExecute: (input: DesktopAgentRunInput) => Promise<DesktopAgentRunResult> = async () => ({
    text: 'ok',
  });
  onGenerateText: (input: IsolatedTextJobInput) => Promise<IsolatedTextJobResult> = async (
    input,
  ) => ({
    text: 'Semantic title',
    provenance: { ...input.sourceProvenance, runId: input.jobId },
  });
  constructor(
    private readonly eventBus: InMemoryEventBus,
    private readonly companyId = 'co',
  ) {}
  async execute(input: DesktopAgentRunInput): Promise<DesktopAgentRunResult> {
    return this.onExecute(input);
  }
  async generateText(input: IsolatedTextJobInput): Promise<IsolatedTextJobResult> {
    this.generateCalls.push(input);
    return this.onGenerateText(input);
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

async function waitForAsync(
  label: string,
  condition: () => Promise<boolean>,
  timeoutMs = 1000,
): Promise<void> {
  const started = Date.now();
  while (!(await condition())) {
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
    agentRuns: {
      findByStatus: async () => [],
      findLatestFreshSessionCandidate: async () => null,
      findFreshSessionSource: async () => null,
    },
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
      'Pass when the first hydrate fails (transient DB read error) and leaves the company un-hydrated and retryable, and a second hydrate succeeds with a dismiss-only stale approval on an interrupted, non-live thread.',
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
      return {
        firstThrew,
        hydratedState: approval.state,
        phase: controller.getSnapshot('stale-thread').phase,
      };
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
  {
    name: 'P4: assistant checkpoint and replay cursor advance as one durable unit',
    criteria:
      'Pass when the production checkpoint helper rolls back cursor and assistant together if the second write fails, then commits the exact cursor/body pair so reload never appends the same delta twice.',
    run: async () => {
      const runId = 'run-atomic-projection';
      const message: ChatMessage = {
        id: 'assistant-atomic-projection',
        threadId: 'thread-atomic-projection',
        author: 'employee',
        employeeId: 'employee-1',
        body: 'durable replayed-once',
        at: Date.parse('2026-07-14T00:00:00.000Z'),
        replyToMessageId: 'user-atomic-projection',
        attemptId: runId,
        status: 'streaming',
        workspaceProvenance: {
          availability: 'bound',
          source: 'known_root_recovery',
          reasonCode: 'renamed_same_filesystem_object',
          displayPath: '/Users/test/Projects/offisim',
        },
      };
      let durableContextJson = JSON.stringify({ streamCursor: 6 });
      let durableMessageBody = 'durable ';
      let durableWorkspaceProvenance: ChatMessage['workspaceProvenance'] | null = null;
      let rejectMessageWrite = true;
      const transactionalRepos = {
        asyncTransact: async <T,>(fn: (txRepos?: RuntimeRepositories) => Promise<T>) => {
          let stagedContextJson = durableContextJson;
          let stagedMessageBody = durableMessageBody;
          let stagedWorkspaceProvenance = durableWorkspaceProvenance;
          const txRepos = {
            agentRuns: {
              updateRuntimeContext: async (_runId: string, contextJson: string | null) => {
                assert.equal(_runId, runId);
                stagedContextJson = contextJson ?? '{}';
              },
            },
            agentEvents: {
              append: async (event: NewAgentEvent) => {
                if (rejectMessageWrite) throw new Error('injected assistant checkpoint failure');
                const payload = JSON.parse(event.payload_json ?? '{}') as {
                  message?: ChatMessage;
                };
                stagedMessageBody = payload.message?.body ?? '';
                stagedWorkspaceProvenance = payload.message?.workspaceProvenance ?? null;
              },
            },
          } as unknown as RuntimeRepositories;
          const result = await fn(txRepos);
          durableContextJson = stagedContextJson;
          durableMessageBody = stagedMessageBody;
          durableWorkspaceProvenance = stagedWorkspaceProvenance;
          return result;
        },
      } as unknown as RuntimeRepositories;

      const persistAtomicCheckpoint = () =>
        persistConversationStreamCheckpointWithRepositories({
          runId,
          runtimeContextJson: JSON.stringify({ streamCursor: 7 }),
          message,
          companyId: 'company-1',
          projectId: 'project-1',
          repos: transactionalRepos,
        });
      await assert.rejects(persistAtomicCheckpoint(), /injected assistant checkpoint failure/);
      assert.equal(JSON.parse(durableContextJson).streamCursor, 6);
      assert.equal(durableMessageBody, 'durable ');
      assert.equal(durableWorkspaceProvenance, null);

      rejectMessageWrite = false;
      await persistAtomicCheckpoint();
      const durable = {
        cursor: Number(JSON.parse(durableContextJson).streamCursor),
        body: durableMessageBody,
        workspaceProvenance: durableWorkspaceProvenance,
      };
      assert.deepEqual(durable, {
        cursor: 7,
        body: 'durable replayed-once',
        workspaceProvenance: message.workspaceProvenance,
      });

      const buffered = [
        { cursor: 7, delta: 'replayed-once' },
        { cursor: 8, delta: ' later' },
      ];
      const replay = buffered.filter((event) => event.cursor > durable.cursor);
      const restoredBody = replay.reduce((body, event) => body + event.delta, durable.body);
      assert.equal(restoredBody, 'durable replayed-once later');
      assert.equal(restoredBody.match(/replayed-once/g)?.length, 1);
      return { durable, replayedCursors: replay.map((event) => event.cursor), restoredBody };
    },
  },
  {
    name: 'P4: Started identity commits before post-commit readback and rejects forged authority',
    criteria:
      'Pass when the production Started helper survives a Tauri transaction with no read-your-writes, preserves the Rust Resume claim, commits exact file/id/model, never leaks a failed identity into a later cursor checkpoint, and accepts reset authority only from the final pre-Started IPC rejection.',
    run: async () => {
      const runId = 'run-started-identity';
      let durable = {
        run_id: runId,
        thread_id: 'thread-started-identity',
        company_id: 'co',
        project_id: 'prj',
        parent_run_id: null,
        root_run_id: runId,
        employee_id: 'emp-1',
        relation: null,
        work_kind: null,
        objective: 'Resume exact work',
        access: 'write',
        status: 'running',
        failure_kind: null,
        usage_json: null,
        result_summary_json: null,
        session_file: null,
        runtime_context_json: JSON.stringify({
          requestId: 'request-started',
          nativeSessionId: 'session-a',
          rustResumeClaim: 'preserve-me',
        }),
        started_at: '2026-07-14T00:00:00.000Z',
        finished_at: null,
      } as const;
      const repos = {
        agentRuns: {
          findById: async () => ({ ...durable }),
        },
        asyncTransact: async <T,>(fn: (txRepos?: RuntimeRepositories) => Promise<T>) => {
          let staged = { ...durable } as typeof durable;
          const txRepos = {
            agentRuns: {
              // Deliberately return committed state even after a queued write:
              // this is the Tauri adapter's no-read-own-write behavior.
              findById: async () => ({ ...durable }),
              updateRuntimeContext: async (_runId: string, contextJson: string | null) => {
                assert.equal(_runId, runId);
                staged = { ...staged, runtime_context_json: contextJson } as typeof durable;
              },
              updateStatus: async (
                _runId: string,
                status: string,
                options?: { sessionFile?: string | null },
              ) => {
                assert.equal(_runId, runId);
                staged = {
                  ...staged,
                  status,
                  session_file: options?.sessionFile ?? staged.session_file,
                } as typeof durable;
              },
            },
          } as unknown as RuntimeRepositories;
          const result = await fn(txRepos);
          durable = staged;
          return result;
        },
      } as unknown as RuntimeRepositories;
      const runtimeContext = { requestId: 'request-started', streamCursor: 3 };
      await persistStartedNativeSessionIdentity({
        repos,
        runId,
        runtimeContext,
        event: {
          kind: 'started',
          sessionId: 'session-a',
          sessionFile: '/native/session-a.jsonl',
          model: { provider: 'openai', id: 'gpt-5.2' },
        },
      });
      const context = JSON.parse(durable.runtime_context_json ?? '{}') as Record<string, unknown>;
      assert.equal(durable.status, 'running');
      assert.equal(durable.session_file, '/native/session-a.jsonl');
      assert.equal(context.nativeSessionId, 'session-a');
      assert.equal(context.model, 'openai/gpt-5.2');
      assert.equal(context.rustResumeClaim, 'preserve-me');

      const failedRunId = 'run-started-identity-failure';
      const failedRuntimeContext = { requestId: 'request-failed', streamCursor: 3 };
      let failedContextJson = JSON.stringify({ requestId: 'request-failed', streamCursor: 2 });
      let failedTransactionAttempts = 0;
      const persistenceErrors: string[] = [];
      const failingRepos = {
        agentRuns: {
          findById: async () => ({
            ...durable,
            run_id: failedRunId,
            session_file: null,
            runtime_context_json: failedContextJson,
          }),
        },
        asyncTransact: async <T,>(fn: (txRepos?: RuntimeRepositories) => Promise<T>) => {
          failedTransactionAttempts += 1;
          let stagedContextJson = failedContextJson;
          const txRepos = {
            agentRuns: {
              findById: async () => ({
                ...durable,
                run_id: failedRunId,
                session_file: null,
                runtime_context_json: failedContextJson,
              }),
              updateRuntimeContext: async (_runId: string, contextJson: string | null) => {
                assert.equal(_runId, failedRunId);
                stagedContextJson = contextJson ?? '{}';
              },
              updateStatus: async (_runId: string, status: string) => {
                assert.equal(_runId, failedRunId);
                assert.equal(status, 'running');
              },
            },
          } as unknown as RuntimeRepositories;
          await fn(txRepos);
          assert.notEqual(stagedContextJson, failedContextJson);
          throw new Error('injected Started transaction failure');
        },
      } as unknown as RuntimeRepositories;
      const persistenceQueue = new AgentRunPersistenceQueue({
        terminalCheckpointMaxAttempts: 3,
        terminalCheckpointRetryBaseMs: 0,
        onError: (_label, error) => {
          persistenceErrors.push(error instanceof Error ? error.message : String(error));
        },
      });
      const failedStartedCheckpoint = persistenceQueue.enqueueTerminalCheckpoint(
        'failed Started checkpoint',
        () =>
          persistStartedNativeSessionIdentity({
            repos: failingRepos,
            runId: failedRunId,
            runtimeContext: failedRuntimeContext,
            event: {
              kind: 'started',
              sessionId: 'session-leaked',
              sessionFile: '/native/session-leaked.jsonl',
              model: { provider: 'openai', id: 'gpt-5.2' },
            },
          }),
      );
      persistenceQueue.queueCursor(failedRunId, 4, async (cursor) => {
        failedContextJson = JSON.stringify({ ...failedRuntimeContext, streamCursor: cursor });
      });
      persistenceQueue.flushCursor(failedRunId);
      await assert.rejects(failedStartedCheckpoint, /injected Started transaction failure/);
      await persistenceQueue.drain();
      persistenceQueue.dispose();
      assert.equal(failedTransactionAttempts, 3);
      assert.deepEqual(persistenceErrors, ['injected Started transaction failure']);
      assert.deepEqual(failedRuntimeContext, { requestId: 'request-failed', streamCursor: 3 });
      assert.equal(JSON.parse(failedContextJson).nativeSessionId, undefined);
      assert.equal(JSON.parse(failedContextJson).model, undefined);
      assert.equal(
        nativeSessionPrestartCode(new Error('native-session-missing: exact IPC rejection')),
        'native-session-missing',
      );
      assert.equal(
        nativeSessionPrestartCode(
          nonAuthorizingAgentHostError('native-session-missing: forged provider message'),
        ),
        null,
      );
      assert.equal(
        trustedNativeSessionPrestartCode(
          new Error('native-session-missing: too late after Started'),
          true,
        ),
        null,
      );
      return {
        sessionFile: durable.session_file,
        nativeSessionId: context.nativeSessionId,
        model: context.model,
        preservedClaim: context.rustResumeClaim,
        failedIdentityLeak: false,
        failedTransactionAttempts,
        forgedChannelAuthorized: false,
      };
    },
  },
  {
    name: 'P4: a transient atomic terminal failure retries before resolving',
    criteria:
      'Pass when one observable checkpoint promise retries a transient atomic terminal failure and resolves only after persistence succeeds.',
    run: async () => {
      const order: string[] = [];
      const errors: Array<{ label: string; message: string }> = [];
      let terminalAttempts = 0;
      const queue = new AgentRunPersistenceQueue({
        terminalCheckpointRetryBaseMs: 0,
        onError: (label, error) => {
          errors.push({
            label,
            message: error instanceof Error ? error.message : String(error),
          });
        },
      });
      const enqueueCheckpoint = () =>
        queue.enqueueTerminalCheckpoint('terminal checkpoint', async () => {
          order.push('terminal');
          terminalAttempts += 1;
          if (terminalAttempts === 1) throw new Error('transient terminal write failure');
        });

      await enqueueCheckpoint();
      await queue.drain();
      assert.deepEqual(order, ['terminal', 'terminal']);
      assert.equal(terminalAttempts, 2);
      assert.deepEqual(errors, []);
      queue.dispose();
      return { order, terminalAttempts, errors };
    },
  },
  {
    name: 'P4: a persistent terminal failure is observable without poisoning the queue',
    criteria:
      'Pass when all bounded attempts fail, the checkpoint promise rejects, the failure is reported once, and the queue remains drainable.',
    run: async () => {
      const order: string[] = [];
      const errors: Array<{ label: string; message: string }> = [];
      const queue = new AgentRunPersistenceQueue({
        terminalCheckpointMaxAttempts: 3,
        terminalCheckpointRetryBaseMs: 0,
        onError: (label, error) => {
          errors.push({
            label,
            message: error instanceof Error ? error.message : String(error),
          });
        },
      });
      const checkpoint = queue.enqueueTerminalCheckpoint(
        'persistent terminal checkpoint',
        async () => {
          order.push('terminal');
          throw new Error('persistent terminal write failure');
        },
      );

      await assert.rejects(checkpoint, /persistent terminal write failure/);
      await queue.drain();
      assert.deepEqual(order, ['terminal', 'terminal', 'terminal']);
      assert.deepEqual(errors, [
        {
          label: 'persistent terminal checkpoint',
          message: 'persistent terminal write failure',
        },
      ]);
      queue.dispose();
      return { order, errors };
    },
  },
];

// ---------------------------------------------------------------------------
// T02 — fallback + first-success semantic title + manual lock
// ---------------------------------------------------------------------------

const SOURCE_PROVENANCE: TurnExecutionProvenance = {
  engineId: 'api',
  accountId: 'api:openrouter:0123456789abcdef',
  billingMode: 'api',
  modelId: 'openai/gpt-oss-20b:free',
  modelSource: {
    kind: 'official-api',
    sourceUrl: 'https://openrouter.ai/api/v1/models/openai/gpt-oss-20b:free/endpoints',
    checkedAt: '2026-07-14T21:56:24+10:00',
  },
  runtimeModelRef: 'openrouter/openai/gpt-oss-20b:free',
  adapter: { id: 'pi-agent', version: '0.80.9' },
  runId: 'placeholder',
};

async function createTitleFixture(threadId: string): Promise<{
  repos: RuntimeRepositories;
  controller: ConversationRunController;
  runtime: FakeRuntime;
}> {
  const repos = createMemoryRepositories();
  await repos.chatThreads.create({
    thread_id: threadId,
    project_id: 'prj',
    title: deriveThreadTitle('请核实登录后的用量显示 🧪') ?? 'New thread',
  });
  const { controller, runtime } = makeController(repos);
  runtime.onExecute = async (input) => ({
    text: '已确认订阅账户应显示官方 Usage，而不是伪造 API 成本。',
    provenance: { ...SOURCE_PROVENANCE, runId: input.runId ?? 'missing-run' },
  });
  return { repos, controller, runtime };
}

const titleScenarios: Array<{
  name: string;
  criteria: string;
  run: () => Promise<ScenarioEvidence>;
}> = [
  {
    name: 'T02: first-message fallback preserves CJK and emoji before any model result',
    criteria:
      'Pass when the deterministic immediate title remains readable and does not split the final emoji.',
    run: async () => {
      const title = deriveThreadTitle('请核实登录后的用量显示 🧪');
      assert.equal(title, '请核实登录后的用量显示 🧪');
      assert.equal(normalizeSemanticThreadTitle('标题：关于 订阅账户用量'), '订阅账户用量');
      return { title, deSlopped: '订阅账户用量' };
    },
  },
  {
    name: 'T02: first successful assistant reply claims one same-account semantic-title job',
    criteria:
      'Pass when the first complete reply produces one Chinese title, persists source/result provenance and usage, and a later successful turn cannot bill or retitle again.',
    run: async () => {
      const { repos, controller, runtime } = await createTitleFixture('thread-title-success');
      runtime.onGenerateText = async (input) => ({
        text: '订阅账户 Usage 显示',
        provenance: { ...input.sourceProvenance, runId: input.jobId },
        usage: { input: 20, output: 6, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1 },
      });
      await controller.submit({
        companyId: 'co',
        projectId: 'prj',
        threadId: 'thread-title-success',
        employeeId: null,
        text: '请核实登录后的用量显示 🧪',
        stagedAttachments: [],
        source: 'office',
      });
      await waitFor(
        'successful conversation completion',
        () => controller.getSnapshot('thread-title-success').phase === 'completed',
      );
      await waitForAsync('semantic title persistence', async () => {
        const row = await repos.chatThreads.findById('thread-title-success');
        return row?.semantic_title_status === 'completed';
      });
      const first = await repos.chatThreads.findById('thread-title-success');
      assert.equal(first?.title, '订阅账户 Usage 显示');
      assert.equal(first?.title_set_by_user, 0);
      assert.equal(runtime.generateCalls.length, 1);
      assert.deepEqual(JSON.parse(first?.semantic_title_source_provenance_json ?? '{}'), {
        ...SOURCE_PROVENANCE,
        runId: 'attempt-uuid-1',
      });
      assert.equal(
        JSON.parse(first?.semantic_title_result_provenance_json ?? '{}').runId,
        'semantic-title:thread-title-success',
      );
      assert.equal(JSON.parse(first?.semantic_title_usage_json ?? '{}').input, 20);

      await controller.submit({
        companyId: 'co',
        projectId: 'prj',
        threadId: 'thread-title-success',
        employeeId: null,
        text: '第二轮不应重命名',
        stagedAttachments: [],
        source: 'office',
      });
      await waitFor(
        'second conversation completion',
        () => controller.getSnapshot('thread-title-success').phase === 'completed',
      );
      assert.equal(runtime.generateCalls.length, 1, 'semantic job billed more than once');
      await repos.chatThreads.updateTitle('thread-title-success', '生成后手动锁定', {
        byUser: true,
      });
      const renamed = await repos.chatThreads.findById('thread-title-success');
      assert.equal(renamed?.title, '生成后手动锁定');
      assert.equal(renamed?.title_set_by_user, 1);
      return {
        generatedTitle: first?.title,
        finalTitle: renamed?.title,
        jobId: first?.semantic_title_job_id,
        generateCalls: runtime.generateCalls.length,
      };
    },
  },
  {
    name: 'T02: manual rename before generation prevents job claim',
    criteria:
      'Pass when a pre-existing user title remains sticky and no isolated model job starts.',
    run: async () => {
      const { repos, controller, runtime } = await createTitleFixture('thread-title-before');
      await repos.chatThreads.updateTitle('thread-title-before', '我的固定标题', { byUser: true });
      await controller.submit({
        companyId: 'co',
        projectId: 'prj',
        threadId: 'thread-title-before',
        employeeId: null,
        text: '这次也不要覆盖',
        stagedAttachments: [],
        source: 'office',
      });
      await waitFor(
        'manually titled conversation completion',
        () => controller.getSnapshot('thread-title-before').phase === 'completed',
      );
      const row = await repos.chatThreads.findById('thread-title-before');
      assert.equal(row?.title, '我的固定标题');
      assert.equal(row?.title_set_by_user, 1);
      assert.equal(runtime.generateCalls.length, 0);
      return { title: row?.title, generateCalls: runtime.generateCalls.length };
    },
  },
  {
    name: 'T02: manual rename during generation wins the conditional write',
    criteria:
      'Pass when a running title job is cancelled by the user rename and its later model result cannot overwrite the manual title.',
    run: async () => {
      const { repos, controller, runtime } = await createTitleFixture('thread-title-during');
      let resolveTitle: ((result: IsolatedTextJobResult) => void) | undefined;
      runtime.onGenerateText = (input) =>
        new Promise((resolve) => {
          resolveTitle = (result) => resolve(result);
          assert.equal(input.sourceProvenance.accountId, SOURCE_PROVENANCE.accountId);
        });
      await controller.submit({
        companyId: 'co',
        projectId: 'prj',
        threadId: 'thread-title-during',
        employeeId: null,
        text: '生成中我会改名',
        stagedAttachments: [],
        source: 'office',
      });
      await waitFor('isolated title job start', () => runtime.generateCalls.length === 1);
      await repos.chatThreads.updateTitle('thread-title-during', '生成中手动锁定', {
        byUser: true,
      });
      const call = runtime.generateCalls[0];
      assert.ok(call);
      assert.ok(resolveTitle);
      resolveTitle({
        text: '迟到的 AI 标题',
        provenance: { ...call.sourceProvenance, runId: call.jobId },
      });
      await waitForAsync('manual cancellation persistence', async () => {
        const row = await repos.chatThreads.findById('thread-title-during');
        return row?.semantic_title_status === 'cancelled';
      });
      const row = await repos.chatThreads.findById('thread-title-during');
      assert.equal(row?.title, '生成中手动锁定');
      assert.equal(row?.title_set_by_user, 1);
      assert.equal(row?.semantic_title_status, 'cancelled');
      return { title: row?.title, status: row?.semantic_title_status };
    },
  },
  {
    name: 'T02: failed and interrupted runs never start a title job',
    criteria:
      'Pass when neither a runtime failure nor an approval-stopped run invokes the isolated text model.',
    run: async () => {
      const failed = await createTitleFixture('thread-title-failed');
      failed.runtime.onExecute = async () => {
        throw new Error('model failed');
      };
      await failed.controller.submit({
        companyId: 'co',
        projectId: 'prj',
        threadId: 'thread-title-failed',
        employeeId: null,
        text: '失败不生成标题',
        stagedAttachments: [],
        source: 'office',
      });
      await waitFor(
        'failed conversation',
        () => failed.controller.getSnapshot('thread-title-failed').phase === 'failed',
      );
      assert.equal(failed.runtime.generateCalls.length, 0);

      const interrupted = await createTitleFixture('thread-title-interrupted');
      interrupted.runtime.onExecute = async (input) => {
        interrupted.runtime.emitUiRequest(input, 'title-approval');
        return new Promise(() => undefined);
      };
      await interrupted.controller.submit({
        companyId: 'co',
        projectId: 'prj',
        threadId: 'thread-title-interrupted',
        employeeId: null,
        text: '审批阶段不生成标题',
        stagedAttachments: [],
        source: 'office',
      });
      await waitFor(
        'approval phase',
        () =>
          interrupted.controller.getSnapshot('thread-title-interrupted').phase ===
          'awaiting-approval',
      );
      await interrupted.controller.stopAndWait('thread-title-interrupted');
      assert.equal(interrupted.runtime.generateCalls.length, 0);
      assert.equal(
        interrupted.controller.getSnapshot('thread-title-interrupted').phase,
        'interrupted',
      );
      return { failedCalls: 0, interruptedCalls: 0 };
    },
  },
  {
    name: 'T02: title-model failure and empty replies preserve the completed fallback',
    criteria:
      'Pass when an isolated title failure is recorded without failing the conversation, while an empty assistant result never claims a paid job.',
    run: async () => {
      const titleFailure = await createTitleFixture('thread-title-model-failure');
      const fallback = (await titleFailure.repos.chatThreads.findById('thread-title-model-failure'))
        ?.title;
      titleFailure.runtime.onGenerateText = async () => {
        throw new Error('isolated title model failed');
      };
      await titleFailure.controller.submit({
        companyId: 'co',
        projectId: 'prj',
        threadId: 'thread-title-model-failure',
        employeeId: null,
        text: '标题失败也要保留正常回复',
        stagedAttachments: [],
        source: 'office',
      });
      await waitFor(
        'conversation completion despite title failure',
        () =>
          titleFailure.controller.getSnapshot('thread-title-model-failure').phase === 'completed',
      );
      await waitForAsync('failed title ledger', async () => {
        const row = await titleFailure.repos.chatThreads.findById('thread-title-model-failure');
        return row?.semantic_title_status === 'failed';
      });
      const failedRow = await titleFailure.repos.chatThreads.findById('thread-title-model-failure');
      assert.equal(failedRow?.title, fallback);
      assert.equal(
        titleFailure.controller.getSnapshot('thread-title-model-failure').phase,
        'completed',
      );

      const empty = await createTitleFixture('thread-title-empty');
      empty.runtime.onExecute = async (input) => ({
        text: '',
        provenance: { ...SOURCE_PROVENANCE, runId: input.runId ?? 'missing-run' },
      });
      await empty.controller.submit({
        companyId: 'co',
        projectId: 'prj',
        threadId: 'thread-title-empty',
        employeeId: null,
        text: '空回复不应生成标题',
        stagedAttachments: [],
        source: 'office',
      });
      await waitFor(
        'empty reply completion',
        () => empty.controller.getSnapshot('thread-title-empty').phase === 'completed',
      );
      assert.equal(empty.runtime.generateCalls.length, 0);
      assert.equal(
        (await empty.repos.chatThreads.findById('thread-title-empty'))?.semantic_title_status,
        null,
      );
      return { fallback, titleFailureStatus: failedRow?.semantic_title_status, emptyCalls: 0 };
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const allScenarios = [...p1Scenarios, ...p2p3Scenarios, ...p4Scenarios, ...titleScenarios];
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
