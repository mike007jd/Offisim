import assert from 'node:assert/strict';
import type { RuntimeEvent } from '@offisim/shared-types';
import {
  composerAttachmentScopeKey,
  useComposerAttachmentStore,
} from '../apps/desktop/renderer/src/assistant/composer/composer-attachment-store.js';
import {
  ConversationRunAlreadyActiveError,
  type ConversationRunController,
  ConversationRunMutationLockedError,
  createConversationRunController,
} from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.js';
import { projectEmployeeWorkloads } from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-projections.js';
import type {
  ChatAttachment,
  ChatMessage,
  StagedAttachment,
} from '../apps/desktop/renderer/src/data/types.js';
import type {
  DesktopAgentRunInput,
  DesktopAgentRunResult,
} from '../apps/desktop/renderer/src/runtime/desktop-agent-runtime.js';
import {
  InMemoryEventBus,
  type RuntimeRepositories,
  llmStreamChunk,
  toolExecutionTelemetry,
} from '../packages/core/src/browser.js';

type PersistCall = { message: ChatMessage; companyId: string | null; projectId: string | null };
type AppendEventCall = {
  eventType: string;
  threadId: string;
  companyId: string | null;
  projectId: string | null;
  agentName: string;
  payload: unknown;
  createdAt: Date;
};
type ActiveInteractionRow = {
  thread_id: string;
  company_id: string;
  interaction_id: string;
  kind: string;
  interaction_mode: string;
  request_json: string;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
};
type HistoryRow = {
  history_id: string;
  interaction_id: string;
  thread_id: string;
  company_id: string;
  kind: string;
  interaction_mode: string;
  status: string;
  selected_option_id: string | null;
  freeform_response: string | null;
  request_json: string;
  response_json: string | null;
  payload_json: string | null;
  created_at: string;
  resolved_at: string;
};

type ScenarioEvidence = Record<string, unknown>;

interface HarnessEnv {
  controller: ConversationRunController;
  eventBus: InMemoryEventBus;
  runtime: FakeRuntime;
  persisted: PersistCall[];
  appendedEvents: AppendEventCall[];
  repos: FakeRepos;
}

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (error: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class FakeRuntime {
  executeCalls: DesktopAgentRunInput[] = [];
  aborts: string[] = [];
  answers: Array<{
    requestId: string;
    id: string;
    confirmed?: boolean;
    value?: string;
    cancelled?: boolean;
  }> = [];
  abortWaiters = new Map<string, Deferred<void>>();
  onExecute: (input: DesktopAgentRunInput) => Promise<DesktopAgentRunResult> = async () => ({
    text: 'ok',
  });

  constructor(
    private readonly eventBus: InMemoryEventBus,
    private readonly companyId = 'co',
  ) {}

  async execute(input: DesktopAgentRunInput): Promise<DesktopAgentRunResult> {
    this.executeCalls.push(input);
    return this.onExecute(input);
  }

  abort(threadId: string): void {
    this.aborts.push(threadId);
    this.abortWaiters.get(threadId)?.resolve();
  }

  async waitForAbort(threadId: string): Promise<void> {
    const existing = this.abortWaiters.get(threadId);
    if (existing) return existing.promise;
    const next = new Deferred<void>();
    this.abortWaiters.set(threadId, next);
    return next.promise;
  }

  async answerUiRequest(answer: {
    requestId: string;
    id: string;
    confirmed?: boolean;
    value?: string;
    cancelled?: boolean;
  }): Promise<void> {
    this.answers.push(answer);
  }

  async resume(): Promise<{ finalText: string } | null> {
    return null;
  }

  async dispose(): Promise<void> {}

  emitContent(input: DesktopAgentRunInput, content: string): void {
    this.eventBus.emit(
      llmStreamChunk(this.companyId, input.threadId, 'pi_agent', content, 'content', {
        conversationKey: `test::${input.threadId}`,
        runId: input.runId ?? 'missing-run',
        threadId: input.threadId,
      }),
    );
  }

  emitReasoning(input: DesktopAgentRunInput, content: string): void {
    this.eventBus.emit(
      llmStreamChunk(this.companyId, input.threadId, 'pi_agent', content, 'reasoning', {
        conversationKey: `test::${input.threadId}`,
        runId: input.runId ?? 'missing-run',
        threadId: input.threadId,
      }),
    );
  }

  emitTool(
    input: DesktopAgentRunInput,
    status: 'started' | 'completed' | 'error',
    toolCallId = 'tool-1',
    toolName = 'read_file',
    detail?: string,
  ): void {
    const startedAt = Date.now();
    this.eventBus.emit(
      toolExecutionTelemetry(this.companyId, input.threadId, {
        toolCallId,
        toolName,
        toolType: 'builtin',
        evidenceClass: 'sdk-native',
        threadId: input.threadId,
        nodeName: 'pi_agent',
        employeeId: input.employeeId ?? undefined,
        startedAt,
        completedAt: status === 'started' ? undefined : startedAt + 12,
        durationMs: status === 'started' ? undefined : 12,
        status,
        detail,
        chatConversationKey: `test::${input.threadId}`,
        chatRunId: input.runId ?? 'missing-run',
      }),
    );
  }

  emitUiRequest(input: DesktopAgentRunInput, method: string, id = 'ui-1'): void {
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
        method,
        title: method === 'confirm' ? 'Approve command?' : 'Choose option',
        message: 'Pi Agent needs a decision.',
      },
    } satisfies RuntimeEvent<Record<string, unknown>>);
  }
}

class FakeRepos {
  activeRows = new Map<string, ActiveInteractionRow>();
  historyRows: HistoryRow[] = [];
  failActiveInteractionUpsert = false;
  failActiveInteractionDelete = 0;

  activeInteractions = {
    upsert: async (row: ActiveInteractionRow) => {
      if (this.failActiveInteractionUpsert) {
        throw new Error('active interaction upsert failed');
      }
      this.activeRows.set(row.thread_id, { ...row });
      return row;
    },
    findByThread: async (threadId: string) => this.activeRows.get(threadId) ?? null,
    findByCompany: async (companyId: string) =>
      [...this.activeRows.values()].filter((row) => row.company_id === companyId),
    deleteByThread: async (threadId: string) => {
      if (this.failActiveInteractionDelete > 0) {
        this.failActiveInteractionDelete -= 1;
        throw new Error('active interaction delete failed');
      }
      this.activeRows.delete(threadId);
    },
  };

