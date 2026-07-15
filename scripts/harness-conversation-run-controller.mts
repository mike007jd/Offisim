import assert from 'node:assert/strict';
import { CHAT_ATTACHMENT_MAX_BYTES, type RuntimeEvent } from '@offisim/shared-types';
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
  AgentPromptImage,
  AgentQueueBehavior,
  AgentQueuedMessage,
  AgentUiAnswer,
  DesktopAgentRunInput,
  DesktopAgentRunResult,
  ReattachedAgentRun,
  ReattachedAgentRunObserver,
} from '../apps/desktop/renderer/src/runtime/desktop-agent-runtime.js';
import { DesktopPiAgentRuntime } from '../apps/desktop/renderer/src/runtime/desktop-agent-runtime.js';
import {
  type AgentRunRow,
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
  admissions: DesktopAgentRunInput[] = [];
  executeCalls: DesktopAgentRunInput[] = [];
  resumeCalls: Array<{
    runId: string;
    restart?: { text: string; images?: readonly AgentPromptImage[]; threadId: string };
  }> = [];
  queuedMessages: Array<{ threadId: string; message: AgentQueuedMessage }> = [];
  queueFailures = new Map<number, Error>();
  deferQueueAcks = false;
  queueAcks = new Map<string, Deferred<void>>();
  aborts: string[] = [];
  settlements: Array<{
    threadId: string;
    status: 'completed' | 'failed' | 'cancelled';
  }> = [];
  childAborts: Array<{ threadId: string; runId: string }> = [];
  answers: Array<{
    requestId: string;
    id: string;
    confirmed?: boolean;
    value?: string;
    cancelled?: boolean;
  }> = [];
  abortWaiters = new Map<string, Deferred<void>>();
  reattachRuns: ReattachedAgentRun[] = [];
  reattachObservers = new Map<string, ReattachedAgentRunObserver>();
  onExecute: (input: DesktopAgentRunInput) => Promise<DesktopAgentRunResult> = async () => ({
    text: 'ok',
  });
  onResume: (
    runId: string,
    restart?: { text: string; images?: readonly AgentPromptImage[]; threadId: string },
  ) => Promise<DesktopAgentRunResult> = async () => ({ text: 'resumed' });
  onAbort?: (threadId: string) => void | Promise<void>;
  onAnswer?: (answer: AgentUiAnswer) => void | Promise<void>;

  constructor(
    private readonly eventBus: InMemoryEventBus,
    private readonly companyId = 'co',
  ) {}

  async admitRun(input: DesktopAgentRunInput): Promise<void> {
    this.admissions.push(input);
  }

  async execute(input: DesktopAgentRunInput): Promise<DesktopAgentRunResult> {
    this.executeCalls.push(input);
    return this.onExecute(input);
  }

  async abort(threadId: string): Promise<void> {
    this.aborts.push(threadId);
    await this.onAbort?.(threadId);
    this.abortWaiters.get(threadId)?.resolve();
  }

  async settleRun(threadId: string, status: 'completed' | 'failed' | 'cancelled'): Promise<void> {
    this.settlements.push({ threadId, status });
  }

  abortChild(threadId: string, runId: string): void {
    this.childAborts.push({ threadId, runId });
  }

  async queueMessage(threadId: string, message: AgentQueuedMessage): Promise<void> {
    this.queuedMessages.push({
      threadId,
      message: {
        ...message,
        images: message.images ? [...message.images] : undefined,
      },
    });
    const failure = this.queueFailures.get(this.queuedMessages.length);
    if (failure) throw failure;
    if (this.deferQueueAcks) {
      const acknowledgement = new Deferred<void>();
      this.queueAcks.set(message.id, acknowledgement);
      await acknowledgement.promise;
      this.queueAcks.delete(message.id);
    }
  }

  async reattachLiveRuns(
    claim: (run: ReattachedAgentRun) => Promise<ReattachedAgentRunObserver | null>,
  ): Promise<readonly string[]> {
    const attached: string[] = [];
    for (const run of this.reattachRuns) {
      const observer = await claim(run);
      if (!observer) continue;
      this.reattachObservers.set(run.runId, observer);
      attached.push(run.runId);
      await observer.onReady?.();
    }
    return attached;
  }

  async completeReattached(runId: string, result: DesktopAgentRunResult): Promise<void> {
    const observer = this.reattachObservers.get(runId);
    assert(observer, `missing reattach observer for ${runId}`);
    await observer.onResult(result);
  }

  async failReattached(runId: string, error: Error): Promise<void> {
    const observer = this.reattachObservers.get(runId);
    assert(observer, `missing reattach observer for ${runId}`);
    await observer.onError(error);
  }

  async cancelReattached(runId: string): Promise<void> {
    const observer = this.reattachObservers.get(runId);
    assert(observer, `missing reattach observer for ${runId}`);
    await observer.onCancelled?.();
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
    await this.onAnswer?.(answer);
  }

  async resume(
    runId: string,
    restart?: { text: string; images?: readonly AgentPromptImage[]; threadId: string },
  ): Promise<DesktopAgentRunResult> {
    this.resumeCalls.push({ runId, restart });
    return this.onResume(runId, restart);
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

  emitUiRequest(
    input: DesktopAgentRunInput,
    method: string,
    id = 'ui-1',
    detail: {
      title?: string;
      message?: string;
      options?: string[];
      placeholder?: string;
      prefill?: string;
    } = {},
  ): void {
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
        title: detail.title ?? (method === 'confirm' ? 'Approve command?' : 'Pi needs input'),
        message: detail.message ?? 'Pi Agent needs a decision.',
        options: detail.options,
        placeholder: detail.placeholder,
        prefill: detail.prefill,
      },
    } satisfies RuntimeEvent<Record<string, unknown>>);
  }

  emitLifecycle(input: DesktopAgentRunInput, event: string, data: Record<string, unknown>): void {
    if (event === 'control' && typeof data.controlId === 'string') {
      const acknowledgement = this.queueAcks.get(data.controlId);
      if (data.state === 'accepted' || data.state === 'consumed') acknowledgement?.resolve();
      if (data.state === 'failed' || data.state === 'rejected') {
        acknowledgement?.reject(new Error('Pi rejected the queued instruction.'));
      }
    }
    this.eventBus.emit({
      type: 'agent.lifecycle',
      entityId: input.runId ?? input.threadId,
      entityType: 'runtime',
      companyId: this.companyId,
      threadId: input.threadId,
      timestamp: Date.now(),
      payload: {
        requestId: `host-${input.threadId}`,
        runId: input.runId ?? 'missing-run',
        event,
        data,
      },
    } satisfies RuntimeEvent<Record<string, unknown>>);
  }
}

class FakeRepos {
  activeRows = new Map<string, ActiveInteractionRow>();
  historyRows: HistoryRow[] = [];
  failActiveInteractionUpsert = false;
  agentRunRows = new Map<string, Record<string, unknown>>();