  interactionHistory = {
    create: async (row: HistoryRow) => {
      this.historyRows.push({ ...row });
      return row;
    },
    listByThread: async (threadId: string) =>
      this.historyRows.filter((row) => row.thread_id === threadId),
    listByCompany: async (companyId: string) =>
      this.historyRows.filter((row) => row.company_id === companyId),
  };

  seedStaleApproval(input: {
    threadId: string;
    companyId: string;
    attemptId: string;
    hostRequestId: string;
    uiRequestId: string;
    createdAt?: string;
  }): void {
    const createdAt = input.createdAt ?? '2026-06-20T00:00:00.000Z';
    this.activeRows.set(input.threadId, {
      thread_id: input.threadId,
      company_id: input.companyId,
      interaction_id: input.uiRequestId,
      kind: 'agent_question',
      interaction_mode: 'human_in_loop',
      request_json: '{}',
      payload_json: JSON.stringify({
        source: 'pi-ui-request',
        attemptId: input.attemptId,
        hostRequestId: input.hostRequestId,
        uiRequestId: input.uiRequestId,
        method: 'confirm',
        title: 'Restarted approval',
        message: 'Restored from active_interactions.',
      }),
      created_at: createdAt,
      updated_at: createdAt,
    });
  }
}

function makeEnv(
  options: { failPersistFirst?: boolean; failActiveInteractionUpsert?: boolean } = {},
): HarnessEnv {
  const eventBus = new InMemoryEventBus();
  const runtime = new FakeRuntime(eventBus);
  const persisted: PersistCall[] = [];
  const appendedEvents: AppendEventCall[] = [];
  const repos = new FakeRepos();
  repos.failActiveInteractionUpsert = options.failActiveInteractionUpsert === true;
  let now = Date.parse('2026-06-20T00:00:00.000Z');
  let uuid = 0;
  let persistCalls = 0;
  const controller = createConversationRunController({
    eventBus,
    runtimeFactory: async () => runtime,
    reposFactory: async () => repos as unknown as RuntimeRepositories,
    materializeTurn: async ({ text, staged }) => ({
      promptText: staged.length ? `${text}\n\n[attachments:${staged.length}]` : text,
      attachments: staged
        .filter((attachment) => attachment.status === 'attached')
        .map(
          (attachment): ChatAttachment => ({
            id: attachment.attachmentId ?? attachment.id,
            name: attachment.name,
            sizeLabel: attachment.sizeLabel,
            ext: attachment.ext,
            mimeType: attachment.mimeType,
            byteLength: attachment.byteLength,
            kind: attachment.kind,
          }),
        ),
    }),
    persistMessage: async (call) => {
      persistCalls += 1;
      // Optionally fail the first durable user-message write. A Loop Mission must
      // not have started yet at this boundary.
      if (options.failPersistFirst && persistCalls === 1) {
        throw new Error('persist failed after loop materialization');
      }
      persisted.push({
        ...call,
        message: JSON.parse(JSON.stringify(call.message)) as ChatMessage,
      });
    },
    appendEvent: async (call) => {
      appendedEvents.push(call);
    },
    now: () => {
      now += 37;
      return now;
    },
    randomUUID: () => `uuid-${++uuid}`,
  });
  return { controller, eventBus, runtime, persisted, appendedEvents, repos };
}

function attachedFile(): StagedAttachment {
  return {
    id: 'att-readme-12',
    attachmentId: 'vault-readme',
    name: 'README.md',
    ext: 'md',
    sizeLabel: '12 B',
    status: 'attached',
    mimeType: 'text/markdown',
    byteLength: 12,
    kind: 'document',
  };
}