  agentRuns = {
    findById: async (runId: string) => this.agentRunRows.get(runId) ?? null,
  };

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
  options: {
    failPersistFirst?: boolean;
    failActiveInteractionUpsert?: boolean;
    materializeImages?: (input: {
      text: string;
      staged: readonly StagedAttachment[];
    }) => AgentPromptImage[];
    reattachRuns?: ReattachedAgentRun[];
    loadedMessages?: ChatMessage[];
    rehydrateImages?: (input: {
      text: string;
      attachments: readonly ChatAttachment[];
    }) => AgentPromptImage[];
    interruptedRun?: Record<string, unknown>;
  } = {},
): HarnessEnv {
  const eventBus = new InMemoryEventBus();
  const runtime = new FakeRuntime(eventBus);
  runtime.reattachRuns = options.reattachRuns ?? [];
  const persisted: PersistCall[] = [];
  const appendedEvents: AppendEventCall[] = [];
  const repos = new FakeRepos();
  if (options.interruptedRun) {
    repos.agentRunRows.set(String(options.interruptedRun.run_id), options.interruptedRun);
  }
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
      images: options.materializeImages?.({ text, staged }) ?? [],
    }),
    rehydrateTurn: async ({ text, attachments }) => ({
      promptText: attachments.length ? `${text}\n\n[rehydrated:${attachments.length}]` : text,
      attachments: [...attachments],
      images: options.rehydrateImages?.({ text, attachments }) ?? [],
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
    loadMessages: async () => options.loadedMessages ?? [],
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

function attachedImage(
  id: string,
  name: string,
  mimeType: 'image/png' | 'image/webp',
): StagedAttachment {
  return {
    id,
    attachmentId: `vault-${id}`,
    name,
    ext: mimeType === 'image/png' ? 'png' : 'webp',
    sizeLabel: '1 KB',
    status: 'attached',
    mimeType,
    byteLength: 1024,
    kind: 'image',
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

async function enqueueDefault(
  controller: ConversationRunController,
  behavior: AgentQueueBehavior,
  input: Partial<Parameters<ConversationRunController['enqueue']>[0]> = {},
) {
  return controller.enqueue(
    {
      companyId: 'co',
      projectId: 'prj',
      threadId: 'thread-1',
      employeeId: 'emp-1',
      text: 'Refine the active turn',
      stagedAttachments: [],
      source: 'office',
      ...input,
    },
    behavior,
  );
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
      'Pass when project/thread B cannot see A attachments, durable run admission precedes a failed first user-message persist without starting Pi, A remains staged, and the successful retry consumes only A.',
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
      assert.equal(env.runtime.admissions.length, 1, 'run intent is durable before message write');
      assert.equal(env.runtime.executeCalls.length, 0, 'failed message write starts no Pi host');
      assert.deepEqual(env.runtime.settlements, [{ threadId: scopeA.threadId, status: 'failed' }]);

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
      return {
        admissionBeforeMessage: true,
        failedDraftRetained: true,
        retryConsumedAOnly: true,
        bCount: 1,
      };
    },
  },
  {
    name: 'attachment staging gates reads, isolates failures, and deduplicates by content',
    criteria:
      'Pass when metadata rejects oversized files before reading, valid files hydrate one at a time, one read failure leaves its own chip, same-name/same-size different content survives, and byte-identical content is rejected.',
    run: async () => {
      const scope = { companyId: 'co', projectId: 'prj', threadId: 'attachment-identity' };
      const key = composerAttachmentScopeKey(scope);
      const store = useComposerAttachmentStore.getState();
      useComposerAttachmentStore.setState({ stagedByScope: {}, storageAvailable: true });
      const firstRead = new Deferred<void>();
      const releaseFirstRead = new Deferred<void>();
      const readOrder: string[] = [];
      let oversizedReads = 0;
      const bytesA = Uint8Array.from([1, 2, 3]);
      const bytesB = Uint8Array.from([3, 2, 1]);

      const staging = store.stageFiles(scope, [
        {
          name: 'huge.png',
          bytes: CHAT_ATTACHMENT_MAX_BYTES + 1,
          type: 'image/png',
          file: {
            arrayBuffer: async () => {
              oversizedReads += 1;
              return Uint8Array.from([9]).buffer;
            },
          },
        },
        {
          name: 'same.txt',
          bytes: bytesA.byteLength,
          type: 'text/plain',
          file: {
            arrayBuffer: async () => {
              readOrder.push('first:start');
              firstRead.resolve(undefined);
              await releaseFirstRead.promise;
              readOrder.push('first:end');
              return bytesA.buffer;
            },
          },
        },
        {
          name: 'broken.txt',
          bytes: 4,
          type: 'text/plain',
          file: {
            arrayBuffer: async () => {
              readOrder.push('broken');
              throw new Error('native read denied');
            },
          },
        },
        {
          name: 'same.txt',
          bytes: bytesB.byteLength,
          type: 'text/plain',
          file: {
            arrayBuffer: async () => {
              readOrder.push('second');
              return bytesB.buffer;
            },
          },
        },
      ]);
      await firstRead.promise;
      assert.deepEqual(readOrder, ['first:start']);
      assert.equal(oversizedReads, 0);
      releaseFirstRead.resolve(undefined);
      await staging;

      const staged = useComposerAttachmentStore.getState().stagedByScope[key] ?? [];
      assert.equal(staged.find((item) => item.name === 'huge.png')?.failReason, 'too-large');
      assert.equal(
        staged.find((item) => item.name === 'broken.txt')?.failReason,
        'storage-unavailable',
      );
      const sameNameAttached = staged.filter(
        (item) => item.name === 'same.txt' && item.status === 'attached',
      );
      assert.equal(sameNameAttached.length, 2);
      assert.notEqual(sameNameAttached[0]?.sha256, sameNameAttached[1]?.sha256);
      assert.deepEqual(readOrder, ['first:start', 'first:end', 'broken', 'second']);

      await useComposerAttachmentStore.getState().stageFiles(scope, [
        {
          name: 'renamed.txt',
          bytes: bytesA.byteLength,
          type: 'text/plain',
          file: { arrayBuffer: async () => bytesA.buffer },
        },
      ]);
      const finalStaged = useComposerAttachmentStore.getState().stagedByScope[key] ?? [];
      assert.equal(
        finalStaged.find((item) => item.name === 'renamed.txt')?.failReason,
        'duplicate',
      );
      assert.equal(finalStaged.filter((item) => item.status === 'attached').length, 2);
      useComposerAttachmentStore.setState({ stagedByScope: {} });
      return {
        readOrder,
        oversizedReads,
        attachedHashes: sameNameAttached.map((item) => item.sha256),
      };
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
    name: 'renderer reload adopts the live Pi run and persists its real terminal reply',
    criteria:
      'Pass when bootstrap claims a surviving host before a duplicate submit, restores the current transcript/checkpoint, and the reattached terminal replaces that checkpoint with the final reply.',
    run: async () => {
      const base = Date.parse('2026-06-20T00:00:00.000Z');
      const descriptor: ReattachedAgentRun = {
        requestId: 'host-live-1',
        runId: 'attempt-live-1',
        companyId: 'co',
        threadId: 'thread-1',
        employeeId: 'emp-1',
        projectId: 'prj',
        objective: 'Keep working through renderer reload',
        startedAt: new Date(base + 2_500).toISOString(),
      };
      const rootUser: ChatMessage = {
        id: 'boss-live-root',
        threadId: 'thread-1',
        author: 'boss',
        employeeId: null,
        body: descriptor.objective,
        at: base + 2_000,
        attemptId: descriptor.runId,
        status: 'complete',
      };
      const queuedUser: ChatMessage = {
        id: 'boss-live-queued',
        threadId: 'thread-1',
        author: 'boss',
        employeeId: null,
        body: 'Also include the accessibility findings.',
        at: base + 4_000,
        attemptId: descriptor.runId,
        queueBehavior: 'followUp',
        queueState: 'accepted',
        status: 'complete',
      };
      const checkpoint: ChatMessage = {
        id: 'assistant-live-checkpoint',
        threadId: 'thread-1',
        author: 'employee',
        employeeId: 'emp-1',
        body: 'Partial before reload',
        at: base + 3_000,
        attemptId: descriptor.runId,
        streamCursor: 17,
        status: 'interrupted',
      };
      const env = makeEnv({
        reattachRuns: [descriptor],
        loadedMessages: [
          {
            id: 'assistant-previous',
            threadId: 'thread-1',
            author: 'employee',
            employeeId: 'emp-1',
            body: 'Previous answer',
            at: base + 1_000,
            status: 'complete',
          },
          rootUser,
          checkpoint,
          queuedUser,
        ],
      });

      const attached = await env.controller.hydrateRuntimeState('co');
      assert.deepEqual([...attached], [descriptor.runId]);
      const running = env.controller.getSnapshot('thread-1');
      assert.equal(running.phase, 'running');
      assert.deepEqual(
        running.liveMessages.map((message) => message.id),
        [rootUser.id, queuedUser.id, checkpoint.id],
      );
      await assert.rejects(() => submitDefault(env.controller), ConversationRunAlreadyActiveError);

      await env.runtime.completeReattached(descriptor.runId, {
        text: 'Final answer after renderer reload',
      });
      const completed = env.controller.getSnapshot('thread-1');
      assert.equal(completed.phase, 'completed');
      assert.equal(completed.liveMessages.at(-1)?.id, checkpoint.id);
      assert.equal(completed.liveMessages.at(-1)?.body, 'Final answer after renderer reload');
      assert.equal(completed.liveMessages.at(-1)?.replyToMessageId, queuedUser.id);
      return {
        attachedRunIds: [...attached],
        finalMessageId: completed.liveMessages.at(-1)?.id,
        replyToMessageId: completed.liveMessages.at(-1)?.replyToMessageId,
      };
    },
  },
  {
    name: 'renderer reload redelivers only durable pending controls with vault attachments',
    criteria:
      'Pass when a queued message persisted before host admission is rebuilt from its vault metadata, keeps steer semantics and native images, and advances pending to accepted exactly once.',
    run: async () => {
      const base = Date.parse('2026-06-20T00:00:00.000Z');
      const descriptor: ReattachedAgentRun = {
        requestId: 'host-live-pending',
        runId: 'attempt-live-pending',
        companyId: 'co',
        threadId: 'thread-1',
        employeeId: 'emp-1',
        projectId: 'prj',
        objective: 'Root objective',
        startedAt: new Date(base + 2_500).toISOString(),
      };
      const queuedImage: AgentPromptImage = {
        data: 'cmVoeWRyYXRlZA==',
        mimeType: 'image/png',
      };
      const rootUser: ChatMessage = {
        id: 'boss-pending-root',
        threadId: 'thread-1',
        author: 'boss',
        employeeId: null,
        body: descriptor.objective,
        at: base + 2_000,
        attemptId: descriptor.runId,
        status: 'complete',
      };
      const queuedUser: ChatMessage = {
        id: 'boss-pending-control',
        threadId: 'thread-1',
        author: 'boss',
        employeeId: null,
        body: 'Inspect the queued image.',
        at: base + 3_000,
        attemptId: descriptor.runId,
        queueBehavior: 'steer',
        queueState: 'pending',
        attachments: [
          {
            id: 'vault-queued-image',
            name: 'queued.png',
            ext: 'png',
            sizeLabel: '1 KB',
            mimeType: 'image/png',
            byteLength: 1024,
            kind: 'image',
            vaultRef: 'co/thread/vault-queued-image' as ChatAttachment['vaultRef'],
          },
        ],
        status: 'complete',
      };
      const env = makeEnv({
        reattachRuns: [descriptor],
        loadedMessages: [rootUser, queuedUser],
        rehydrateImages: ({ text }) => (text === queuedUser.body ? [queuedImage] : []),
      });

      await env.controller.hydrateRuntimeState('co');
      assert.deepEqual(env.runtime.queuedMessages, [
        {
          threadId: 'thread-1',
          message: {
            id: queuedUser.id,
            text: `${queuedUser.body}\n\n[rehydrated:1]`,
            images: [queuedImage],
            behavior: 'steer',
          },
        },
      ]);
      const latest = env.persisted.filter((call) => call.message.id === queuedUser.id).at(-1);
      assert.equal(latest?.message.queueState, 'accepted');
      return {
        controlId: env.runtime.queuedMessages[0]?.message.id,
        behavior: env.runtime.queuedMessages[0]?.message.behavior,
        queueState: latest?.message.queueState,
      };
    },
  },
  {
    name: 'durable Resume stays controller-owned and starts a new assistant response',
    criteria:
      'Pass when Resume immediately blocks duplicate submit, a restarted host can answer redelivery with consumed without regressing to accepted, the old partial stays interrupted, and a distinct final assistant message is persisted.',
    run: async () => {
      const base = Date.parse('2026-06-20T00:00:00.000Z');
      const runId = 'attempt-interrupted-resume';
      const rootUser: ChatMessage = {
        id: 'boss-resume-root',
        threadId: 'thread-1',
        author: 'boss',
        employeeId: null,
        body: 'Finish the recovery report.',
        at: base,
        attemptId: runId,
        status: 'complete',
      };
      const queuedUser: ChatMessage = {
        id: 'boss-resume-queued',
        threadId: 'thread-1',
        author: 'boss',
        employeeId: null,
        body: 'Also include the incident timeline.',
        at: base + 100,
        attemptId: runId,
        queueBehavior: 'followUp',
        queueState: 'accepted',
        status: 'complete',
      };
      const oldPartial: ChatMessage = {
        id: 'assistant-resume-old-partial',
        threadId: 'thread-1',
        author: 'employee',
        employeeId: 'emp-1',
        body: 'Partial report before the crash',
        at: base + 200,
        attemptId: runId,
        streamCursor: 19,
        status: 'streaming',
      };
      const release = new Deferred<DesktopAgentRunResult>();
      const env = makeEnv({
        interruptedRun: {
          run_id: runId,
          thread_id: 'thread-1',
          company_id: 'co',
          project_id: 'prj',
          root_run_id: runId,
          employee_id: 'emp-1',
          objective: rootUser.body,
          status: 'interrupted',
          started_at: new Date(base).toISOString(),
          runtime_context_json: JSON.stringify({ permissionMode: 'ask' }),
        },
        loadedMessages: [rootUser, queuedUser, oldPartial],
      });
      env.runtime.deferQueueAcks = true;
      env.runtime.onResume = async () => {
        const input: DesktopAgentRunInput = {
          text: rootUser.body,
          threadId: 'thread-1',
          employeeId: 'emp-1',
          projectId: 'prj',
          runId,
        };
        env.runtime.emitContent(input, 'Recovered final report');
        env.runtime.emitUiRequest(input, 'confirm', 'ui-resume-confirm');
        return release.promise;
      };

      const handle = await env.controller.resumeInterrupted('co', runId);
      assert.equal(handle.attemptId, runId);
      assert.equal(env.runtime.resumeCalls[0]?.restart?.threadId, 'thread-1');
      assert.equal(env.controller.isActive('thread-1'), true);
      await assert.rejects(() => submitDefault(env.controller), ConversationRunAlreadyActiveError);
      await waitFor('resume host starts', () => env.runtime.resumeCalls.length === 1);
      await waitFor(
        'resume approval becomes live',
        () => env.controller.getSnapshot('thread-1').phase === 'awaiting-approval',
      );
      await waitFor('resume queued control reaches replacement host', () =>
        Boolean(env.runtime.queuedMessages.length === 1),
      );
      assert.equal(env.runtime.queuedMessages[0]?.message.id, queuedUser.id);
      const resumeInput: DesktopAgentRunInput = {
        text: rootUser.body,
        threadId: 'thread-1',
        employeeId: 'emp-1',
        projectId: 'prj',
        runId,
      };
      env.runtime.emitLifecycle(resumeInput, 'control', {
        state: 'consumed',
        action: 'followUp',
        controlId: queuedUser.id,
      });
      await waitFor('consumed replay stays terminal', () =>
        env.persisted.some(
          (call) => call.message.id === queuedUser.id && call.message.queueState === 'consumed',
        ),
      );
      env.runtime.emitLifecycle(resumeInput, 'control', {
        state: 'accepted',
        action: 'followUp',
        controlId: queuedUser.id,
      });
      env.runtime.emitLifecycle(resumeInput, 'control', {
        state: 'failed',
        action: 'followUp',
        controlId: queuedUser.id,
        errorMessage: 'stale terminal event',
      });
      await Promise.resolve();
      const replayStates = env.persisted
        .filter((call) => call.message.id === queuedUser.id)
        .map((call) => call.message.queueState);
      assert.deepEqual(replayStates, ['consumed']);
      await env.controller.answerApproval({
        threadId: 'thread-1',
        attemptId: runId,
        hostRequestId: 'host-ui-resume-confirm',
        uiRequestId: 'ui-resume-confirm',
        confirmed: true,
      });
      release.resolve({ text: 'Recovered final report' });
      await waitFor(
        'resumed run completes',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      const snapshot = env.controller.getSnapshot('thread-1');
      const old = snapshot.liveMessages.find((message) => message.id === oldPartial.id);
      const final = snapshot.liveMessages.at(-1);
      assert.equal(old?.status, 'interrupted');
      assert.notEqual(final?.id, oldPartial.id);
      assert.equal(final?.body, 'Recovered final report');
      assert.ok(
        env.persisted.some(
          (call) => call.message.id === oldPartial.id && call.message.status === 'interrupted',
        ),
      );
      return {
        resumeCalls: env.runtime.resumeCalls.length,
        replayedControlId: env.runtime.queuedMessages[0]?.message.id,
        replayStates,
        oldStatus: old?.status,
        finalMessageId: final?.id,
      };
    },
  },
  {
    name: 'reattached abort becomes an interrupted controller run',
    criteria:
      'Pass when a Rust terminal abort reaches controller ownership, clears the active run and any stale approval row, persists the partial assistant as interrupted, and commits a cancelled terminal settlement.',
    run: async () => {
      const descriptor: ReattachedAgentRun = {
        requestId: 'host-live-aborted',
        runId: 'attempt-live-aborted',
        companyId: 'co',
        threadId: 'thread-1',
        employeeId: 'emp-1',
        projectId: 'prj',
        objective: 'Abort after reload',
        startedAt: '2026-06-20T00:00:00.000Z',
      };
      const env = makeEnv({
        reattachRuns: [descriptor],
        loadedMessages: [
          {
            id: 'boss-live-aborted',
            threadId: 'thread-1',
            author: 'boss',
            employeeId: null,
            body: descriptor.objective,
            at: Date.parse(descriptor.startedAt),
            attemptId: descriptor.runId,
            status: 'complete',
          },
          {
            id: 'assistant-live-aborted',
            threadId: 'thread-1',
            author: 'employee',
            employeeId: 'emp-1',
            body: 'Partial before abort',
            at: Date.parse(descriptor.startedAt) + 1,
            attemptId: descriptor.runId,
            status: 'streaming',
          },
        ],
      });
      env.repos.seedStaleApproval({
        threadId: descriptor.threadId,
        companyId: descriptor.companyId,
        attemptId: descriptor.runId,
        hostRequestId: descriptor.requestId,
        uiRequestId: 'ui-live-aborted',
      });
      await env.controller.hydrateRuntimeState('co');
      await env.runtime.cancelReattached(descriptor.runId);
      const snapshot = env.controller.getSnapshot('thread-1');
      assert.equal(snapshot.phase, 'interrupted');
      assert.equal(env.controller.isActive('thread-1'), false);
      assert.equal(env.repos.activeRows.has(descriptor.threadId), false);
      assert.ok(
        env.persisted.some(
          (call) =>
            call.message.id === 'assistant-live-aborted' && call.message.status === 'interrupted',
        ),
      );
      assert.deepEqual(env.runtime.settlements.at(-1), {
        threadId: descriptor.threadId,
        status: 'cancelled',
      });
      return {
        phase: snapshot.phase,
        active: env.controller.isActive('thread-1'),
        staleApprovalRemoved: true,
      };
    },
  },
  {
    name: 'company switching keeps controller ownership until the run terminal is durable',
    criteria:
      'Pass when an inactive company run remains controller-owned and its terminal reply is persisted even with no mounted conversation subscriber.',
    run: async () => {
      const descriptor: ReattachedAgentRun = {
        requestId: 'host-live-company',
        runId: 'attempt-live-company',
        companyId: 'co',
        threadId: 'thread-1',
        employeeId: 'emp-1',
        projectId: 'prj',
        objective: 'Survive company switching',
        startedAt: '2026-06-20T00:00:00.000Z',
      };
      const env = makeEnv({
        reattachRuns: [descriptor],
        loadedMessages: [
          {
            id: 'boss-live-company',
            threadId: 'thread-1',
            author: 'boss',
            employeeId: null,
            body: descriptor.objective,
            at: Date.parse(descriptor.startedAt),
            attemptId: descriptor.runId,
            status: 'complete',
          },
        ],
      });
      await env.controller.hydrateRuntimeState('co');
      assert.equal(env.controller.isActive('thread-1'), true);
      await env.runtime.completeReattached(descriptor.runId, {
        text: 'Terminal answer completed while another company was visible.',
      });
      assert.equal(env.controller.isActive('thread-1'), false);
      assert.equal(env.controller.getSnapshot('thread-1').phase, 'completed');
      const final = env.persisted.at(-1)?.message;
      assert.equal(final?.body, 'Terminal answer completed while another company was visible.');
      assert.equal(final?.status, 'complete');
      return { finalMessageId: final?.id, finalStatus: final?.status };
    },
  },
  {
    name: 'reattached pending control remains retryable until Pi reports consumption',
    criteria:
      'Pass when the host resurfaces an accepted queued id, a later host failure preserves that unconsumed intent, and Retry redelivers only that visible queued message.',
    run: async () => {
      const base = Date.parse('2026-06-20T00:00:00.000Z');
      const descriptor: ReattachedAgentRun = {
        requestId: 'host-live-2',
        runId: 'attempt-live-2',
        companyId: 'co',
        threadId: 'thread-1',
        employeeId: 'emp-1',
        projectId: 'prj',
        objective: 'Recover queued intent',
        startedAt: new Date(base + 2_500).toISOString(),
      };
      const rootUser: ChatMessage = {
        id: 'boss-retry-root',
        threadId: 'thread-1',
        author: 'boss',
        employeeId: null,
        body: descriptor.objective,
        at: base + 2_000,
        attemptId: descriptor.runId,
        status: 'complete',
      };
      const queuedUser: ChatMessage = {
        id: 'boss-retry-queued',
        threadId: 'thread-1',
        author: 'boss',
        employeeId: null,
        body: 'Do not lose this correction.',
        at: base + 3_000,
        attemptId: descriptor.runId,
        queueBehavior: 'steer',
        queueState: 'accepted',
        status: 'complete',
      };
      const env = makeEnv({
        reattachRuns: [descriptor],
        loadedMessages: [rootUser, queuedUser],
      });
      await env.controller.hydrateRuntimeState('co');
      env.runtime.emitLifecycle(
        {
          text: descriptor.objective,
          threadId: descriptor.threadId,
          employeeId: descriptor.employeeId,
          projectId: descriptor.projectId,
          runId: descriptor.runId,
        },
        'control',
        { state: 'accepted', action: 'steer', controlId: queuedUser.id },
      );
      await env.runtime.failReattached(descriptor.runId, new Error('live host disconnected'));
      assert.equal(env.controller.getSnapshot('thread-1').phase, 'failed');

      await env.controller.retry('thread-1', descriptor.runId);
      await waitFor(
        'reattached intent retry completion',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      assert.deepEqual(
        env.runtime.queuedMessages.map(({ message }) => ({
          id: message.id,
          text: message.text,
          behavior: message.behavior,
        })),
        [{ id: queuedUser.id, text: queuedUser.body, behavior: 'steer' }],
      );
      return {
        retriedControlId: env.runtime.queuedMessages[0]?.message.id,
        queueCount: env.runtime.queuedMessages.length,
      };
    },
  },
  {
    name: 'running turn accepts ordered steer and follow-up messages',
    criteria:
      'Pass when live steer/follow-up messages persist in order, reach the same Pi attempt with their native behaviors, and the final reply targets the latest queued user turn.',
    run: async () => {
      const env = makeEnv();
      const release = new Deferred<DesktopAgentRunResult>();
      env.runtime.onExecute = async () => release.promise;

      const root = await submitDefault(env.controller);
      await waitFor('root runtime attached', () => env.runtime.executeCalls.length === 1);
      const steer = await enqueueDefault(env.controller, 'steer', {
        text: 'Correct the date to July 15.',
      });
      const followUp = await enqueueDefault(env.controller, 'followUp', {
        text: 'Then add a two-line executive summary.',
      });

      assert.equal(steer.attemptId, root.attemptId);
      assert.equal(followUp.attemptId, root.attemptId);
      assert.deepEqual(
        env.runtime.queuedMessages.map(({ threadId, message }) => ({
          threadId,
          text: message.text,
          behavior: message.behavior,
        })),
        [
          {
            threadId: 'thread-1',
            text: 'Correct the date to July 15.',
            behavior: 'steer',
          },
          {
            threadId: 'thread-1',
            text: 'Then add a two-line executive summary.',
            behavior: 'followUp',
          },
        ],
      );
      const latestBossMessages = new Map(
        env.persisted
          .filter((call) => call.message.author === 'boss')
          .map((call) => [call.message.id, call.message] as const),
      );
      assert.deepEqual(
        [...latestBossMessages.values()].map((message) => message.body),
        [
          'Draft the launch note',
          'Correct the date to July 15.',
          'Then add a two-line executive summary.',
        ],
      );
      assert.deepEqual(
        [...latestBossMessages.values()].slice(1).map((message) => message.queueState),
        ['accepted', 'accepted'],
      );

      release.resolve({ text: 'Launch note corrected and summarized.' });
      await waitFor(
        'queued run complete',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      const snapshot = env.controller.getSnapshot('thread-1');
      assert.deepEqual(
        snapshot.liveMessages.map((message) => message.body),
        [
          'Draft the launch note',
          'Correct the date to July 15.',
          'Then add a two-line executive summary.',
          'Launch note corrected and summarized.',
        ],
      );
      assert.equal(snapshot.liveMessages.at(-1)?.replyToMessageId, followUp.userMessageId);
      return {
        attemptId: root.attemptId,
        queuedBehaviors: env.runtime.queuedMessages.map((call) => call.message.behavior),
        messageOrder: snapshot.liveMessages.map((message) => message.body),
      };
    },
  },
  {
    name: 'lifecycle events project queue, context, compaction, retry, and control status',
    criteria:
      'Pass when Pi lifecycle events update queue counts, context usage, and transient compaction/retry/control messages without ending the active run.',
    run: async () => {
      const env = makeEnv();
      const release = new Deferred<DesktopAgentRunResult>();
      env.runtime.onExecute = async () => release.promise;
      await submitDefault(env.controller);
      await waitFor('lifecycle runtime attached', () => env.runtime.executeCalls.length === 1);
      const input = env.runtime.executeCalls[0];
      assert.ok(input);

      env.runtime.emitLifecycle(input, 'queue', { steeringCount: 2, followUpCount: 1 });
      assert.deepEqual(env.controller.getSnapshot('thread-1').runtimeStatus, {
        message: '2 corrections · 1 follow-up queued',
        contextPercent: null,
        steeringQueued: 2,
        followUpQueued: 1,
      });

      env.runtime.emitLifecycle(input, 'context', { percent: 64 });
      assert.equal(env.controller.getSnapshot('thread-1').runtimeStatus.contextPercent, 64);
      env.runtime.emitLifecycle(input, 'queue', { steeringCount: 0, followUpCount: 0 });
      assert.deepEqual(env.controller.getSnapshot('thread-1').runtimeStatus, {
        message: null,
        contextPercent: 64,
        steeringQueued: 0,
        followUpQueued: 0,
      });
      env.runtime.emitLifecycle(input, 'compaction', { state: 'started' });
      assert.equal(
        env.controller.getSnapshot('thread-1').runtimeStatus.message,
        'Compacting context',
      );
      env.runtime.emitLifecycle(input, 'retry', { state: 'started', attempt: 2, maxAttempts: 3 });
      assert.equal(env.controller.getSnapshot('thread-1').runtimeStatus.message, 'Retrying 2/3');
      env.runtime.emitLifecycle(input, 'retry', { state: 'finished', success: false });
      assert.equal(env.controller.getSnapshot('thread-1').runtimeStatus.message, 'Retry failed');
      env.runtime.emitLifecycle(input, 'control', { state: 'failed' });
      assert.equal(
        env.controller.getSnapshot('thread-1').runtimeStatus.message,
        'Queued instruction failed',
      );
      assert.equal(env.controller.getSnapshot('thread-1').phase, 'running');

      release.resolve({ text: 'Recovered and completed.' });
      await waitFor(
        'lifecycle run complete',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      return { runtimeStatus: env.controller.getSnapshot('thread-1').runtimeStatus };
    },
  },
  {
    name: 'native images reach initial and queued Pi turns unchanged',
    criteria:
      'Pass when image materialization is forwarded to the initial execute and a live queued correction with the exact data and MIME type intact.',
    run: async () => {
      const initialImage: AgentPromptImage = {
        data: 'aW5pdGlhbC1wbmc=',
        mimeType: 'image/png',
      };
      const queuedImage: AgentPromptImage = {
        data: 'cXVldWVkLXdlYnA=',
        mimeType: 'image/webp',
      };
      const env = makeEnv({
        materializeImages: ({ text }) =>
          text.startsWith('Inspect the updated') ? [queuedImage] : [initialImage],
      });
      const release = new Deferred<DesktopAgentRunResult>();
      env.runtime.onExecute = async () => release.promise;

      await submitDefault(env.controller, {
        text: 'Inspect the initial mockup',
        stagedAttachments: [attachedImage('initial-frame', 'initial.png', 'image/png')],
      });
      await waitFor('image execute attached', () => env.runtime.executeCalls.length === 1);
      assert.deepEqual(env.runtime.executeCalls[0]?.images, [initialImage]);

      await enqueueDefault(env.controller, 'steer', {
        text: 'Inspect the updated mockup',
        stagedAttachments: [attachedImage('updated-frame', 'updated.webp', 'image/webp')],
      });
      assert.deepEqual(env.runtime.queuedMessages[0]?.message.images, [queuedImage]);
      assert.equal(env.runtime.queuedMessages[0]?.message.behavior, 'steer');

      release.resolve({ text: 'Both mockups inspected.' });
      await waitFor(
        'image run complete',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      return {
        initialMime: env.runtime.executeCalls[0]?.images?.[0]?.mimeType,
        queuedMime: env.runtime.queuedMessages[0]?.message.images?.[0]?.mimeType,
      };
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
      "Pass when retry reuses the user turn, completes under a new attempt with Pi's terminal reply, and late events from the failed attempt do not mutate it.",
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
    name: 'retry preserves consumed intent and only redelivers unconsumed queued work',
    criteria:
      'Pass when Pi consumption prevents an accepted steer from replaying, while a failed follow-up survives Retry with its user/image payload and becomes the final reply target.',
    run: async () => {
      const steerText = 'Use the annotated layout instead.';
      const followUpText = 'Then summarize the remaining accessibility gaps.';
      const steerImage: AgentPromptImage = {
        data: 'c3RlZXItaW1hZ2U=',
        mimeType: 'image/png',
      };
      const followUpImage: AgentPromptImage = {
        data: 'Zm9sbG93LXVwLWltYWdl',
        mimeType: 'image/webp',
      };
      const env = makeEnv({
        materializeImages: ({ text }) => {
          if (text === steerText) return [steerImage];
          if (text === followUpText) return [followUpImage];
          return [];
        },
      });
      const firstAttempt = new Deferred<DesktopAgentRunResult>();
      let executeCount = 0;
      env.runtime.onExecute = async () => {
        executeCount += 1;
        if (executeCount === 1) return firstAttempt.promise;
        return { text: 'Recovered with both queued instructions.' };
      };
      env.runtime.queueFailures.set(2, new Error('simulated queued-control transport failure'));

      const root = await submitDefault(env.controller);
      await waitFor(
        'first retry-intent runtime attached',
        () => env.runtime.executeCalls.length === 1,
      );
      const steer = await enqueueDefault(env.controller, 'steer', {
        text: steerText,
        stagedAttachments: [attachedImage('steer-layout', 'layout.png', 'image/png')],
      });
      const firstInput = env.runtime.executeCalls[0];
      assert(firstInput, 'the root execute input must exist before queue consumption');
      env.runtime.emitLifecycle(firstInput, 'control', {
        state: 'consumed',
        action: 'steer',
        controlId: steer.userMessageId,
      });
      await assert.rejects(
        () =>
          enqueueDefault(env.controller, 'followUp', {
            text: followUpText,
            stagedAttachments: [
              attachedImage('follow-up-a11y', 'accessibility.webp', 'image/webp'),
            ],
          }),
        /simulated queued-control transport failure/,
      );

      const deliveryFailure = env.controller.getSnapshot('thread-1');
      const failedFollowUp = deliveryFailure.liveMessages.find(
        (message) => message.body === followUpText,
      );
      assert.equal(deliveryFailure.phase, 'running');
      assert.equal(
        deliveryFailure.liveMessages.find((message) => message.id === steer.userMessageId)?.status,
        'complete',
      );
      assert.equal(failedFollowUp?.status, 'failed');
      assert.ok(
        env.persisted.some(
          (call) => call.message.id === failedFollowUp?.id && call.message.status === 'failed',
        ),
      );

      firstAttempt.reject(new Error('root attempt failed after queued control'));
      await waitFor(
        'queued-intent root failure',
        () => env.controller.getSnapshot('thread-1').phase === 'failed',
      );
      const failedSnapshot = env.controller.getSnapshot('thread-1');
      assert.equal(failedSnapshot.attemptId, root.attemptId);
      assert.equal(
        failedSnapshot.liveMessages.find((message) => message.id === failedFollowUp?.id)?.status,
        'failed',
      );
      const originalUserIntent = failedSnapshot.liveMessages.map((message) => ({
        id: message.id,
        body: message.body,
        attachmentIds: message.attachments?.map((attachment) => attachment.id) ?? [],
      }));

      const retry = await env.controller.retry('thread-1', root.attemptId);
      await waitFor(
        'queued-intent retry complete',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      const completed = env.controller.getSnapshot('thread-1');
      const completedUsers = completed.liveMessages.filter((message) => message.author === 'boss');
      assert.notEqual(retry.attemptId, root.attemptId);
      assert.deepEqual(
        completedUsers.map((message) => ({
          id: message.id,
          body: message.body,
          attachmentIds: message.attachments?.map((attachment) => attachment.id) ?? [],
        })),
        originalUserIntent,
      );
      assert.deepEqual(
        completedUsers.map((message) => message.status),
        ['complete', 'complete', 'complete'],
      );

      const queuedPayloads = env.runtime.queuedMessages.map(({ threadId, message }) => ({
        threadId,
        text: message.text,
        behavior: message.behavior,
        images: message.images,
      }));
      assert.equal(queuedPayloads.length, 3);
      assert.deepEqual(queuedPayloads[2], queuedPayloads[1]);
      assert.deepEqual(
        queuedPayloads.map((payload) => payload.behavior),
        ['steer', 'followUp', 'followUp'],
      );
      assert.deepEqual(queuedPayloads[2]?.images, [followUpImage]);
      assert.equal(completed.liveMessages.at(-1)?.replyToMessageId, failedFollowUp?.id);
      return {
        attempts: [root.attemptId, retry.attemptId],
        queueBehaviors: queuedPayloads.map((payload) => payload.behavior),
        restoredStatuses: completedUsers.map((message) => message.status),
        replyToMessageId: completed.liveMessages.at(-1)?.replyToMessageId,
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
    name: 'failed Stop preserves live ownership and host event delivery',
    criteria:
      'Pass when an unacknowledged host abort leaves the run active, blocks a duplicate submission, keeps runtime subscriptions live, and a later acknowledged Stop closes it.',
    run: async () => {
      const env = makeEnv();
      const release = new Deferred<DesktopAgentRunResult>();
      env.runtime.onExecute = async (input) => {
        env.runtime.emitContent(input, 'before failed Stop');
        return release.promise;
      };
      env.runtime.onAbort = async () => {
        throw new Error('Timed out waiting for Pi request host-live to stop.');
      };
      await submitDefault(env.controller);
      await waitFor(
        'active stream before failed Stop',
        () => env.runtime.executeCalls.length === 1,
      );
      const admissionsBeforeRetry = env.runtime.admissions.length;
      await assert.rejects(
        () => env.controller.stopAndWait('thread-1'),
        /Timed out waiting for Pi request host-live to stop/,
      );
      assert.equal(env.controller.isActive('thread-1'), true);
      await assert.rejects(() => submitDefault(env.controller), ConversationRunAlreadyActiveError);
      assert.equal(env.runtime.admissions.length, admissionsBeforeRetry);
      const input = env.runtime.executeCalls[0];
      assert.ok(input);
      env.runtime.emitContent(input, ' and ownership survived');
      await waitFor('post-failure host event', () =>
        Boolean(
          env.controller
            .getSnapshot('thread-1')
            .liveMessages.at(-1)
            ?.body.includes('ownership survived'),
        ),
      );

      env.runtime.onAbort = undefined;
      await env.controller.stopAndWait('thread-1');
      release.resolve({ text: 'late terminal after acknowledged Stop' });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(env.controller.getSnapshot('thread-1').phase, 'interrupted');
      return {
        abortAttempts: env.runtime.aborts.length,
        duplicateAdmissionBlocked: true,
        postFailureEventsVisible: true,
      };
    },
  },
  {
    name: 'reattach resurface failure aborts the retained host and settles failed',
    criteria:
      'Pass when the real DesktopPiAgentRuntime cannot send the reattach resurface control, confirms the retained host aborted, never calls controller onReady, and durably fails the adopted root.',
    run: async () => {
      const requestId = 'request-reattach-resurface-failure';
      const runId = 'run-reattach-resurface-failure';
      const threadId = 'thread-reattach-resurface-failure';
      const row: AgentRunRow = {
        run_id: runId,
        thread_id: threadId,
        company_id: 'co',
        project_id: 'prj',
        parent_run_id: null,
        root_run_id: runId,
        employee_id: null,
        relation: null,
        work_kind: null,
        objective: 'Continue retained Pi work',
        access: 'write',
        status: 'running',
        failure_kind: null,
        usage_json: null,
        result_summary_json: null,
        session_file: null,
        runtime_context_json: JSON.stringify({ requestId, streamCursor: 0 }),
        started_at: '2026-06-20T00:00:00.000Z',
        finished_at: null,
      };
      const statusUpdates: Array<{ runId: string; status: string }> = [];
      const repositories = {
        agentRuns: {
          findByStatus: async () => [row],
          findByRoot: async () => [row],
          updateStatus: async (updatedRunId: string, status: string) => {
            statusUpdates.push({ runId: updatedRunId, status });
          },
          updateRuntimeContext: async () => undefined,
        },
      } as unknown as RuntimeRepositories;
      let aborted = false;
      const commands: string[] = [];
      const runtime = new DesktopPiAgentRuntime('co', repositories, (async (command: string) => {
        commands.push(command);
        if (command === 'agent_runtime_stream_snapshot') {
          return aborted
            ? {
                requestId,
                running: false,
                cursor: 0,
                buffered: 0,
                terminal: { status: 'aborted' },
              }
            : { requestId, running: true, cursor: 0, buffered: 0 };
        }
        if (command === 'agent_runtime_reattach') {
          return { requestId, running: true, cursor: 0, buffered: 0 };
        }
        if (command === 'agent_runtime_control') {
          throw new Error('reattach control transport failed');
        }
        if (command === 'agent_runtime_abort') {
          aborted = true;
          return undefined;
        }
        throw new Error(`unexpected command ${command}`);
      }) as never);
      let readyCalls = 0;
      const observerErrors: Error[] = [];
      const harnessGlobal = globalThis as unknown as {
        window?: {
          __TAURI_INTERNALS__: {
            transformCallback: (callback: (message: unknown) => void) => number;
          };
        };
      };
      const originalWindow = harnessGlobal.window;
      harnessGlobal.window = {
        __TAURI_INTERNALS__: {
          transformCallback: () => 1,
        },
      };
      let attached: readonly string[];
      try {
        attached = await runtime.reattachLiveRuns(async () => ({
          afterCursor: 0,
          onReady: () => {
            readyCalls += 1;
          },
          onResult: () => undefined,
          onError: (error) => {
            observerErrors.push(error);
          },
        }));
      } finally {
        if (originalWindow) harnessGlobal.window = originalWindow;
        else harnessGlobal.window = undefined;
      }

      await waitFor(
        'failed reattach root settlement',
        () =>
          observerErrors.length === 1 &&
          statusUpdates.some((update) => update.runId === runId && update.status === 'failed'),
      );
      assert.deepEqual(attached, [runId]);
      assert.equal(aborted, true);
      assert.equal(readyCalls, 0);
      assert.match(observerErrors[0]?.message ?? '', /reattach control transport failed/);
      assert.deepEqual(commands.slice(0, 5), [
        'agent_runtime_stream_snapshot',
        'agent_runtime_reattach',
        'agent_runtime_control',
        'agent_runtime_abort',
        'agent_runtime_stream_snapshot',
      ]);
      return {
        retainedHostAborted: aborted,
        controllerReadyCalls: readyCalls,
        observerError: observerErrors[0]?.message,
        rootFailed: true,
      };
    },
  },
  {
    name: 'desktop runtime rolls back an unacknowledged Stop intent',
    criteria:
      'Pass when the real DesktopPiAgentRuntime rolls back an abort IPC failure only while the stream is still running, retains cancellation when a probe proves aborted, and keeps waiting after an accepted cancel until a delayed aborted terminal arrives.',
    run: async () => {
      type RuntimeInternals = {
        runIdentityByThread: Map<string, { runId: string; requestId: string }>;
        inFlightByThread: Map<string, string>;
        controlReadyByThread: Map<string, string>;
        acceptingControlThreads: Set<string>;
        abortedRequests: Set<string>;
        pendingTerminalByThread: Map<string, { status: string }>;
        abortUnsafeReattachHost: (requestId: string, ownershipError: unknown) => Promise<void>;
      };
      const seed = (runtime: DesktopPiAgentRuntime, suffix: string) => {
        const internals = runtime as unknown as RuntimeInternals;
        const threadId = `thread-runtime-${suffix}`;
        const requestId = `request-runtime-${suffix}`;
        internals.runIdentityByThread.set(threadId, {
          runId: `run-runtime-${suffix}`,
          requestId,
        });
        internals.inFlightByThread.set(threadId, requestId);
        internals.controlReadyByThread.set(threadId, requestId);
        internals.acceptingControlThreads.add(threadId);
        return { internals, threadId, requestId };
      };

      const runningRuntime = new DesktopPiAgentRuntime(
        'co',
        new FakeRepos() as unknown as RuntimeRepositories,
        (async (command: string) => {
          if (command === 'agent_runtime_abort') throw new Error('abort IPC failed');
          if (command === 'agent_runtime_stream_snapshot') {
            return {
              requestId: 'request-runtime-running',
              running: true,
              cursor: 3,
              buffered: 3,
            };
          }
          throw new Error(`unexpected command ${command}`);
        }) as never,
      );
      const running = seed(runningRuntime, 'running');
      await assert.rejects(() => runningRuntime.abort(running.threadId), /abort IPC failed/);
      assert.equal(running.internals.abortedRequests.has(running.requestId), false);
      assert.equal(running.internals.controlReadyByThread.get(running.threadId), running.requestId);
      assert.equal(running.internals.acceptingControlThreads.has(running.threadId), true);

      const abortedRuntime = new DesktopPiAgentRuntime(
        'co',
        new FakeRepos() as unknown as RuntimeRepositories,
        (async (command: string) => {
          if (command === 'agent_runtime_abort') throw new Error('abort response lost');
          if (command === 'agent_runtime_stream_snapshot') {
            return {
              requestId: 'request-runtime-aborted',
              running: false,
              cursor: 4,
              buffered: 4,
              terminal: { status: 'aborted' },
            };
          }
          throw new Error(`unexpected command ${command}`);
        }) as never,
      );
      const aborted = seed(abortedRuntime, 'aborted');
      await abortedRuntime.abort(aborted.threadId);
      assert.equal(aborted.internals.abortedRequests.has(aborted.requestId), true);
      assert.equal(aborted.internals.controlReadyByThread.has(aborted.threadId), false);
      assert.equal(
        aborted.internals.pendingTerminalByThread.get(aborted.threadId)?.status,
        'cancelled',
      );

      let delayedSnapshots = 0;
      const delayedRuntime = new DesktopPiAgentRuntime(
        'co',
        new FakeRepos() as unknown as RuntimeRepositories,
        (async (command: string) => {
          if (command === 'agent_runtime_abort') return undefined;
          if (command === 'agent_runtime_stream_snapshot') {
            delayedSnapshots += 1;
            if (delayedSnapshots < 3) {
              return {
                requestId: 'request-runtime-delayed',
                running: true,
                cursor: delayedSnapshots,
                buffered: delayedSnapshots,
              };
            }
            return {
              requestId: 'request-runtime-delayed',
              running: false,
              cursor: 3,
              buffered: 3,
              terminal: { status: 'aborted' },
            };
          }
          throw new Error(`unexpected command ${command}`);
        }) as never,
      );
      const delayed = seed(delayedRuntime, 'delayed');
      await delayedRuntime.abort(delayed.threadId);
      assert.equal(delayedSnapshots, 3);
      assert.equal(delayed.internals.abortedRequests.has(delayed.requestId), true);
      assert.equal(
        delayed.internals.pendingTerminalByThread.get(delayed.threadId)?.status,
        'cancelled',
      );

      const rejectedSnapshotRuntime = new DesktopPiAgentRuntime(
        'co',
        new FakeRepos() as unknown as RuntimeRepositories,
        (async (command: string) => {
          if (command === 'agent_runtime_abort') return undefined;
          if (command === 'agent_runtime_stream_snapshot') {
            throw new Error('snapshot IPC offline');
          }
          throw new Error(`unexpected command ${command}`);
        }) as never,
      ) as unknown as RuntimeInternals;
      await assert.rejects(
        () =>
          rejectedSnapshotRuntime.abortUnsafeReattachHost(
            'request-reattach-offline',
            new Error('replay channel failed'),
          ),
        /Could not prove the retained Pi host stopped/,
      );

      const completedSnapshotRuntime = new DesktopPiAgentRuntime(
        'co',
        new FakeRepos() as unknown as RuntimeRepositories,
        (async (command: string) => {
          if (command === 'agent_runtime_abort') return undefined;
          if (command === 'agent_runtime_stream_snapshot') {
            return {
              requestId: 'request-reattach-completed',
              running: false,
              cursor: 5,
              buffered: 5,
              terminal: { status: 'completed' },
            };
          }
          throw new Error(`unexpected command ${command}`);
        }) as never,
      ) as unknown as RuntimeInternals;
      await assert.rejects(
        () =>
          completedSnapshotRuntime.abortUnsafeReattachHost(
            'request-reattach-completed',
            new Error('replay channel failed'),
          ),
        /Could not prove the retained Pi host stopped/,
      );
      return {
        runningIntentRolledBack: true,
        liveControlsRestored: true,
        provenAbortRetained: true,
        delayedAbortSnapshots: delayedSnapshots,
        reattachSnapshotFailureRejected: true,
        completedReattachOutcomePreserved: true,
      };
    },
  },
  {
    name: 'Stop wins while final assistant persistence is still pending',
    criteria:
      'Pass when Result has entered final persistence but Stop takes terminal ownership before the root commit, leaving transcript, root settlement, and in-memory phase consistently cancelled/interrupted.',
    run: async () => {
      const env = makeEnv();
      const response = new Deferred<DesktopAgentRunResult>();
      const finalPersistStarted = new Deferred<void>();
      const releaseFinalPersist = new Deferred<void>();
      env.runtime.onExecute = async () => response.promise;
      await submitDefault(env.controller, {
        persistMessage: async (message) => {
          if (message.author === 'employee' && message.status === 'complete') {
            finalPersistStarted.resolve();
            await releaseFinalPersist.promise;
          }
          env.persisted.push({
            message: JSON.parse(JSON.stringify(message)) as ChatMessage,
            companyId: 'co',
            projectId: 'prj',
          });
        },
      });
      await waitFor('Result-ready host run', () => env.runtime.executeCalls.length === 1);
      response.resolve({ text: 'result racing Stop' });
      await finalPersistStarted.promise;
      const stopping = env.controller.stopAndWait('thread-1');
      assert.equal(env.controller.isActive('thread-1'), true);
      releaseFinalPersist.resolve();
      await stopping;
      const snapshot = env.controller.getSnapshot('thread-1');
      assert.equal(snapshot.phase, 'interrupted');
      assert.equal(env.controller.isActive('thread-1'), false);
      assert.deepEqual(env.runtime.settlements, [{ threadId: 'thread-1', status: 'cancelled' }]);
      assert.equal(env.persisted.at(-1)?.message.status, 'interrupted');
      return {
        phase: snapshot.phase,
        settlements: env.runtime.settlements,
        finalMessageStatus: env.persisted.at(-1)?.message.status,
      };
    },
  },
  {
    name: 'natural Result is retained when it beats an acknowledged Stop terminal',
    criteria:
      'Pass when Stop starts first, the host Result arrives while Stop owns the run, the abort path then reports completion won, and controller resumes that retained Result instead of leaving the thread permanently active.',
    run: async () => {
      const env = makeEnv();
      const response = new Deferred<DesktopAgentRunResult>();
      env.runtime.onExecute = async () => response.promise;
      env.runtime.onAbort = async () => {
        response.resolve({ text: 'natural completion beat Stop' });
        await new Promise<void>((resolve) => setImmediate(resolve));
        throw new Error('Pi request completed before Stop was acknowledged.');
      };
      await submitDefault(env.controller);
      await waitFor('Stop-first host execution', () => env.runtime.executeCalls.length === 1);
      await assert.rejects(
        () => env.controller.stopAndWait('thread-1'),
        /completed before Stop was acknowledged/,
      );
      await waitFor(
        'retained natural completion',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      const snapshot = env.controller.getSnapshot('thread-1');
      assert.equal(env.controller.isActive('thread-1'), false);
      assert.equal(snapshot.liveMessages.at(-1)?.body, 'natural completion beat Stop');
      assert.deepEqual(env.runtime.settlements, [{ threadId: 'thread-1', status: 'completed' }]);
      return {
        phase: snapshot.phase,
        active: env.controller.isActive('thread-1'),
        finalBody: snapshot.liveMessages.at(-1)?.body,
      };
    },
  },
  {
    name: 'stop archives a pending UI request before detaching the run',
    criteria:
      'Pass when Stop cancels the live interaction, removes its active row, records history, and cannot leave a ghost approval for restart hydration.',
    run: async () => {
      const env = makeEnv();
      env.runtime.onExecute = async (input) => {
        env.runtime.emitUiRequest(input, 'confirm', 'ui-stop');
        await env.runtime.waitForAbort(input.threadId);
        throw new Error('aborted');
      };
      await submitDefault(env.controller);
      await waitFor(
        'approval before stop',
        () =>
          env.controller.getSnapshot('thread-1').approval?.uiRequestId === 'ui-stop' &&
          env.repos.activeRows.get('thread-1')?.interaction_id === 'ui-stop',
      );
      await env.controller.stopAndWait('thread-1');
      assert.equal(env.repos.activeRows.size, 0);
      assert.deepEqual(
        env.repos.historyRows.map((row) => [row.interaction_id, row.status]),
        [['ui-stop', 'cancelled']],
      );
      assert.equal(env.controller.getSnapshot('thread-1').approval, null);
      assert.equal(env.controller.getSnapshot('thread-1').phase, 'interrupted');
      return {
        activeRows: env.repos.activeRows.size,
        history: env.repos.historyRows.map((row) => [row.interaction_id, row.status]),
        aborts: env.runtime.aborts,
      };
    },
  },
  {
    name: 'route subscriber unmount does not cancel an active run',
    criteria:
      "Pass when the React-facing subscription can unsubscribe mid-run while the controller keeps receiving runtime events and completes with Pi's terminal reply.",
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
    name: 'answering one FIFO approval cannot erase the next approval',
    criteria:
      'Pass when Pi emits request B while request A is being answered and B remains both visible and persisted until its own answer.',
    run: async () => {
      const env = makeEnv();
      let activeInput: DesktopAgentRunInput | null = null;
      env.runtime.onAnswer = (answer) => {
        if (answer.id === 'ui-confirm-a' && activeInput) {
          env.runtime.emitUiRequest(activeInput, 'input', 'ui-input-b', {
            title: 'Name the release',
            placeholder: 'Release name',
          });
        }
      };
      env.runtime.onExecute = async (input) => {
        activeInput = input;
        env.runtime.emitUiRequest(input, 'confirm', 'ui-confirm-a');
        await waitFor('both FIFO approvals answered', () => env.runtime.answers.length === 2);
        return { text: 'Both FIFO approvals answered.' };
      };

      await submitDefault(env.controller);
      await waitFor(
        'first FIFO approval',
        () => env.controller.getSnapshot('thread-1').approval?.uiRequestId === 'ui-confirm-a',
      );
      const first = env.controller.getSnapshot('thread-1').approval;
      assert.ok(first);
      await env.controller.answerApproval({
        threadId: 'thread-1',
        attemptId: first.attemptId,
        hostRequestId: first.hostRequestId,
        uiRequestId: first.uiRequestId,
        confirmed: true,
      });
      await waitFor(
        'second FIFO approval survives first cleanup',
        () =>
          env.controller.getSnapshot('thread-1').approval?.uiRequestId === 'ui-input-b' &&
          env.repos.activeRows.get('thread-1')?.interaction_id === 'ui-input-b',
      );
      const second = env.controller.getSnapshot('thread-1').approval;
      assert.ok(second);
      await env.controller.answerApproval({
        threadId: 'thread-1',
        attemptId: second.attemptId,
        hostRequestId: second.hostRequestId,
        uiRequestId: second.uiRequestId,
        value: 'July final',
      });
      await waitFor(
        'FIFO approval run complete',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      assert.deepEqual(
        env.repos.historyRows.map((row) => row.interaction_id),
        ['ui-confirm-a', 'ui-input-b'],
      );
      return {
        answers: env.runtime.answers.map(({ id }) => id),
        history: env.repos.historyRows.map((row) => row.interaction_id),
      };
    },
  },
  {
    name: 'select, input, and editor UI requests stay live and persist typed answers',
    criteria:
      'Pass when all three interactive Pi UI primitives expose their controls, forward typed values, and persist select/freeform resolution semantics before the run continues.',
    run: async () => {
      const env = makeEnv();
      const requests: Array<{
        method: 'select' | 'input' | 'editor';
        id: string;
        title: string;
        options?: string[];
        placeholder?: string;
        prefill?: string;
        value: string;
      }> = [
        {
          method: 'select',
          id: 'ui-select',
          title: 'Choose release channel',
          options: ['stable', 'preview'],
          value: 'stable',
        },
        {
          method: 'input',
          id: 'ui-input',
          title: 'Name the release',
          placeholder: 'Release name',
          prefill: 'July launch',
          value: 'July launch final',
        },
        {
          method: 'editor',
          id: 'ui-editor',
          title: 'Edit the announcement',
          placeholder: 'Markdown announcement',
          prefill: '# Draft',
          value: '# Final\n\nReady to ship.',
        },
      ];
      const continueAfterAnswer = requests.map(() => new Deferred<void>());
      env.runtime.onExecute = async (input) => {
        for (const [index, request] of requests.entries()) {
          env.runtime.emitUiRequest(input, request.method, request.id, {
            title: request.title,
            options: request.options,
            placeholder: request.placeholder,
            prefill: request.prefill,
          });
          await continueAfterAnswer[index]?.promise;
        }
        return { text: 'All interactive requests answered.' };
      };

      await submitDefault(env.controller);
      for (const [index, request] of requests.entries()) {
        await waitFor(
          `${request.method} approval persisted`,
          () =>
            env.controller.getSnapshot('thread-1').approval?.uiRequestId === request.id &&
            env.repos.activeRows.get('thread-1')?.interaction_id === request.id,
        );
        const approval = env.controller.getSnapshot('thread-1').approval;
        assert.ok(approval);
        assert.equal(approval.state, 'live');
        assert.equal(approval.method, request.method);
        assert.equal(approval.title, request.title);
        assert.deepEqual(approval.options, request.options);
        assert.equal(approval.placeholder, request.placeholder);
        assert.equal(approval.prefill, request.prefill);
        await env.controller.answerApproval({
          threadId: 'thread-1',
          attemptId: approval.attemptId,
          hostRequestId: approval.hostRequestId,
          uiRequestId: approval.uiRequestId,
          value: request.value,
        });
        continueAfterAnswer[index]?.resolve(undefined);
      }

      await waitFor(
        'interactive UI run complete',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      assert.deepEqual(
        env.runtime.answers.map(({ id, value }) => ({ id, value })),
        requests.map(({ id, value }) => ({ id, value })),
      );
      assert.deepEqual(
        env.repos.historyRows.map((row) => ({
          id: row.interaction_id,
          status: row.status,
          selected: row.selected_option_id,
          freeform: row.freeform_response,
        })),
        [
          { id: 'ui-select', status: 'resolved', selected: 'stable', freeform: null },
          {
            id: 'ui-input',
            status: 'resolved',
            selected: null,
            freeform: 'July launch final',
          },
          {
            id: 'ui-editor',
            status: 'resolved',
            selected: null,
            freeform: '# Final\n\nReady to ship.',
          },
        ],
      );
      assert.equal(env.repos.activeRows.size, 0);
      return {
        methods: requests.map((request) => request.method),
        answers: env.runtime.answers.map(({ id, value }) => ({ id, value })),
        historyCount: env.repos.historyRows.length,
      };
    },
  },
  {
    name: 'unsupported UI request auto-cancels and records history',
    criteria:
      'Pass when an unknown UI primitive is cancelled automatically, written to history, and does not leave a pending approval.',
    run: async () => {
      const env = makeEnv();
      env.runtime.onExecute = async (input) => {
        env.runtime.emitUiRequest(input, 'notification', 'ui-notification');
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
    name: 'unsupported FIFO request cannot erase the next supported approval',
    criteria:
      'Pass when auto-cancelling unsupported request A triggers supported request B and B remains live and persisted until answered.',
    run: async () => {
      const env = makeEnv();
      let activeInput: DesktopAgentRunInput | null = null;
      env.runtime.onAnswer = (answer) => {
        if (answer.id === 'ui-unsupported-a' && activeInput) {
          env.runtime.emitUiRequest(activeInput, 'confirm', 'ui-confirm-b');
        }
      };
      env.runtime.onExecute = async (input) => {
        activeInput = input;
        env.runtime.emitUiRequest(input, 'notification', 'ui-unsupported-a');
        await waitFor('supported FIFO answer', () => env.runtime.answers.length === 2);
        return { text: 'Unsupported request skipped; supported request answered.' };
      };

      await submitDefault(env.controller);
      await waitFor(
        'supported request survives unsupported cleanup',
        () =>
          env.controller.getSnapshot('thread-1').approval?.uiRequestId === 'ui-confirm-b' &&
          env.repos.activeRows.get('thread-1')?.interaction_id === 'ui-confirm-b',
      );
      const approval = env.controller.getSnapshot('thread-1').approval;
      assert.ok(approval);
      await env.controller.answerApproval({
        threadId: 'thread-1',
        attemptId: approval.attemptId,
        hostRequestId: approval.hostRequestId,
        uiRequestId: approval.uiRequestId,
        confirmed: true,
      });
      await waitFor(
        'unsupported-to-supported run complete',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      assert.deepEqual(
        env.repos.historyRows.map((row) => [row.interaction_id, row.status]),
        [
          ['ui-unsupported-a', 'cancelled'],
          ['ui-confirm-b', 'resolved'],
        ],
      );
      return {
        answers: env.runtime.answers.map(({ id }) => id),
        history: env.repos.historyRows.map((row) => [row.interaction_id, row.status]),
      };
    },
  },
  {
    name: 'host-cancelled UI request clears the live approval and records history',
    criteria:
      'Pass when a Pi-side timeout or abort removes the matching approval, records its cancellation, and lets the same run continue without a renderer answer.',
    run: async () => {
      const env = makeEnv();
      env.runtime.onExecute = async (input) => {
        env.runtime.emitUiRequest(input, 'input', 'ui-host-cancelled');
        await waitFor(
          'host-cancelled approval pending',
          () => env.controller.getSnapshot('thread-1').phase === 'awaiting-approval',
        );
        env.runtime.emitLifecycle(input, 'ui', {
          state: 'cancelled',
          uiRequestId: 'ui-host-cancelled',
          reason: 'timeout',
        });
        await waitFor(
          'host-cancelled approval archived',
          () =>
            env.controller.getSnapshot('thread-1').approval === null &&
            env.repos.historyRows[0]?.status === 'cancelled',
        );
        return { text: 'continued after host cancellation' };
      };
      await submitDefault(env.controller);
      await waitFor(
        'host-cancelled UI run complete',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      assert.equal(env.runtime.answers.length, 0);
      assert.equal(env.repos.activeRows.size, 0);
      assert.equal(env.repos.historyRows[0]?.interaction_id, 'ui-host-cancelled');
      assert.equal(env.repos.historyRows[0]?.status, 'cancelled');
      return {
        answers: env.runtime.answers.length,
        historyStatus: env.repos.historyRows[0]?.status,
        phase: env.controller.getSnapshot('thread-1').phase,
      };
    },
  },
  {
    name: 'restart stale approvals and employee work-state projection',
    criteria:
      'Pass when stale approvals hydrate as waiting but do not assign team-wide employees, while direct active runs mark only their assignee working.',
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
      assert.equal(env.controller.getSnapshot('stale-thread').approval?.state, 'stale');
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