async function waitFor(label: string, condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function submitDefault(
  controller: ConversationRunController,
  input: Partial<Parameters<ConversationRunController['submit']>[0]> = {},
) {
  return controller.submit({
    companyId: 'co',
    projectId: 'prj',
    threadId: 'thread-1',
    employeeId: 'emp-1',
    text: 'Draft the launch note',
    stagedAttachments: [],
    source: 'office',
    ...input,
  });
}

const scenarios: Array<{
  name: string;
  criteria: string;
  run: () => Promise<ScenarioEvidence>;
}> = [
  {
    name: 'conversation mutation lock blocks submit and retry during archive/delete',
    criteria:
      'Pass when an idle thread can be locked, submit and retry are rejected while locked without starting Pi, and both succeed after the mutation releases it.',
    run: async () => {
      const env = makeEnv();
      const release = env.controller.acquireMutationLock('thread-1');
      assert.ok(release);
      await assert.rejects(() => submitDefault(env.controller), ConversationRunMutationLockedError);
      release();
      await submitDefault(env.controller);
      await waitFor(
        'post-mutation run complete',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );

      const retryEnv = makeEnv();
      let attempt = 0;
      retryEnv.runtime.onExecute = async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('seed a retryable failed attempt');
        return { text: 'retry completed after mutation release' };
      };
      const failed = await submitDefault(retryEnv.controller);
      await waitFor(
        'retryable run failure',
        () => retryEnv.controller.getSnapshot('thread-1').phase === 'failed',
      );
      const releaseRetry = retryEnv.controller.acquireMutationLock('thread-1');
      assert.ok(releaseRetry);
      await assert.rejects(
        () => retryEnv.controller.retry('thread-1', failed.attemptId),
        ConversationRunMutationLockedError,
      );
      assert.equal(retryEnv.runtime.executeCalls.length, 1, 'locked retry must not start Pi');
      releaseRetry();
      await retryEnv.controller.retry('thread-1', failed.attemptId);
      await waitFor(
        'post-mutation retry complete',
        () => retryEnv.controller.getSnapshot('thread-1').phase === 'completed',
      );
      return {
        submitBlockedWhileLocked: true,
        retryBlockedWhileLocked: true,
        completedAfterRelease: true,
      };
    },
  },
  {
    name: 'attachment drafts are scope-isolated and survive pre-accept persistence failure',
    criteria:
      'Pass when project/thread B cannot see A attachments, a failed first user-message persist leaves A staged, and the successful retry consumes only A.',
    run: async () => {
      const scopeA = { companyId: 'co', projectId: 'prj-a', threadId: 'thread-1' };
      const scopeB = { companyId: 'co', projectId: 'prj-b', threadId: 'thread-b' };
      const keyA = composerAttachmentScopeKey(scopeA);
      const keyB = composerAttachmentScopeKey(scopeB);
      useComposerAttachmentStore.setState({ stagedByScope: {}, storageAvailable: true });
      await useComposerAttachmentStore
        .getState()
        .stageFiles(scopeA, [{ name: 'private-a.md', bytes: 12, type: 'text/markdown' }]);
      await useComposerAttachmentStore
        .getState()
        .stageFiles(scopeB, [{ name: 'brief-b.txt', bytes: 9, type: 'text/plain' }]);
      assert.deepEqual(
        useComposerAttachmentStore.getState().stagedByScope[keyA]?.map((item) => item.name),
        ['private-a.md'],
      );
      assert.deepEqual(
        useComposerAttachmentStore.getState().stagedByScope[keyB]?.map((item) => item.name),
        ['brief-b.txt'],
      );

      const env = makeEnv({ failPersistFirst: true });
      const stagedA = useComposerAttachmentStore.getState().stagedByScope[keyA] ?? [];
      await submitDefault(env.controller, {
        stagedAttachments: stagedA,
        onMessagePersisted: () =>
          useComposerAttachmentStore.getState().consumeStaged(
            scopeA,
            stagedA.map((item) => item.id),
          ),
      });
      await waitFor(
        'failed pre-accept persist',
        () => env.controller.getSnapshot(scopeA.threadId).phase === 'failed',
      );
      assert.equal(useComposerAttachmentStore.getState().stagedByScope[keyA]?.length, 1);

      await submitDefault(env.controller, {
        text: 'Retry with the retained attachment',
        stagedAttachments: stagedA,
        onMessagePersisted: () =>
          useComposerAttachmentStore.getState().consumeStaged(
            scopeA,
            stagedA.map((item) => item.id),
          ),
      });
      await waitFor(
        'attachment retry complete',
        () => env.controller.getSnapshot(scopeA.threadId).phase === 'completed',
      );
      assert.equal(useComposerAttachmentStore.getState().stagedByScope[keyA], undefined);
      assert.deepEqual(
        useComposerAttachmentStore.getState().stagedByScope[keyB]?.map((item) => item.name),
        ['brief-b.txt'],
      );
      useComposerAttachmentStore.setState({ stagedByScope: {} });
      return { failedDraftRetained: true, retryConsumedAOnly: true, bCount: 1 };
    },
  },
  {
    name: 'office success with attachment, reasoning, content and persistence',
    criteria:
      'Pass when the run completes, user attachment is materialized, and final assistant text is persisted complete.',
    run: async () => {
      const env = makeEnv();
      env.runtime.onExecute = async (input) => {
        env.runtime.emitReasoning(input, 'checked context');
        env.runtime.emitContent(input, 'Launch ');
        env.runtime.emitContent(input, 'ready');
        return { text: 'Launch ready', reasoning: 'checked context' };
      };
      await submitDefault(env.controller, { stagedAttachments: [attachedFile()] });
      await waitFor(
        'completed run',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      const snapshot = env.controller.getSnapshot('thread-1');
      assert.equal(snapshot.liveMessages.length, 2);
      assert.equal(snapshot.liveMessages[0]?.attachments?.[0]?.id, 'vault-readme');
      assert.equal(snapshot.liveMessages[1]?.body, 'Launch ready');
      assert.equal(snapshot.liveMessages[1]?.status, 'complete');
      assert.ok(env.persisted.some((call) => call.message.author === 'boss'));
      assert.ok(env.persisted.some((call) => call.message.body === 'Launch ready'));
      return {
        phase: snapshot.phase,
        liveMessages: snapshot.liveMessages.map((message) => message.status),
        persistedCount: env.persisted.length,
      };
    },
  },
  {
    name: 'same-thread duplicate submit is rejected while active',
    criteria:
      'Pass when the second submit fails with ConversationRunAlreadyActiveError and only one runtime execute starts.',
    run: async () => {
      const env = makeEnv();
      const release = new Deferred<DesktopAgentRunResult>();
      env.runtime.onExecute = async (input) => {
        env.runtime.emitContent(input, 'working');
        return release.promise;
      };
      await submitDefault(env.controller);
      await assert.rejects(
        () => submitDefault(env.controller, { text: 'Second request' }),
        ConversationRunAlreadyActiveError,
      );
      release.resolve({ text: 'done' });
      await waitFor(
        'completed duplicate scenario',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      assert.equal(env.runtime.executeCalls.length, 1);
      return { executeCalls: env.runtime.executeCalls.length };
    },
  },
  {
    name: 'idle and global snapshots are stable for React subscribers',
    criteria:
      'Pass when repeated idle/global snapshot reads return the same object until an actual run state change invalidates them.',
    run: async () => {
      const env = makeEnv();
      const idleA = env.controller.getSnapshot('idle-thread');
      const idleB = env.controller.getSnapshot('idle-thread');
      const globalA = env.controller.getGlobalSnapshot();
      const globalB = env.controller.getGlobalSnapshot();
      assert.strictEqual(idleA, idleB);
      assert.strictEqual(globalA, globalB);

      env.runtime.onExecute = async () => ({ text: 'done' });
      await submitDefault(env.controller);
      const globalAfterSubmit = env.controller.getGlobalSnapshot();
      assert.notStrictEqual(globalAfterSubmit, globalA);
      await waitFor(
        'snapshot stability run complete',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      const globalAfterComplete = env.controller.getGlobalSnapshot();
      assert.strictEqual(globalAfterComplete, env.controller.getGlobalSnapshot());
      return {
        idleStable: idleA === idleB,
        globalStableBeforeChange: globalA === globalB,
        invalidatedOnRun: globalAfterSubmit !== globalA,
        completedRuns: globalAfterComplete.runs.map((run) => [run.threadId, run.phase]),
      };
    },
  },
  {
    name: 'different threads run concurrently and stop is scoped',
    criteria: 'Pass when stopping thread A interrupts only A and thread B still completes.',
    run: async () => {
      const env = makeEnv();
      env.runtime.onExecute = async (input) => {
        if (input.threadId === 'thread-a') {
          env.runtime.emitContent(input, 'partial A');
          await env.runtime.waitForAbort('thread-a');
          throw new Error('aborted A');
        }
        env.runtime.emitContent(input, 'B');
        return { text: 'done B' };
      };
      await submitDefault(env.controller, { threadId: 'thread-a', text: 'A' });
      await submitDefault(env.controller, { threadId: 'thread-b', text: 'B' });
      await waitFor(
        'thread A running',
        () => env.controller.getSnapshot('thread-a').phase === 'running',
      );
      env.controller.stop('thread-a');
      await waitFor(
        'thread B completed',
        () => env.controller.getSnapshot('thread-b').phase === 'completed',
      );
      assert.equal(env.controller.getSnapshot('thread-a').phase, 'interrupted');
      assert.deepEqual(env.runtime.aborts, ['thread-a']);
      return {
        threadA: env.controller.getSnapshot('thread-a').phase,
        threadB: env.controller.getSnapshot('thread-b').phase,
        aborts: env.runtime.aborts,
      };
    },
  },
  {
    name: 'retry creates a new attempt and ignores late old deltas',
    criteria:
      'Pass when retry reuses the user turn, completes under a new attempt, and late events from the failed attempt do not mutate the reply.',
    run: async () => {
      const env = makeEnv();
      let count = 0;
      let failedAttempt = '';
      env.runtime.onExecute = async (input) => {
        count += 1;
        if (count === 1) {
          failedAttempt = input.runId ?? '';
          env.runtime.emitContent(input, 'bad partial');
          throw new Error('first failure');
        }
        env.runtime.emitContent(input, 'good');
        return { text: 'good final' };
      };
      await submitDefault(env.controller);
      await waitFor(
        'failed first attempt',
        () => env.controller.getSnapshot('thread-1').phase === 'failed',
      );
      const failedSnapshot = env.controller.getSnapshot('thread-1');
      await env.controller.retry('thread-1', failedSnapshot.attemptId ?? '');
      await waitFor(
        'retry complete',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      env.eventBus.emit(
        llmStreamChunk('co', 'thread-1', 'pi_agent', ' late-old-delta', 'content', {
          conversationKey: 'test::thread-1',
          runId: failedAttempt,
          threadId: 'thread-1',
        }),
      );
      const snapshot = env.controller.getSnapshot('thread-1');
      assert.equal(snapshot.liveMessages[1]?.body, 'good final');
      assert.notEqual(snapshot.attemptId, failedSnapshot.attemptId);
      assert.equal(snapshot.liveMessages[0]?.id, failedSnapshot.liveMessages[0]?.id);
      return {
        firstAttempt: failedSnapshot.attemptId,
        retryAttempt: snapshot.attemptId,
        finalBody: snapshot.liveMessages[1]?.body,
      };
    },
  },
  {
    name: 'Loop persist failure compensates before paid start and retry rematerializes once',
    criteria:
      'Pass when durable message failure starts no Mission, compensates the prepared records, and retry creates exactly one replacement before starting it.',
    run: async () => {
      const env = makeEnv({ failPersistFirst: true });
      let materializeCalls = 0;
      let startCalls = 0;
      let compensateCalls = 0;
      await submitDefault(env.controller, {
        loopExecution: {
          materialize: async () => {
            materializeCalls += 1;
            return {
              start: async () => {
                startCalls += 1;
              },
              compensate: async () => {
                compensateCalls += 1;
              },
            };
          },
        },
      });
      await waitFor(
        'loop turn failed on persist',
        () => env.controller.getSnapshot('thread-1').phase === 'failed',
      );
      assert.equal(materializeCalls, 1);
      assert.equal(compensateCalls, 1, 'failed persist compensated the prepared records');
      assert.equal(startCalls, 0, 'paid Mission never starts before durable message persistence');
      const failedSnapshot = env.controller.getSnapshot('thread-1');

      await env.controller.retry('thread-1', failedSnapshot.attemptId ?? '');
      await waitFor(
        'retry completed via replacement Mission',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      assert.equal(materializeCalls, 2, 'retry creates one replacement after compensation');
      assert.equal(compensateCalls, 1);
      assert.equal(startCalls, 1, 'only the durably-visible replacement Mission starts');
      assert.equal(env.runtime.executeCalls.length, 0, 'Loop retry never degrades into plain chat');
      return { materializeCalls, compensateCalls, startCalls };
    },
  },
  {
    name: 'Loop start failure retries the same ready Mission without duplicate materialization',
    criteria:
      'Pass when start failure leaves the durable message and ready Mission recoverable, and retry starts that exact Mission without another message write or materialization.',
    run: async () => {
      const env = makeEnv();
      let materializeCalls = 0;
      let startCalls = 0;
      let compensateCalls = 0;
      await submitDefault(env.controller, {
        loopExecution: {
          materialize: async () => {
            materializeCalls += 1;
            return {
              start: async () => {
                startCalls += 1;
                if (startCalls === 1) throw new Error('runtime assembly unavailable');
              },
              compensate: async () => {
                compensateCalls += 1;
              },
            };
          },
        },
      });
      await waitFor(
        'recoverable Loop start failure',
        () => env.controller.getSnapshot('thread-1').phase === 'failed',
      );
      assert.equal(materializeCalls, 1);
      assert.equal(startCalls, 1);
      assert.equal(compensateCalls, 0, 'durable message keeps its ready Mission linked');
      assert.equal(env.persisted.length, 1, 'user message is already durable');

      const failedSnapshot = env.controller.getSnapshot('thread-1');
      await env.controller.retry('thread-1', failedSnapshot.attemptId ?? '');
      await waitFor(
        'same ready Mission starts on retry',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      assert.equal(materializeCalls, 1, 'retry does not create a second Mission');
      assert.equal(startCalls, 2, 'retry calls start on the existing prepared Mission');
      assert.equal(env.persisted.length, 1, 'retry does not duplicate the durable user message');
      assert.equal(env.runtime.executeCalls.length, 0);
      return { materializeCalls, startCalls, persistedMessages: env.persisted.length };
    },
  },
  {
    name: 'Stop while Loop materialization is pending compensates without persist or paid start',
    criteria:
      'Pass when Stop wins a deferred materialization race, the returned preparation is compensated, and neither the user message nor Mission run starts.',
    run: async () => {
      const env = makeEnv();
      const materializeStarted = new Deferred<void>();
      const releaseMaterialize = new Deferred<void>();
      let compensateCalls = 0;
      let startCalls = 0;
      await submitDefault(env.controller, {
        loopExecution: {
          materialize: async () => {
            materializeStarted.resolve(undefined);
            await releaseMaterialize.promise;
            return {
              start: async () => {
                startCalls += 1;
              },
              compensate: async () => {
                compensateCalls += 1;
              },
            };
          },
        },
      });
      await materializeStarted.promise;
      await env.controller.stopAndWait('thread-1');
      releaseMaterialize.resolve(undefined);
      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.equal(compensateCalls, 1);
      assert.equal(startCalls, 0);
      assert.equal(env.persisted.length, 0);
      assert.equal(env.controller.getSnapshot('thread-1').phase, 'interrupted');
      return { compensateCalls, startCalls, persistedMessages: env.persisted.length };
    },
  },
  {
    name: 'Stop while Loop message persistence is pending retains one recoverable ready Mission',
    criteria:
      'Pass when a deferred durable write resolves after Stop, no Mission starts, and retry starts the same prepared Mission without another materialization or message write.',
    run: async () => {
      const env = makeEnv();
      const persistStarted = new Deferred<void>();
      const releasePersist = new Deferred<void>();
      let materializeCalls = 0;
      let persistCalls = 0;
      let startCalls = 0;
      const handle = await submitDefault(env.controller, {
        persistMessage: async () => {
          persistCalls += 1;
          persistStarted.resolve(undefined);
          await releasePersist.promise;
        },
        loopExecution: {
          materialize: async () => {
            materializeCalls += 1;
            return {
              start: async () => {
                startCalls += 1;
              },
              compensate: async () => {},
            };
          },
        },
      });
      await persistStarted.promise;
      await env.controller.stopAndWait('thread-1');
      releasePersist.resolve(undefined);
      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.equal(materializeCalls, 1);
      assert.equal(persistCalls, 1);
      assert.equal(startCalls, 0, 'Stop after durable write still blocks paid start');
      assert.equal(env.controller.getSnapshot('thread-1').phase, 'interrupted');

      await env.controller.retry('thread-1', handle.attemptId);
      await waitFor(
        'stopped ready Mission starts on explicit retry',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      assert.equal(materializeCalls, 1, 'retry reuses the exact ready Mission');
      assert.equal(persistCalls, 1, 'durable message is not written twice');
      assert.equal(startCalls, 1);
      return { materializeCalls, persistCalls, startCalls };
    },
  },
  {
    name: 'Stop while a normal user message write is pending never revives the run',
    criteria:
      'Pass when the late durable user write keeps the snapshot interrupted, starts no paid work, and Retry executes once without writing the user message again.',
    run: async () => {
      const env = makeEnv();
      const persistStarted = new Deferred<void>();
      const releasePersist = new Deferred<void>();
      let userPersistCalls = 0;
      env.runtime.onExecute = async () => ({ text: 'completed on retry' });

      const handle = await submitDefault(env.controller, {
        persistMessage: async (message) => {
          if (message.author !== 'boss') return;
          userPersistCalls += 1;
          persistStarted.resolve(undefined);
          await releasePersist.promise;
        },
      });
      await persistStarted.promise;
      await env.controller.stopAndWait('thread-1');
      releasePersist.resolve(undefined);
      await new Promise<void>((resolve) => setImmediate(resolve));

      assert.equal(env.controller.getSnapshot('thread-1').phase, 'interrupted');
      assert.equal(env.runtime.executeCalls.length, 0, 'Stop must prevent the original paid run');
      await env.controller.retry('thread-1', handle.attemptId);
      await waitFor(
        'normal run completes on explicit retry',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      assert.equal(userPersistCalls, 1, 'Retry must reuse the durable user message');
      assert.equal(env.runtime.executeCalls.length, 1);
      return {
        phase: env.controller.getSnapshot('thread-1').phase,
        userPersistCalls,
        executeCalls: env.runtime.executeCalls.length,
      };
    },
  },
  {
    name: 'stop is idempotent and persists interrupted partial assistant checkpoint',
    criteria:
      'Pass when repeated Stop aborts runtime once, snapshot becomes interrupted, and the persisted assistant checkpoint is marked interrupted.',
    run: async () => {
      const env = makeEnv();
      env.runtime.onExecute = async (input) => {
        env.runtime.emitContent(input, 'partial before stop');
        await env.runtime.waitForAbort(input.threadId);
        throw new Error('aborted');
      };
      await submitDefault(env.controller);
      await waitFor(
        'streaming checkpoint',
        () => env.controller.getSnapshot('thread-1').liveMessages.length === 2,
      );
      env.controller.stop('thread-1');
      env.controller.stop('thread-1');
      await waitFor(
        'interrupted run',
        () => env.controller.getSnapshot('thread-1').phase === 'interrupted',
      );
      assert.deepEqual(env.runtime.aborts, ['thread-1']);
      assert.ok(env.persisted.some((call) => call.message.status === 'interrupted'));
      return {
        phase: env.controller.getSnapshot('thread-1').phase,
        aborts: env.runtime.aborts,
        interruptedPersisted: env.persisted.filter((call) => call.message.status === 'interrupted')
          .length,
      };
    },
  },
  {
    name: 'Stop wins while the final assistant write is pending',
    criteria:
      'Pass when Stop retires a run during its final durable write and the late completion cannot change interrupted back to completed.',
    run: async () => {
      const env = makeEnv();
      const finalPersistStarted = new Deferred<void>();
      const releaseFinalPersist = new Deferred<void>();
      const persistedStatuses: ChatMessage['status'][] = [];
      env.runtime.onExecute = async () => ({ text: 'final answer' });

      await submitDefault(env.controller, {
        persistMessage: async (message) => {
          if (message.author === 'employee' && message.status === 'complete') {
            finalPersistStarted.resolve(undefined);
            await releaseFinalPersist.promise;
          }
          persistedStatuses.push(message.status);
        },
      });
      await finalPersistStarted.promise;
      await env.controller.stopAndWait('thread-1');
      assert.equal(env.controller.getSnapshot('thread-1').phase, 'interrupted');
      assert.ok(persistedStatuses.includes('interrupted'));

      releaseFinalPersist.resolve(undefined);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(
        env.controller.getSnapshot('thread-1').phase,
        'interrupted',
        'late final persistence must not resurrect the stopped run',
      );
      return {
        phase: env.controller.getSnapshot('thread-1').phase,
        persistedStatuses,
      };
    },
  },
  {
    name: 'route subscriber unmount does not cancel an active run',
    criteria:
      'Pass when the React-facing subscription can unsubscribe mid-run while the controller keeps receiving runtime events and completes the run.',
    run: async () => {
      const env = makeEnv();
      const release = new Deferred<DesktopAgentRunResult>();
      let notifications = 0;
      const unsubscribe = env.controller.subscribe('thread-1', () => {
        notifications += 1;
      });
      env.runtime.onExecute = async (input) => {
        env.runtime.emitContent(input, 'before route change');
        return release.promise;
      };
      await submitDefault(env.controller);
      await waitFor(
        'streaming before unmount',
        () => env.controller.getSnapshot('thread-1').liveMessages.length === 2,
      );
      unsubscribe();
      const notificationsAfterUnmount = notifications;
      const input = env.runtime.executeCalls[0];
      assert.ok(input);
      env.runtime.emitContent(input, ' after route change');
      release.resolve({ text: 'finished after route change' });
      await waitFor(
        'completed after route unmount',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      const snapshot = env.controller.getSnapshot('thread-1');
      assert.equal(snapshot.liveMessages[1]?.body, 'finished after route change');
      assert.deepEqual(env.runtime.aborts, []);
      assert.equal(notifications, notificationsAfterUnmount);
      return {
        phase: snapshot.phase,
        finalBody: snapshot.liveMessages[1]?.body,
        aborts: env.runtime.aborts,
        notificationsAfterUnmount,
        notificationsFinal: notifications,
      };
    },
  },
  {
    name: 'tool activity is live, persisted, and stripped from stored messages',
    criteria:
      'Pass when tool start/completion updates activity, appends a terminal tool event, and no persisted chat message stores toolCalls.',
    run: async () => {
      const env = makeEnv();
      env.runtime.onExecute = async (input) => {
        env.runtime.emitTool(
          input,
          'started',
          'tool-shell',
          'bash',
          JSON.stringify({ input: { command: 'ls -la' } }),
        );
        env.runtime.emitTool(
          input,
          'completed',
          'tool-shell',
          'bash',
          JSON.stringify({
            result: [{ type: 'text', text: 'total 8\nhello.ts' }],
            details: { exitCode: 0 },
          }),
        );
        env.runtime.emitContent(input, 'read complete');
        return { text: 'read complete' };
      };
      await submitDefault(env.controller);
      await waitFor(
        'tool scenario complete',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      const snapshot = env.controller.getSnapshot('thread-1');
      assert.equal(snapshot.activity[0]?.state, 'done');
      const richDetail = snapshot.activity[0]?.richDetail;
      assert.equal(richDetail?.family, 'terminal');
      if (richDetail?.family !== 'terminal') throw new Error('expected terminal rich detail');
      assert.equal(richDetail.command, 'ls -la');
      assert.equal(richDetail.exitCode, 0);
      assert.equal(richDetail.outputSummary, 'total 8');
      assert.ok(env.appendedEvents.some((event) => event.eventType === 'conversation.run.tool'));
      assert.ok(env.persisted.every((call) => !('toolCalls' in call.message)));
      return {
        activity: snapshot.activity,
        toolEvents: env.appendedEvents.length,
        persistedMessages: env.persisted.length,
      };
    },
  },
  {
    name: 'confirm approval rejects stale answers and resolves the live answer',
    criteria:
      'Pass when a stale approval answer is ignored, the live answer reaches runtime, active interaction moves to history, and the run completes.',
    run: async () => {
      const env = makeEnv();
      env.runtime.onExecute = async (input) => {
        env.runtime.emitUiRequest(input, 'confirm', 'ui-confirm');
        await waitFor('approval answer', () => env.runtime.answers.length === 1);
        env.runtime.emitContent(input, 'approved');
        return { text: 'approved' };
      };
      await submitDefault(env.controller);
      await waitFor(
        'approval pending',
        () => env.controller.getSnapshot('thread-1').phase === 'awaiting-approval',
      );
      const approval = env.controller.getSnapshot('thread-1').approval;
      assert.ok(approval);
      await env.controller.answerApproval({
        threadId: 'thread-1',
        attemptId: 'wrong-attempt',
        hostRequestId: approval.hostRequestId,
        uiRequestId: approval.uiRequestId,
        confirmed: true,
      });
      assert.equal(env.runtime.answers.length, 0);
      await env.controller.answerApproval({
        threadId: 'thread-1',
        attemptId: approval.attemptId,
        hostRequestId: approval.hostRequestId,
        uiRequestId: approval.uiRequestId,
        confirmed: true,
      });
      await waitFor(
        'approval run complete',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      assert.equal(env.runtime.answers[0]?.confirmed, true);
      assert.equal(env.repos.historyRows[0]?.status, 'resolved');
      assert.equal(env.repos.activeRows.size, 0);
      return {
        answers: env.runtime.answers,
        historyStatus: env.repos.historyRows[0]?.status,
        phase: env.controller.getSnapshot('thread-1').phase,
      };
    },
  },
  {
    name: 'confirm approval remains live when active interaction persistence fails',
    criteria:
      'Pass when a confirm UI request still reaches the live snapshot and can be answered even if active_interactions upsert fails.',
    run: async () => {
      const env = makeEnv({ failActiveInteractionUpsert: true });
      env.runtime.onExecute = async (input) => {
        env.runtime.emitUiRequest(input, 'confirm', 'ui-confirm');
        await waitFor(
          'approval answer after failed persist',
          () => env.runtime.answers.length === 1,
        );
        env.runtime.emitContent(input, 'approved despite persist failure');
        return { text: 'approved despite persist failure' };
      };
      await submitDefault(env.controller);
      await waitFor(
        'approval pending despite failed active interaction persist',
        () => env.controller.getSnapshot('thread-1').phase === 'awaiting-approval',
      );
      const approval = env.controller.getSnapshot('thread-1').approval;
      assert.ok(approval);
      assert.equal(env.repos.activeRows.size, 0);
      await env.controller.answerApproval({
        threadId: 'thread-1',
        attemptId: approval.attemptId,
        hostRequestId: approval.hostRequestId,
        uiRequestId: approval.uiRequestId,
        confirmed: true,
      });
      await waitFor(
        'approval run complete after failed persist',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      assert.equal(env.runtime.answers[0]?.confirmed, true);
      return {
        activeRows: env.repos.activeRows.size,
        answers: env.runtime.answers,
        phase: env.controller.getSnapshot('thread-1').phase,
      };
    },
  },
  {
    name: 'unsupported UI request auto-cancels and records history',
    criteria:
      'Pass when non-confirm UI primitives are cancelled automatically, written to history, and do not leave a pending approval.',
    run: async () => {
      const env = makeEnv();
      env.runtime.onExecute = async (input) => {
        env.runtime.emitUiRequest(input, 'select', 'ui-select');
        await waitFor('unsupported auto cancel', () => env.runtime.answers.length === 1);
        env.runtime.emitContent(input, 'continued');
        return { text: 'continued' };
      };
      await submitDefault(env.controller);
      await waitFor(
        'unsupported run complete',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      assert.equal(env.runtime.answers[0]?.cancelled, true);
      assert.equal(env.repos.historyRows[0]?.status, 'cancelled');
      assert.equal(env.controller.getSnapshot('thread-1').approval, null);
      return {
        answer: env.runtime.answers[0],
        historyStatus: env.repos.historyRows[0]?.status,
        approval: env.controller.getSnapshot('thread-1').approval,
      };
    },
  },
  {
    name: 'restart stale approvals and employee work-state projection',
    criteria:
      'Pass when stale approvals hydrate as historical interrupted notices, never enter activeRuns, and direct active runs mark only their assignee working.',
    run: async () => {
      const env = makeEnv();
      env.repos.seedStaleApproval({
        threadId: 'stale-thread',
        companyId: 'co',
        attemptId: 'attempt-stale',
        hostRequestId: 'host-stale',
        uiRequestId: 'ui-stale',
      });
      env.runtime.onExecute = async (input) => {
        env.runtime.emitContent(input, `running ${input.threadId}`);
        await new Promise(() => undefined);
      };
      await env.controller.hydrateStaleApprovals('co');
      await submitDefault(env.controller, { threadId: 'direct-thread', employeeId: 'emp-1' });
      await submitDefault(env.controller, { threadId: 'team-thread', employeeId: null });
      await waitFor(
        'direct running',
        () => env.controller.getSnapshot('direct-thread').phase === 'running',
      );
      await waitFor(
        'team running',
        () => env.controller.getSnapshot('team-thread').phase === 'running',
      );
      const global = env.controller.getGlobalSnapshot();
      const employeeStates = projectEmployeeWorkloads(global, 'prj');
      const staleSnapshot = env.controller.getSnapshot('stale-thread');
      assert.equal(staleSnapshot.approval?.state, 'stale');
      assert.equal(staleSnapshot.phase, 'interrupted');
      assert.equal(
        global.activeRuns.some((run) => run.threadId === 'stale-thread'),
        false,
        'a persisted approval is history, not a live run',
      );
      assert.deepEqual(global.activeRuns.map((run) => run.threadId).sort(), [
        'direct-thread',
        'team-thread',
      ]);
      assert.equal(employeeStates.get('emp-1')?.dominant?.state, 'working');
      assert.equal(employeeStates.get('emp-1')?.activeCount, 1);
      assert.equal(employeeStates.size, 1);
      return {
        staleApproval: env.controller.getSnapshot('stale-thread').approval?.state,
        employeeStates: Array.from(employeeStates.entries()),
        activeRuns: global.activeRuns.map((run) => [run.threadId, run.employeeId, run.phase]),
      };
    },
  },
  {
    name: 'restored approval never blocks or reattaches to a new turn',
    criteria:
      'Pass when a restored approval is non-live, a failed cleanup remains retryable, and Retry clears the transient row before exactly one fresh turn executes.',
    run: async () => {
      const env = makeEnv();
      env.repos.seedStaleApproval({
        threadId: 'stale-thread',
        companyId: 'co',
        attemptId: 'attempt-stale',
        hostRequestId: 'host-stale',
        uiRequestId: 'ui-stale',
      });
      await env.controller.hydrateStaleApprovals('co');
      assert.equal(env.controller.getSnapshot('stale-thread').phase, 'interrupted');
      assert.equal(env.controller.getGlobalSnapshot().activeRuns.length, 0);
      env.repos.failActiveInteractionDelete = 1;

      env.runtime.onExecute = async (input) => {
        env.runtime.emitContent(input, 'fresh turn');
        return { text: 'fresh turn' };
      };
      const first = await submitDefault(env.controller, {
        threadId: 'stale-thread',
        text: 'Start a fresh turn',
      });
      await waitFor('cleanup failure', () => {
        return env.controller.getSnapshot('stale-thread').phase === 'failed';
      });
      assert.equal(env.repos.activeRows.has('stale-thread'), true);
      assert.equal(env.persisted.length, 0, 'cleanup failure must precede message persistence');
      assert.equal(env.runtime.executeCalls.length, 0, 'cleanup failure must precede paid execute');

      await env.controller.retry('stale-thread', first.attemptId);
      await waitFor('fresh turn completion', () => {
        return env.controller.getSnapshot('stale-thread').phase === 'completed';
      });

      const completed = env.controller.getSnapshot('stale-thread');
      assert.equal(completed.approval, null);
      assert.equal(env.repos.activeRows.has('stale-thread'), false);
      assert.equal(env.runtime.executeCalls.length, 1);
      assert.equal(
        env.persisted.filter((call) => call.message.author === 'boss').length,
        1,
        'retry must persist the fresh user message exactly once',
      );
      return {
        phase: completed.phase,
        approval: completed.approval,
        activeInteraction: env.repos.activeRows.has('stale-thread'),
        cleanupRetried: true,
      };
    },
  },
  {
    name: 'hydrated approvals past the expiry window classify as expired (A3)',
    criteria:
      'Pass when a restored UI request older than the 24h expiry window hydrates as `expired` (dismiss-only), while a recent one hydrates as `stale`.',
    run: async () => {
      const env = makeEnv();
      // Base now is 2026-06-20; an approval from 2026-06-17 is >24h old → expired.
      env.repos.seedStaleApproval({
        threadId: 'recent-thread',
        companyId: 'co',
        attemptId: 'attempt-recent',
        hostRequestId: 'host-recent',
        uiRequestId: 'ui-recent',
        createdAt: '2026-06-20T00:00:00.000Z',
      });
      env.repos.seedStaleApproval({
        threadId: 'old-thread',
        companyId: 'co',
        attemptId: 'attempt-old',
        hostRequestId: 'host-old',
        uiRequestId: 'ui-old',
        createdAt: '2026-06-17T00:00:00.000Z',
      });
      await env.controller.hydrateStaleApprovals('co');
      const recent = env.controller.getSnapshot('recent-thread').approval;
      const old = env.controller.getSnapshot('old-thread').approval;
      assert.equal(recent?.state, 'stale', 'a fresh restored request is stale');
      assert.equal(old?.state, 'expired', 'a >24h restored request is expired');
      return { recent: recent?.state, old: old?.state };
    },
  },
  {
    name: 'same employee concurrent runs aggregate to one actor with activeCount',
    criteria:
      'Pass when two concurrent runs on one employee collapse to a single workload entry with activeCount = 2 and a working dominant — never a duplicated actor.',
    run: async () => {
      const env = makeEnv();
      env.runtime.onExecute = async (input) => {
        env.runtime.emitContent(input, `running ${input.threadId}`);
        await new Promise(() => undefined);
      };
      await submitDefault(env.controller, { threadId: 'thread-a', employeeId: 'emp-1' });
      await submitDefault(env.controller, { threadId: 'thread-b', employeeId: 'emp-1' });
      await waitFor('a running', () => env.controller.getSnapshot('thread-a').phase === 'running');
      await waitFor('b running', () => env.controller.getSnapshot('thread-b').phase === 'running');
      const workloads = projectEmployeeWorkloads(env.controller.getGlobalSnapshot(), 'prj');
      const emp = workloads.get('emp-1');
      assert.equal(workloads.size, 1);
      assert.equal(emp?.activeCount, 2);
      assert.equal(emp?.waitingCount, 0);
      assert.equal(emp?.dominant?.state, 'working');
      assert.equal(emp?.activeRunIds.length, 2);
      assert.equal(emp?.workloadChips.length, 2);
      assert.deepEqual(
        emp?.workloadChips.map((chip) => chip.label),
        ['Work', 'Work'],
      );
      return {
        activeCount: emp?.activeCount,
        activeRunIds: [...(emp?.activeRunIds ?? [])],
        workloadChips: emp?.workloadChips,
      };
    },
  },
  {
    name: 'terminal run does not override a still-running run on the same employee',
    criteria:
      'Pass when a completed run B drops out of the workload and the still-running run A becomes the dominant — the office returns to active work, not the just-finished run.',
    run: async () => {
      const env = makeEnv();
      env.runtime.onExecute = async (input) => {
        if (input.threadId === 'thread-b') {
          env.runtime.emitContent(input, 'done b');
          return { text: 'done b' };
        }
        env.runtime.emitContent(input, 'running a');
        await new Promise(() => undefined);
      };
      await submitDefault(env.controller, { threadId: 'thread-a', employeeId: 'emp-1' });
      await submitDefault(env.controller, { threadId: 'thread-b', employeeId: 'emp-1' });
      await waitFor('a running', () => env.controller.getSnapshot('thread-a').phase === 'running');
      await waitFor(
        'b completed',
        () => env.controller.getSnapshot('thread-b').phase === 'completed',
      );
      const attemptA = env.controller.getSnapshot('thread-a').attemptId;
      const workloads = projectEmployeeWorkloads(env.controller.getGlobalSnapshot(), 'prj');
      const emp = workloads.get('emp-1');
      assert.equal(emp?.activeCount, 1);
      assert.equal(emp?.dominant?.state, 'working');
      assert.equal(emp?.dominant?.runId, attemptA);
      return { activeCount: emp?.activeCount, dominantRunId: emp?.dominant?.runId, attemptA };
    },
  },
  {
    name: 'delegation records retain workKind and typed failureKind',
    criteria:
      'Pass when run.started seeds RunDelegation.workKind from the event scope, a failed terminal copies the typed failureKind from the finished payload, and completed/cancelled terminals never carry one.',
    run: async () => {
      const env = makeEnv();
      env.runtime.onExecute = async (input) => {
        const emitAgentRun = (evt: Record<string, unknown>): void => {
          env.eventBus.emit({
            type: 'agent.run',
            entityId: String(evt.runId),
            entityType: 'runtime',
            companyId: 'co',
            threadId: input.threadId,
            timestamp: Date.now(),
            payload: {
              threadId: input.threadId,
              rootRunId: input.runId,
              parentRunId: input.runId,
              ...evt,
            },
          } satisfies RuntimeEvent<Record<string, unknown>>);
        };
        const children = [
          {
            runId: 'child-fail',
            employeeId: 'emp-2',
            workKind: 'test',
            objective: 'Run the suite',
            access: 'read',
            terminal: {
              type: 'run.failed',
              payload: {
                status: 'failed',
                failureKind: 'runtime',
                summary: 'Timed out after 300s',
              },
            },
          },
          {
            runId: 'child-done',
            employeeId: 'emp-3',
            workKind: 'research',
            objective: 'Scan the docs',
            access: 'read',
            terminal: {
              type: 'run.completed',
              payload: { status: 'completed', summary: 'Docs scanned.' },
            },
          },
          {
            runId: 'child-cancel',
            employeeId: 'emp-4',
            workKind: 'implement',
            objective: 'Draft the patch',
            access: 'write',
            terminal: {
              type: 'run.cancelled',
              payload: { status: 'cancelled', summary: 'Stopped by the lead.' },
            },
          },
        ] as const;
        for (const child of children) {
          emitAgentRun({
            runId: child.runId,
            employeeId: child.employeeId,
            workKind: child.workKind,
            type: 'run.started',
            payload: { objective: child.objective, access: child.access },
          });
        }
        for (const child of children) {
          emitAgentRun({
            runId: child.runId,
            employeeId: child.employeeId,
            workKind: child.workKind,
            type: child.terminal.type,
            payload: child.terminal.payload,
          });
        }
        env.runtime.emitContent(input, 'delegated work wrapped up');
        return { text: 'delegated work wrapped up' };
      };
      await submitDefault(env.controller);
      await waitFor(
        'delegation scenario complete',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      const delegations = env.controller.getSnapshot('thread-1').delegations;
      const failed = delegations.find((d) => d.runId === 'child-fail');
      const done = delegations.find((d) => d.runId === 'child-done');
      const cancelled = delegations.find((d) => d.runId === 'child-cancel');
      assert.equal(failed?.workKind, 'test', 'run.started seeded workKind on the failed child');
      assert.equal(failed?.state, 'failed');
      assert.equal(failed?.failureKind, 'runtime', 'failed terminal copied the typed failureKind');
      assert.equal(done?.workKind, 'research');
      assert.equal(done?.state, 'done');
      assert.equal(done?.failureKind, undefined, 'completed terminal carries no failureKind');
      assert.equal(cancelled?.workKind, 'implement');
      assert.equal(cancelled?.state, 'cancelled');
      assert.equal(cancelled?.failureKind, undefined, 'cancelled terminal carries no failureKind');
      return {
        delegations: delegations.map((d) => [d.runId, d.state, d.workKind, d.failureKind ?? null]),
      };
    },
  },
];

const results: Array<{
  name: string;
  criteria: string;
  method: 'pass/fail';
  outcome: 'pass' | 'fail';
  evidence?: ScenarioEvidence;
  error?: string;
}> = [];

for (const scenario of scenarios) {
  try {
    const evidence = await scenario.run();
    results.push({
      name: scenario.name,
      criteria: scenario.criteria,
      method: 'pass/fail',
      outcome: 'pass',
      evidence,
    });
  } catch (error) {
    results.push({
      name: scenario.name,
      criteria: scenario.criteria,
      method: 'pass/fail',
      outcome: 'fail',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const failed = results.filter((result) => result.outcome === 'fail');
console.log(JSON.stringify({ scenarioCount: scenarios.length, results }, null, 2));
if (failed.length > 0) {
  console.error(`conversation-run-controller harness failed: ${failed.length}/${scenarios.length}`);
  process.exit(1);
}
console.log(`conversation-run-controller harness passed: ${scenarios.length}/${scenarios.length}`);
