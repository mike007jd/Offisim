import assert from 'node:assert/strict';
import type { RuntimeEvent, VaultRef, WorkspaceProvenance } from '@offisim/shared-types';
import {
  composerAttachmentScopeKey,
  useComposerAttachmentStore,
} from '../apps/desktop/renderer/src/assistant/composer/composer-attachment-store.js';
import { formatWorkspaceProvenance } from '../apps/desktop/renderer/src/assistant/presentation/workspace-provenance.js';
import {
  ConversationRunAlreadyActiveError,
  type ConversationRunController,
  ConversationRunMutationLockedError,
  conversationEngineText,
  createConversationRunController,
} from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.js';
import { projectEmployeeWorkloads } from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-projections.js';
import { mergeMessages } from '../apps/desktop/renderer/src/assistant/runtime/office-thread-messages.js';
import type {
  ChatAttachment,
  ChatMessage,
  StagedAttachment,
} from '../apps/desktop/renderer/src/data/types.js';
import type { TaskWorkspaceBindingClaim } from '../apps/desktop/renderer/src/lib/tauri-commands.js';
import {
  type AgentQueuedMessage,
  AgentTerminalCheckpointError,
  type DesktopAgentRunInput,
  type DesktopAgentRunResult,
  type IsolatedTextJobInput,
  type IsolatedTextJobResult,
  LIVE_CONVERSATION_TERMINAL_EVENT,
  type LiveRunReattachResult,
} from '../apps/desktop/renderer/src/runtime/desktop-agent-runtime.js';
import { conversationThreadLifecycle } from '../apps/desktop/renderer/src/runtime/thread-lifecycle-guard.js';
import { notableWorkspaceProvenanceForBinding } from '../apps/desktop/renderer/src/runtime/workspace-provenance.js';
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
  executeCalls: DesktopAgentRunInput[] = [];
  generateTextCalls: IsolatedTextJobInput[] = [];
  resumeCalls: string[] = [];
  aborts: string[] = [];
  answers: Array<{
    requestId: string;
    id: string;
    confirmed?: boolean;
    value?: string;
    answers?: Readonly<Record<string, { readonly answers: readonly string[] }>>;
    cancelled?: boolean;
  }> = [];
  abortWaiters = new Map<string, Deferred<void>>();
  onExecute: (input: DesktopAgentRunInput, signal?: AbortSignal) => Promise<DesktopAgentRunResult> =
    async () => ({ text: 'ok' });
  onResume: (runId: string, signal?: AbortSignal) => Promise<DesktopAgentRunResult> = async () => ({
    text: `resumed ${runId}`,
  });
  onReattach: (rootRunIds?: ReadonlySet<string>) => Promise<LiveRunReattachResult> = async (
    rootRunIds,
  ) => ({
    protectedRootRunIds: new Set(rootRunIds ?? []),
    handledRootRunIds: new Set(rootRunIds ?? []),
    confirmedMissingRootRunIds: new Set(),
    complete: true,
  });

  constructor(
    private readonly eventBus: InMemoryEventBus,
    private readonly companyId = 'co',
  ) {}

  async execute(input: DesktopAgentRunInput, signal?: AbortSignal): Promise<DesktopAgentRunResult> {
    this.executeCalls.push(input);
    return this.onExecute(input, signal);
  }

  async generateText(input: IsolatedTextJobInput): Promise<IsolatedTextJobResult> {
    this.generateTextCalls.push(input);
    return {
      text: 'Recovered task title',
      provenance: { ...input.sourceProvenance, runId: input.jobId },
    };
  }

  async reattachLiveRuns(rootRunIds?: ReadonlySet<string>): Promise<LiveRunReattachResult> {
    return this.onReattach(rootRunIds);
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
    answers?: Readonly<Record<string, { readonly answers: readonly string[] }>>;
    cancelled?: boolean;
  }): Promise<void> {
    this.answers.push(answer);
  }

  async resume(runId: string, signal?: AbortSignal): Promise<DesktopAgentRunResult> {
    this.resumeCalls.push(runId);
    return this.onResume(runId, signal);
  }

  queuedMessages: Array<{ threadId: string; message: AgentQueuedMessage }> = [];

  async queueMessage(threadId: string, message: AgentQueuedMessage): Promise<void> {
    this.queuedMessages.push({ threadId, message });
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
    workspaceProvenance?: WorkspaceProvenance,
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
        workspaceProvenance,
        chatConversationKey: `test::${input.threadId}`,
        chatRunId: input.runId ?? 'missing-run',
      }),
    );
  }

  emitWorkspaceBinding(input: DesktopAgentRunInput, claim: TaskWorkspaceBindingClaim): void {
    const provenance = notableWorkspaceProvenanceForBinding(claim);
    if (!provenance) return;
    this.emitTool(input, 'started', 'workspace-status', 'Workspace', undefined, provenance);
    this.emitTool(input, 'completed', 'workspace-status', 'Workspace', undefined, provenance);
  }

  emitUiRequest(input: DesktopAgentRunInput, method: string, id = 'ui-1', params?: unknown): void {
    this.eventBus.emit({
      type: 'agent.ui.request',
      entityId: id,
      entityType: 'runtime',
      companyId: this.companyId,
      threadId: input.threadId,
      timestamp: Date.now(),
      payload: {
        engineId: 'api',
        requestId: `host-${id}`,
        runId: input.runId ?? 'missing-run',
        id,
        method,
        title: method === 'confirm' ? 'Approve command?' : 'Choose option',
        message: 'The agent needs a decision.',
        params,
      },
    } satisfies RuntimeEvent<Record<string, unknown>>);
  }
}

class FakeRepos {
  runRows = new Map<string, AgentRunRow>();
  activeRows = new Map<string, ActiveInteractionRow>();
  historyRows: HistoryRow[] = [];
  skillRows = new Map<
    string,
    {
      skill_id: string;
      name: string;
      description: string;
      scope: string;
      vault_path: string;
    }
  >();
  failActiveInteractionUpsert = false;
  failActiveInteractionDelete = 0;

  skills = {
    findById: async (skillId: string) => this.skillRows.get(skillId) ?? null,
  };

  agentRuns = {
    findById: async (runId: string) => this.runRows.get(runId) ?? null,
    findByRoot: async (rootRunId: string) =>
      [...this.runRows.values()].filter((row) => row.root_run_id === rootRunId),
    findByThread: async (threadId: string) =>
      [...this.runRows.values()].filter((row) => row.thread_id === threadId),
    findByStatus: async (companyId: string, statuses: AgentRunRow['status'][]) =>
      [...this.runRows.values()].filter(
        (row) => row.company_id === companyId && statuses.includes(row.status),
      ),
    // The production repository returns at most the latest root for the one
    // visible Conversation; controller-side typed parsing still fails closed.
    findLatestFreshSessionCandidate: async (companyId: string, threadId: string) => {
      let latest: AgentRunRow | null = null;
      for (const row of this.runRows.values()) {
        if (
          row.company_id !== companyId ||
          row.thread_id !== threadId ||
          row.run_id !== row.root_run_id ||
          row.parent_run_id !== null
        ) {
          continue;
        }
        if (
          !latest ||
          row.started_at > latest.started_at ||
          (row.started_at === latest.started_at && row.run_id > latest.run_id)
        ) {
          latest = row;
        }
      }
      return latest;
    },
    findFreshSessionSource: async (companyId: string, threadId: string, sourceRunId: string) => {
      let latest: AgentRunRow | null = null;
      for (const row of this.runRows.values()) {
        if (
          row.company_id !== companyId ||
          row.thread_id !== threadId ||
          row.run_id !== row.root_run_id ||
          row.parent_run_id !== null
        ) {
          continue;
        }
        if (
          !latest ||
          row.started_at > latest.started_at ||
          (row.started_at === latest.started_at && row.run_id > latest.run_id)
        ) {
          latest = row;
        }
      }
      return latest?.run_id === sourceRunId ? latest : null;
    },
  };

  chatThreads = {
    beginSemanticTitleJob: async () => true,
    completeSemanticTitleJob: async () => true,
    failSemanticTitleJob: async () => {},
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
  options: {
    failPersistFirst?: boolean;
    failActiveInteractionUpsert?: boolean;
    isMissionThreadRunning?: (threadId: string) => boolean;
    beforeLoadMessagesByIds?: () => Promise<void>;
    threadMessages?: ChatMessage[];
  } = {},
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
            vaultRef:
              `attachment://co/thread-1/${attachment.attachmentId ?? attachment.id}` as VaultRef,
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
    loadMessagesByIds: async ({ threadId, messageIds }) => {
      await options.beforeLoadMessagesByIds?.();
      const wanted = new Set(messageIds);
      return persisted
        .filter((call) => call.message.threadId === threadId && wanted.has(call.message.id))
        .map((call) => call.message);
    },
    ...(options.threadMessages ? { loadMessages: async () => options.threadMessages ?? [] } : {}),
    appendEvent: async (call) => {
      appendedEvents.push(call);
    },
    now: () => {
      now += 37;
      return now;
    },
    randomUUID: () => `uuid-${++uuid}`,
    isMissionThreadRunning: options.isMissionThreadRunning ?? (() => false),
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

function conversationRow(input: {
  runId: string;
  threadId: string;
  status: AgentRunRow['status'];
  userMessageId: string;
  assistantMessageId: string;
  streamCursor?: number;
}): AgentRunRow {
  return {
    run_id: input.runId,
    thread_id: input.threadId,
    company_id: 'co',
    project_id: 'prj',
    parent_run_id: null,
    root_run_id: input.runId,
    employee_id: 'emp-live',
    relation: null,
    work_kind: null,
    objective: 'Continue durable work',
    access: 'write',
    status: input.status,
    failure_kind: null,
    usage_json: null,
    result_summary_json: null,
    session_file: '/native/session.jsonl',
    runtime_context_json: JSON.stringify({
      requestId: `host-${input.runId}`,
      streamCursor: input.streamCursor ?? 0,
      conversationProjection: {
        userMessageId: input.userMessageId,
        assistantMessageId: input.assistantMessageId,
        source: 'office',
      },
      model: 'provider/model-leaf',
      permissionMode: 'auto',
    }),
    started_at: '2026-06-20T00:00:00.000Z',
    finished_at: null,
  };
}

function seedConversationProjection(
  env: HarnessEnv,
  row: AgentRunRow,
  userMessageId: string,
  assistantMessageId: string,
): void {
  const user: ChatMessage = {
    id: userMessageId,
    threadId: row.thread_id,
    author: 'boss',
    employeeId: null,
    body: row.objective ?? 'Continue durable work',
    at: Date.parse(row.started_at),
    attachments: [],
    status: 'complete',
  };
  const assistant: ChatMessage = {
    id: assistantMessageId,
    threadId: row.thread_id,
    author: 'employee',
    employeeId: row.employee_id,
    body: 'durable partial',
    at: Date.parse(row.started_at) + 1,
    replyToMessageId: userMessageId,
    attemptId: row.run_id,
    status: 'streaming',
  };
  for (const message of [user, assistant]) {
    env.persisted.push({ message, companyId: row.company_id, projectId: row.project_id });
  }
  env.repos.runRows.set(row.run_id, row);
}

function seedFreshSessionSource(
  env: HarnessEnv,
  input: {
    runId: string;
    threadId: string;
    recoveryLane: 'conversation' | 'direct-delegation' | 'mission';
    userBody?: string;
    objective?: string;
    attachments?: ChatMessage['attachments'];
  },
): { userMessage: ChatMessage; assistantMessage: ChatMessage; row: AgentRunRow } {
  const userMessageId = `boss-${input.runId}`;
  const assistantMessageId = `assistant-${input.runId}`;
  const userMessage: ChatMessage = {
    id: userMessageId,
    threadId: input.threadId,
    author: 'boss',
    employeeId: null,
    body: input.userBody ?? 'Continue the visible task',
    at: Date.parse('2026-06-20T00:00:00.000Z'),
    attachments: input.attachments ?? [],
    status: 'complete',
  };
  const assistantMessage: ChatMessage = {
    id: assistantMessageId,
    threadId: input.threadId,
    author: 'employee',
    employeeId: 'emp-1',
    body: '',
    at: userMessage.at + 1,
    replyToMessageId: userMessageId,
    attemptId: input.runId,
    status: 'failed',
  };
  const row: AgentRunRow = {
    run_id: input.runId,
    thread_id: input.threadId,
    company_id: 'co',
    project_id: 'prj',
    parent_run_id: null,
    root_run_id: input.runId,
    employee_id: 'emp-1',
    relation: null,
    work_kind: null,
    objective: input.objective ?? userMessage.body,
    access: 'write',
    status: 'failed',
    failure_kind: 'runtime',
    usage_json: null,
    result_summary_json: null,
    session_file: null,
    runtime_context_json: JSON.stringify({
      requestId: `host-${input.runId}`,
      streamCursor: 0,
      projectId: 'prj',
      recoveryLane: input.recoveryLane,
      nativeSessionPrestartErrorCode: 'native-session-missing',
      conversationProjection: {
        userMessageId,
        assistantMessageId,
        source: 'office',
      },
      permissionMode: 'auto',
    }),
    started_at: '2026-06-20T00:00:00.000Z',
    finished_at: '2026-06-20T00:00:01.000Z',
  };
  env.repos.runRows.set(row.run_id, row);
  for (const message of [userMessage, assistantMessage]) {
    env.persisted.push({ message, companyId: 'co', projectId: 'prj' });
  }
  return { userMessage, assistantMessage, row };
}

function workspaceClaim(
  input: DesktopAgentRunInput,
  source: 'project_catalog' | 'conversation_history',
  reasonCode: 'current_project_folder' | 'recent_successful_workspace',
): TaskWorkspaceBindingClaim {
  return {
    workspaceRef: `ref-${input.runId}`,
    historyId: `history-${input.runId}`,
    companyId: 'co',
    projectId: input.projectId ?? 'prj',
    threadId: input.threadId,
    turnId: input.runId ?? 'missing-run',
    requestId: `request-${input.runId}`,
    access: 'write',
    source,
    confidence: 1,
    reasonCode,
    issuedAtUnixMs: 1,
    expiresAtUnixMs: 2,
    displayPath: '/Users/test/Projects/offisim',
  };
}

const scenarios: Array<{
  name: string;
  criteria: string;
  run: () => Promise<ScenarioEvidence>;
}> = [
  {
    name: 'engineText runs only in the engine while text remains the durable user message',
    criteria:
      'Pass when nullish engine selection falls back to text, an explicit engine projection reaches execute/materialization, and the visible boss message persists only the chip token projection.',
    run: async () => {
      assert.equal(
        conversationEngineText({ text: 'visible text' }),
        'visible text',
        'missing engineText falls back to text',
      );
      assert.equal(
        conversationEngineText({ text: 'visible text', engineText: 'engine directive' }),
        'engine directive',
        'explicit engineText wins',
      );
      const env = makeEnv();
      await submitDefault(env.controller, {
        threadId: 'engine-text-thread',
        text: 'Summarize this. [[skill:research-summary]]',
        engineText:
          'Summarize this.\n\nUse the "research-summary" skill for this task: locate it among your available skills, read its SKILL.md, and follow it. (Summarize source material.)',
      });
      await waitFor(
        'engine text completion',
        () => env.controller.getSnapshot('engine-text-thread').phase === 'completed',
      );
      assert.equal(
        env.runtime.executeCalls[0]?.text,
        'Summarize this.\n\nUse the "research-summary" skill for this task: locate it among your available skills, read its SKILL.md, and follow it. (Summarize source material.)',
      );
      const durableUser = env.persisted.find(
        (call) => call.message.threadId === 'engine-text-thread' && call.message.author === 'boss',
      )?.message;
      assert.equal(durableUser?.body, 'Summarize this. [[skill:research-summary]]');
      assert.equal(
        env.controller.getSnapshot('engine-text-thread').liveMessages[0]?.body,
        'Summarize this. [[skill:research-summary]]',
      );
      return {
        engineText: env.runtime.executeCalls[0]?.text,
        persistedText: durableUser?.body,
      };
    },
  },
  {
    name: 'renderer reload hydrates live run before durable terminal projection',
    criteria:
      'Pass when the controller exposes a controllable running projection before native reattach starts, consumes replayed events, and only completes after the runtime has durably projected the full terminal answer.',
    run: async () => {
      const eventBus = new InMemoryEventBus();
      const runtime = new FakeRuntime(eventBus);
      const persisted: ChatMessage[] = [];
      const userMessage: ChatMessage = {
        id: 'boss-live',
        threadId: 'thread-live',
        author: 'boss',
        employeeId: null,
        body: 'Finish the recovery design',
        at: Date.parse('2026-06-20T00:00:00.000Z'),
        attachments: [],
        status: 'complete',
      };
      const checkpoint: ChatMessage = {
        id: 'assistant-live',
        threadId: 'thread-live',
        author: 'employee',
        employeeId: 'emp-live',
        body: 'partial checkpoint',
        at: Date.parse('2026-06-20T00:00:01.000Z'),
        replyToMessageId: userMessage.id,
        attemptId: 'run-live',
        status: 'streaming',
      };
      const row: AgentRunRow = {
        run_id: 'run-live',
        thread_id: 'thread-live',
        company_id: 'co',
        project_id: 'prj',
        parent_run_id: null,
        root_run_id: 'run-live',
        employee_id: 'emp-live',
        relation: null,
        work_kind: null,
        objective: userMessage.body,
        access: 'write',
        status: 'running',
        failure_kind: null,
        usage_json: null,
        result_summary_json: null,
        session_file: '/native/session.jsonl',
        runtime_context_json: JSON.stringify({
          conversationProjection: {
            userMessageId: userMessage.id,
            assistantMessageId: checkpoint.id,
            source: 'office',
          },
          model: 'provider/model-leaf',
          permissionMode: 'auto',
        }),
        started_at: '2026-06-20T00:00:00.000Z',
        finished_at: null,
      };
      const holder: { controller?: ConversationRunController } = {};
      runtime.onReattach = async (rootRunIds) => {
        assert.deepEqual([...new Set(rootRunIds ?? [])], ['run-live']);
        assert.equal(holder.controller?.isActive('thread-live'), true);
        assert.equal(holder.controller?.getSnapshot('thread-live').phase, 'running');
        assert.equal(holder.controller?.getGlobalSnapshot().activeRuns.length, 1);
        eventBus.emit(
          llmStreamChunk('co', 'thread-live', 'pi_agent', ' replay tail', 'content', {
            conversationKey: 'prj::thread-live::emp-live',
            runId: 'run-live',
            threadId: 'thread-live',
          }),
        );
        persisted.push({
          ...checkpoint,
          body: 'full terminal answer',
          status: 'complete',
        });
        eventBus.emit({
          type: LIVE_CONVERSATION_TERMINAL_EVENT,
          entityId: 'run-live',
          entityType: 'runtime',
          companyId: 'co',
          threadId: 'thread-live',
          timestamp: Date.now(),
          payload: {
            runId: 'run-live',
            status: 'completed',
            text: 'full terminal answer',
          },
        } satisfies RuntimeEvent<Record<string, unknown>>);
        return {
          protectedRootRunIds: new Set(['run-live']),
          handledRootRunIds: new Set(['run-live']),
          confirmedMissingRootRunIds: new Set(),
          complete: true,
        };
      };
      const exactLoads: Array<{ threadId: string; messageIds: readonly string[] }> = [];
      const controller = createConversationRunController({
        eventBus,
        runtimeFactory: async () => runtime,
        reposFactory: async () =>
          ({
            agentRuns: {
              findByStatus: async () => [row],
              findByRoot: async () => [row],
            },
          }) as unknown as RuntimeRepositories,
        loadMessagesByIds: async ({ threadId, messageIds }) => {
          exactLoads.push({ threadId, messageIds: [...messageIds] });
          return [userMessage, checkpoint];
        },
        persistMessage: async ({ message }) => {
          persisted.push(JSON.parse(JSON.stringify(message)) as ChatMessage);
        },
        appendEvent: async () => undefined,
        now: () => Date.parse('2026-06-20T00:00:02.000Z'),
        randomUUID: () => 'bootstrap-uuid',
      });
      holder.controller = controller;

      const bootstrap = await controller.bootstrapLiveRuns('co');
      assert.equal(bootstrap.complete, true);
      await waitFor(
        'reattached terminal projection',
        () => controller.getSnapshot('thread-live').phase === 'completed',
      );
      assert.equal(controller.isActive('thread-live'), false);
      assert.deepEqual(exactLoads, [
        {
          threadId: 'thread-live',
          messageIds: ['boss-live', 'assistant-live'],
        },
      ]);
      assert.equal(
        controller.getSnapshot('thread-live').liveMessages.at(-1)?.body,
        'full terminal answer',
      );
      assert.ok(
        persisted.some(
          (message) =>
            message.id === 'assistant-live' &&
            message.status === 'complete' &&
            message.body === 'full terminal answer',
        ),
      );
      return {
        phase: controller.getSnapshot('thread-live').phase,
        persistedTerminal: persisted.at(-1)?.body,
        protected: [...bootstrap.protectedRootRunIds],
      };
    },
  },
  {
    name: 'reattached failed terminal preserves host error separately from partial answer',
    criteria:
      'Pass when a failed native reattach keeps partial assistant content while the error banner exposes the exact host failure.',
    run: async () => {
      const env = makeEnv();
      const row = conversationRow({
        runId: 'reattach-failed-root',
        threadId: 'reattach-failed-thread',
        status: 'running',
        userMessageId: 'reattach-failed-user',
        assistantMessageId: 'reattach-failed-assistant',
      });
      seedConversationProjection(env, row, 'reattach-failed-user', 'reattach-failed-assistant');
      env.runtime.onReattach = async (rootRunIds) => {
        assert.deepEqual([...new Set(rootRunIds ?? [])], ['reattach-failed-root']);
        env.eventBus.emit({
          type: LIVE_CONVERSATION_TERMINAL_EVENT,
          entityId: row.run_id,
          entityType: 'runtime',
          companyId: row.company_id,
          threadId: row.thread_id,
          timestamp: Date.now(),
          payload: {
            runId: row.run_id,
            status: 'failed',
            text: 'partial answer',
            error: 'Provider quota exhausted',
            failureKind: 'token',
          },
        } satisfies RuntimeEvent<Record<string, unknown>>);
        return {
          protectedRootRunIds: new Set([row.run_id]),
          handledRootRunIds: new Set([row.run_id]),
          confirmedMissingRootRunIds: new Set(),
          complete: true,
        };
      };

      await env.controller.bootstrapLiveRuns('co');
      await waitFor(
        'reattached failed terminal projection',
        () => env.controller.getSnapshot(row.thread_id).phase === 'failed',
      );
      const snapshot = env.controller.getSnapshot(row.thread_id);
      assert.equal(snapshot.liveMessages.at(-1)?.body, 'partial answer');
      assert.equal(snapshot.error?.technicalDetail, 'Provider quota exhausted');
      return {
        phase: snapshot.phase,
        assistant: snapshot.liveMessages.at(-1)?.body,
        technicalDetail: snapshot.error?.technicalDetail,
      };
    },
  },
  {
    name: 'Stop retires a reattached run only after its native terminal arrives',
    criteria:
      'Pass when Stop preserves the terminal subscription and exclusive lease, rejects a premature new Turn, then releases both after the cancelled native terminal.',
    run: async () => {
      const env = makeEnv();
      const row = conversationRow({
        runId: 'reattach-stop-root',
        threadId: 'reattach-stop-thread',
        status: 'running',
        userMessageId: 'reattach-stop-user',
        assistantMessageId: 'reattach-stop-assistant',
      });
      seedConversationProjection(env, row, 'reattach-stop-user', 'reattach-stop-assistant');
      await env.controller.bootstrapLiveRuns('co');
      assert.equal(env.controller.isActive(row.thread_id), true);

      await env.controller.stopAndWait(row.thread_id);
      assert.equal(env.controller.getSnapshot(row.thread_id).phase, 'interrupted');
      assert.equal(env.controller.isActive(row.thread_id), true);
      await assert.rejects(
        () => submitDefault(env.controller, { threadId: row.thread_id }),
        ConversationRunAlreadyActiveError,
      );

      env.eventBus.emit({
        type: LIVE_CONVERSATION_TERMINAL_EVENT,
        entityId: row.run_id,
        entityType: 'runtime',
        companyId: row.company_id,
        threadId: row.thread_id,
        timestamp: Date.now(),
        payload: {
          runId: row.run_id,
          status: 'cancelled',
          text: 'durable partial',
        },
      } satisfies RuntimeEvent<Record<string, unknown>>);
      await waitFor('reattached Stop retirement', () => !env.controller.isActive(row.thread_id));

      await submitDefault(env.controller, { threadId: row.thread_id });
      await waitFor(
        'new Turn after reattach terminal',
        () => env.controller.getSnapshot(row.thread_id).phase === 'completed',
      );
      return { aborts: env.runtime.aborts, phase: 'completed', ownershipReleased: true };
    },
  },
  {
    name: 'scheduled Mission root stays outside Conversation bootstrap ownership',
    criteria:
      'Pass when a Mission that starts after the reload barrier is protected by renderer ownership and Conversation bootstrap neither hydrates, reattaches, nor aborts its projection-less root.',
    run: async () => {
      let missionStartedAfterReloadBarrier = false;
      const env = makeEnv({
        isMissionThreadRunning: (threadId) =>
          missionStartedAfterReloadBarrier && threadId === 'scheduled-mission-thread',
      });
      const row = conversationRow({
        runId: 'scheduled-mission-root',
        threadId: 'scheduled-mission-thread',
        status: 'running',
        userMessageId: 'unused-user',
        assistantMessageId: 'unused-assistant',
      });
      row.runtime_context_json = JSON.stringify({
        requestId: 'scheduled-mission-host',
        conversationProjection: null,
      });
      env.repos.runRows.set(row.run_id, row);
      let reattachCalls = 0;
      env.runtime.onReattach = async () => {
        reattachCalls += 1;
        throw new Error('Mission root must not reach Conversation native reattach.');
      };

      // The renderer-reload Mission barrier completed first. A scheduler then
      // started fresh Mission work before Conversation recovery took its DB view.
      missionStartedAfterReloadBarrier = true;
      const bootstrap = await env.controller.bootstrapLiveRuns('co');

      assert.equal(bootstrap.complete, true);
      assert.deepEqual([...bootstrap.protectedRootRunIds], [row.run_id]);
      assert.deepEqual([...bootstrap.handledRootRunIds], [row.run_id]);
      assert.equal(reattachCalls, 0);
      assert.deepEqual(env.runtime.aborts, []);
      assert.equal(env.controller.isActive(row.thread_id), false);
      assert.equal(env.controller.getSnapshot(row.thread_id).phase, 'idle');
      return {
        protected: [...bootstrap.protectedRootRunIds],
        reattachCalls,
        aborts: env.runtime.aborts,
      };
    },
  },
  {
    name: 'live hydration race protects a thread owned by another lane',
    criteria:
      'Pass when lease ownership changes after Mission filtering: bootstrap protects the valid Conversation root without aborting it, and Resume reports active work rather than missing projection.',
    run: async () => {
      const env = makeEnv();
      const running = conversationRow({
        runId: 'ownership-race-running',
        threadId: 'ownership-race-thread',
        status: 'running',
        userMessageId: 'ownership-race-user',
        assistantMessageId: 'ownership-race-assistant',
      });
      seedConversationProjection(env, running, 'ownership-race-user', 'ownership-race-assistant');
      const externalLease = conversationThreadLifecycle.beginRun(running.thread_id);
      assert.ok(externalLease);
      try {
        const bootstrap = await env.controller.bootstrapLiveRuns('co');
        assert.equal(bootstrap.protectedRootRunIds.has(running.run_id), true);
        assert.deepEqual(env.runtime.aborts, []);
        assert.equal(env.controller.isActive(running.thread_id), false);

        const interrupted = { ...running, status: 'interrupted' as const };
        env.repos.runRows.set(interrupted.run_id, interrupted);
        await assert.rejects(
          () => env.controller.resumeInterruptedRun('co', interrupted.run_id),
          ConversationRunAlreadyActiveError,
        );
        return { protected: true, aborts: env.runtime.aborts.length, resume: 'active-work' };
      } finally {
        externalLease.release();
      }
    },
  },
  {
    name: 'interrupted Resume restores streaming ownership and persists the final reply',
    criteria:
      'Pass when Resume hydrates the original message ids, runs through the controller, and replaces the partial checkpoint with one complete assistant reply.',
    run: async () => {
      const env = makeEnv();
      const row = conversationRow({
        runId: 'resume-root',
        threadId: 'resume-thread',
        status: 'interrupted',
        userMessageId: 'resume-user',
        assistantMessageId: 'resume-assistant',
      });
      seedConversationProjection(env, row, 'resume-user', 'resume-assistant');
      env.runtime.onResume = async () => ({
        text: 'resumed final answer',
        reasoning: 'resumed reasoning',
      });

      await env.controller.resumeInterruptedRun('co', row.run_id);

      const snapshot = env.controller.getSnapshot(row.thread_id);
      assert.equal(snapshot.phase, 'completed');
      assert.equal(snapshot.liveMessages.at(-1)?.id, 'resume-assistant');
      assert.equal(snapshot.liveMessages.at(-1)?.body, 'resumed final answer');
      assert.equal(snapshot.liveMessages.at(-1)?.status, 'complete');
      assert.deepEqual(env.runtime.resumeCalls, ['resume-root']);
      assert.equal(
        env.persisted.filter(
          (call) => call.message.id === 'resume-assistant' && call.message.status === 'complete',
        ).length,
        1,
      );
      return {
        phase: snapshot.phase,
        body: snapshot.liveMessages.at(-1)?.body,
        resumeCalls: env.runtime.resumeCalls,
      };
    },
  },
  {
    name: 'Stop during Resume preflight prevents native work from starting',
    criteria:
      'Pass when Stop aborts the controller-owned signal while Resume compatibility is pending, so the native resume lane never starts and the card remains interrupted.',
    run: async () => {
      const env = makeEnv();
      const row = conversationRow({
        runId: 'resume-stop-root',
        threadId: 'resume-stop-thread',
        status: 'interrupted',
        userMessageId: 'resume-stop-user',
        assistantMessageId: 'resume-stop-assistant',
      });
      seedConversationProjection(env, row, 'resume-stop-user', 'resume-stop-assistant');
      const finishPreflight = new Deferred<void>();
      let signalSeen: AbortSignal | undefined;
      let nativeStarts = 0;
      env.runtime.onResume = async (_runId, signal) => {
        signalSeen = signal;
        await finishPreflight.promise;
        if (signal?.aborted) {
          const error = new Error('resume stopped in preflight');
          error.name = 'AbortError';
          throw error;
        }
        nativeStarts += 1;
        return { text: 'must not start' };
      };

      const resume = env.controller.resumeInterruptedRun('co', row.run_id);
      await waitFor('Resume signal registration', () => signalSeen !== undefined);
      await env.controller.stopAndWait(row.thread_id);
      assert.equal(signalSeen?.aborted, true);
      finishPreflight.resolve();
      await resume;

      assert.equal(nativeStarts, 0);
      assert.equal(env.controller.getSnapshot(row.thread_id).phase, 'interrupted');
      assert.deepEqual(env.runtime.aborts, [row.thread_id]);
      return {
        signalAborted: signalSeen?.aborted,
        nativeStarts,
        phase: env.controller.getSnapshot(row.thread_id).phase,
      };
    },
  },
  {
    name: 'Stop during execute preflight aborts before native work starts',
    criteria:
      'Pass when the normal execute lane owns the same AbortSignal as Resume, so Stop during Project/delegation/persistence preflight reaches the runtime and native work never starts.',
    run: async () => {
      const env = makeEnv();
      const finishPreflight = new Deferred<void>();
      let signalSeen: AbortSignal | undefined;
      let nativeStarts = 0;
      env.runtime.onExecute = async (_input, signal) => {
        signalSeen = signal;
        await finishPreflight.promise;
        if (signal?.aborted) {
          const error = new Error('execute stopped in preflight');
          error.name = 'AbortError';
          throw error;
        }
        nativeStarts += 1;
        return { text: 'must not start' };
      };

      await submitDefault(env.controller, { threadId: 'execute-stop-thread' });
      await waitFor('execute signal registration', () => signalSeen !== undefined);
      await env.controller.stopAndWait('execute-stop-thread');
      assert.equal(signalSeen?.aborted, true);
      finishPreflight.resolve();
      await waitFor(
        'execute stop remains interrupted',
        () => env.controller.getSnapshot('execute-stop-thread').phase === 'interrupted',
      );

      assert.equal(nativeStarts, 0);
      assert.deepEqual(env.runtime.aborts, ['execute-stop-thread']);
      return {
        signalAborted: signalSeen?.aborted,
        nativeStarts,
        phase: env.controller.getSnapshot('execute-stop-thread').phase,
      };
    },
  },
  {
    name: 'Stop keeps thread ownership until the old execute really settles',
    criteria:
      'Pass when interrupted UI appears immediately, same-thread Submit remains a zero-write rejection while the old runtime is unresolved, and ownership releases only after settlement.',
    run: async () => {
      const env = makeEnv();
      const oldExecuteStarted = new Deferred<void>();
      const settleOldExecute = new Deferred<void>();
      let executeCalls = 0;
      env.runtime.onExecute = async () => {
        executeCalls += 1;
        if (executeCalls === 1) {
          oldExecuteStarted.resolve(undefined);
          await settleOldExecute.promise;
          return { text: 'late stopped response' };
        }
        return { text: 'replacement response' };
      };

      await submitDefault(env.controller, { threadId: 'settle-owned-thread' });
      await oldExecuteStarted.promise;
      await env.controller.stopAndWait('settle-owned-thread');
      assert.equal(env.controller.getSnapshot('settle-owned-thread').phase, 'interrupted');
      const persistedBeforeBlockedSubmit = env.persisted.length;
      await assert.rejects(
        () => submitDefault(env.controller, { threadId: 'settle-owned-thread' }),
        ConversationRunAlreadyActiveError,
      );
      assert.equal(env.persisted.length, persistedBeforeBlockedSubmit);
      assert.equal(executeCalls, 1);

      settleOldExecute.resolve(undefined);
      await waitFor(
        'old ownership retirement',
        () => !env.controller.isActive('settle-owned-thread'),
      );
      await submitDefault(env.controller, { threadId: 'settle-owned-thread' });
      await waitFor(
        'replacement execute completed',
        () => env.controller.getSnapshot('settle-owned-thread').phase === 'completed',
      );
      assert.equal(executeCalls, 2);
      return { blockedWrites: 0, executeCalls, phase: 'completed' };
    },
  },
  {
    name: 'terminal checkpoint exhaustion auto-recovers without re-executing work',
    criteria:
      'Pass when a runtime terminal checkpoint error keeps the same projection subscribed, immediately replays the host terminal snapshot, reaches completed, and never dispatches the user task twice.',
    run: async () => {
      const env = makeEnv();
      let reattachCalls = 0;
      env.runtime.onExecute = async (input) => {
        env.runtime.emitContent(input, 'durable recovered answer');
        throw new AgentTerminalCheckpointError(
          input.runId ?? 'missing-run',
          new Error('terminal transaction failed three times'),
        );
      };
      env.runtime.onReattach = async (rootRunIds) => {
        reattachCalls += 1;
        const [runId] = [...(rootRunIds ?? [])];
        assert.ok(runId);
        env.eventBus.emit({
          type: LIVE_CONVERSATION_TERMINAL_EVENT,
          entityId: runId,
          entityType: 'runtime',
          companyId: 'co',
          threadId: 'terminal-recovery-thread',
          timestamp: Date.now(),
          payload: {
            runId,
            status: 'completed',
            text: 'durable recovered answer',
          },
        } satisfies RuntimeEvent<Record<string, unknown>>);
        return {
          protectedRootRunIds: new Set([runId]),
          handledRootRunIds: new Set([runId]),
          confirmedMissingRootRunIds: new Set(),
          complete: true,
        };
      };

      await submitDefault(env.controller, { threadId: 'terminal-recovery-thread' });
      await waitFor(
        'automatic terminal recovery',
        () => env.controller.getSnapshot('terminal-recovery-thread').phase === 'completed',
      );
      const snapshot = env.controller.getSnapshot('terminal-recovery-thread');
      assert.equal(env.runtime.executeCalls.length, 1);
      assert.equal(reattachCalls, 1);
      assert.equal(snapshot.error, null);
      assert.equal(snapshot.liveMessages.at(-1)?.body, 'durable recovered answer');
      return {
        executeCalls: env.runtime.executeCalls.length,
        reattachCalls,
        phase: snapshot.phase,
      };
    },
  },
  {
    name: 'reload restores a live approval even when its stream cursor already advanced',
    criteria:
      'Pass when a handled native run restores its matching active_interactions row as answerable live state regardless of the persisted replay cursor.',
    run: async () => {
      const env = makeEnv();
      const row = conversationRow({
        runId: 'approval-live-root',
        threadId: 'approval-live-thread',
        status: 'running',
        userMessageId: 'approval-live-user',
        assistantMessageId: 'approval-live-assistant',
        streamCursor: 99,
      });
      seedConversationProjection(env, row, 'approval-live-user', 'approval-live-assistant');
      env.repos.seedStaleApproval({
        threadId: row.thread_id,
        companyId: row.company_id,
        attemptId: row.run_id,
        hostRequestId: 'host-approval-live',
        uiRequestId: 'ui-approval-live',
      });

      const bootstrap = await env.controller.bootstrapLiveRuns('co');
      const approval = env.controller.getSnapshot(row.thread_id).approval;
      assert.equal(bootstrap.complete, true);
      assert.equal(approval?.state, 'live');
      assert.equal(env.controller.getSnapshot(row.thread_id).phase, 'awaiting-approval');
      assert.ok(approval);
      await env.controller.answerApproval({
        threadId: row.thread_id,
        attemptId: row.run_id,
        hostRequestId: approval.hostRequestId,
        uiRequestId: approval.uiRequestId,
        confirmed: true,
      });
      assert.deepEqual(env.runtime.answers, [
        {
          runId: 'approval-live-root',
          requestId: 'host-approval-live',
          id: 'ui-approval-live',
          confirmed: true,
          value: undefined,
          cancelled: undefined,
        },
      ]);
      return { cursor: 99, approvalState: approval.state, answerCount: 1 };
    },
  },
  {
    name: 'reload restores delegated workload already behind the replay cursor',
    criteria:
      'Pass when a running child from agent_runs repopulates the delegated employee workload before reattach, even though no historical run.started event is replayed.',
    run: async () => {
      const env = makeEnv();
      const root = conversationRow({
        runId: 'delegation-live-root',
        threadId: 'delegation-live-thread',
        status: 'running',
        userMessageId: 'delegation-live-user',
        assistantMessageId: 'delegation-live-assistant',
        streamCursor: 77,
      });
      const child: AgentRunRow = {
        ...root,
        run_id: 'delegation-live-child',
        parent_run_id: root.run_id,
        root_run_id: root.run_id,
        employee_id: 'emp-delegated',
        relation: 'delegate',
        work_kind: 'implement',
        objective: 'Implement the delegated slice',
        runtime_context_json: null,
      };
      seedConversationProjection(env, root, 'delegation-live-user', 'delegation-live-assistant');
      env.repos.runRows.set(child.run_id, child);

      await env.controller.bootstrapLiveRuns('co');
      const snapshot = env.controller.getSnapshot(root.thread_id);
      const workloads = projectEmployeeWorkloads(env.controller.getGlobalSnapshot(), 'prj');
      assert.deepEqual(
        snapshot.delegations.map((delegation) => [
          delegation.runId,
          delegation.employeeId,
          delegation.state,
          delegation.workKind,
        ]),
        [['delegation-live-child', 'emp-delegated', 'running', 'implement']],
      );
      assert.deepEqual(workloads.get('emp-delegated')?.activeRunIds, [child.run_id]);
      assert.equal(workloads.get('emp-delegated')?.activeCount, 1);
      return {
        cursor: 77,
        delegatedEmployee: 'emp-delegated',
        activeRuns: workloads.get('emp-delegated')?.activeRunIds,
      };
    },
  },
  {
    name: 'incomplete live bootstrap retries before classifying approval stale',
    criteria:
      'Pass when a transient native reattach failure rejects approval hydration without publishing stale state, then the next hydration restores the same request as live.',
    run: async () => {
      const env = makeEnv();
      const row = conversationRow({
        runId: 'approval-retry-root',
        threadId: 'approval-retry-thread',
        status: 'running',
        userMessageId: 'approval-retry-user',
        assistantMessageId: 'approval-retry-assistant',
      });
      seedConversationProjection(env, row, 'approval-retry-user', 'approval-retry-assistant');
      env.repos.seedStaleApproval({
        threadId: row.thread_id,
        companyId: row.company_id,
        attemptId: row.run_id,
        hostRequestId: 'host-approval-retry',
        uiRequestId: 'ui-approval-retry',
      });
      let attempts = 0;
      env.runtime.onReattach = async (rootRunIds) => {
        attempts += 1;
        if (attempts === 1) throw new Error('transient native snapshot failure');
        return {
          protectedRootRunIds: new Set(rootRunIds ?? []),
          handledRootRunIds: new Set(rootRunIds ?? []),
          confirmedMissingRootRunIds: new Set(),
          complete: true,
        };
      };

      await assert.rejects(
        () => env.controller.hydrateStaleApprovals('co'),
        /bootstrap is incomplete/u,
      );
      assert.notEqual(env.controller.getSnapshot(row.thread_id).approval?.state, 'stale');
      await env.controller.hydrateStaleApprovals('co');
      assert.equal(env.controller.getSnapshot(row.thread_id).approval?.state, 'live');
      assert.equal(attempts, 2);
      return { attempts, finalApproval: 'live' };
    },
  },
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

      const scopeC = { companyId: 'co', projectId: 'prj-c', threadId: 'thread-c' };
      const keyC = composerAttachmentScopeKey(scopeC);
      const eightMb = 8 * 1024 * 1024;
      await useComposerAttachmentStore.getState().stageFiles(scopeC, [
        { name: 'unsafe.exe', bytes: 12, type: 'application/x-msdownload' },
        { name: 'one.png', bytes: eightMb, type: 'image/png' },
        { name: 'two.png', bytes: eightMb, type: 'image/png' },
        { name: 'three.png', bytes: eightMb, type: 'image/png' },
        { name: 'over-total.png', bytes: 1, type: 'image/png' },
        { name: 'over-file.png', bytes: eightMb + 1, type: 'image/png' },
      ]);
      const bounded = useComposerAttachmentStore.getState().stagedByScope[keyC] ?? [];
      assert.equal(
        bounded.find((item) => item.name === 'unsafe.exe')?.failReason,
        'unsupported-type',
      );
      assert.equal(
        bounded.find((item) => item.name === 'over-total.png')?.failReason,
        'total-too-large',
      );
      assert.equal(bounded.find((item) => item.name === 'over-file.png')?.failReason, 'too-large');

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
      return {
        failedDraftRetained: true,
        retryConsumedAOnly: true,
        boundedAdmission: true,
        bCount: 1,
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
      assert.equal(
        snapshot.liveMessages[0]?.attachments?.[0]?.vaultRef,
        'attachment://co/thread-1/vault-readme',
      );
      assert.equal(snapshot.liveMessages[0]?.attemptId, snapshot.attemptId);
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
              start: async (threadRunLease) => {
                startCalls += 1;
                threadRunLease?.release();
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
              start: async (threadRunLease) => {
                startCalls += 1;
                if (startCalls === 1) throw new Error('runtime assembly unavailable');
                threadRunLease?.release();
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
    name: 'Stop during prelaunch Loop handoff keeps the exact ready Mission retryable',
    criteria:
      'Pass when Stop aborts a pending Mission assembly before paid launch, preserves interrupted UI, releases the thread, and Retry reuses the exact ready Mission.',
    run: async () => {
      const env = makeEnv();
      const startEntered = new Deferred<void>();
      const releaseStart = new Deferred<void>();
      let materializeCalls = 0;
      let startCalls = 0;
      let paidLaunches = 0;
      const handle = await submitDefault(env.controller, {
        loopExecution: {
          materialize: async () => {
            materializeCalls += 1;
            return {
              start: async (threadRunLease, signal) => {
                startCalls += 1;
                startEntered.resolve(undefined);
                await releaseStart.promise;
                if (signal?.aborted) {
                  threadRunLease?.release();
                  const error = new Error('stopped before launch');
                  error.name = 'AbortError';
                  throw error;
                }
                paidLaunches += 1;
                threadRunLease?.release();
              },
              compensate: async () => {},
            };
          },
        },
      });
      await startEntered.promise;
      await env.controller.stopAndWait('thread-1');
      releaseStart.resolve(undefined);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(paidLaunches, 0);
      assert.equal(env.controller.getSnapshot('thread-1').phase, 'interrupted');

      await env.controller.retry('thread-1', handle.attemptId);
      await waitFor(
        'exact ready Mission retry completed',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      assert.equal(materializeCalls, 1);
      assert.equal(startCalls, 2);
      assert.equal(paidLaunches, 1);
      return { materializeCalls, startCalls, paidLaunches };
    },
  },
  {
    name: 'Stop after Loop launch aborts it and Retry rematerializes a new Mission',
    criteria:
      'Pass when a launched Mission receives Stop, late launch receipt cannot overwrite interrupted UI, and Retry never reuses the cancelled Mission handoff.',
    run: async () => {
      const env = makeEnv();
      const launchEntered = new Deferred<void>();
      const releaseLaunchReceipt = new Deferred<void>();
      let materializeCalls = 0;
      let paidLaunches = 0;
      let launchAborts = 0;
      const handle = await submitDefault(env.controller, {
        loopExecution: {
          materialize: async () => {
            materializeCalls += 1;
            const materialization = materializeCalls;
            return {
              start: async (threadRunLease, signal) => {
                paidLaunches += 1;
                if (materialization === 1) {
                  signal?.addEventListener(
                    'abort',
                    () => {
                      launchAborts += 1;
                      threadRunLease?.release();
                    },
                    { once: true },
                  );
                  launchEntered.resolve(undefined);
                  await releaseLaunchReceipt.promise;
                  return;
                }
                threadRunLease?.release();
              },
              compensate: async () => {},
            };
          },
        },
      });
      await launchEntered.promise;
      await env.controller.stopAndWait('thread-1');
      releaseLaunchReceipt.resolve(undefined);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(launchAborts, 1);
      assert.equal(env.controller.getSnapshot('thread-1').phase, 'interrupted');

      await env.controller.retry('thread-1', handle.attemptId);
      await waitFor(
        'replacement Mission completed',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      assert.equal(materializeCalls, 2, 'cancelled Mission handoff is never reused');
      assert.equal(paidLaunches, 2);
      return { materializeCalls, paidLaunches, launchAborts };
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
              start: async (threadRunLease) => {
                startCalls += 1;
                threadRunLease?.release();
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
              start: async (threadRunLease) => {
                startCalls += 1;
                threadRunLease?.release();
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
      'Pass when repeated Stop aborts runtime once, snapshot immediately retires running tools, and the persisted assistant checkpoint is marked interrupted.',
    run: async () => {
      const env = makeEnv();
      env.runtime.onExecute = async (input) => {
        env.runtime.emitTool(
          input,
          'started',
          'tool-stop-shell',
          'bash',
          JSON.stringify({ input: { command: 'sleep 30' } }),
        );
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
      const interruptedSnapshot = env.controller.getSnapshot('thread-1');
      const interruptedAssistant = interruptedSnapshot.liveMessages[1];
      assert.equal(interruptedAssistant?.status, 'interrupted');
      assert.equal(interruptedAssistant && 'toolCalls' in interruptedAssistant, false);
      assert.deepEqual(env.runtime.aborts, ['thread-1']);
      await waitFor('durable interrupted checkpoint after runtime settlement', () =>
        env.persisted.some((call) => call.message.status === 'interrupted'),
      );
      return {
        phase: env.controller.getSnapshot('thread-1').phase,
        aborts: env.runtime.aborts,
        visibleRunningTools: 0,
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
      assert.equal(
        persistedStatuses.includes('interrupted'),
        false,
        'durable interruption must wait behind the already-started final write',
      );

      releaseFinalPersist.resolve(undefined);
      await waitFor(
        'interrupted terminal persistence wins last',
        () => persistedStatuses.at(-1) === 'interrupted',
      );
      assert.equal(
        env.controller.getSnapshot('thread-1').phase,
        'interrupted',
        'late final persistence must not resurrect the stopped run',
      );
      assert.equal(
        persistedStatuses.at(-1),
        'interrupted',
        'event replay must observe interrupted as the final assistant state',
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
      'Pass when workspace status and tool start/completion update activity, append terminal tool events, and no persisted chat message stores toolCalls.',
    run: async () => {
      const env = makeEnv();
      const workspaceProvenance: WorkspaceProvenance = {
        availability: 'bound',
        source: 'conversation_history',
        reasonCode: 'recent_successful_workspace',
        displayPath: '~/Projects/offisim',
      };
      const workspaceDetail = formatWorkspaceProvenance(workspaceProvenance);
      assert.ok(workspaceDetail);
      env.runtime.onExecute = async (input) => {
        env.runtime.emitTool(
          input,
          'started',
          'workspace-status',
          'Workspace',
          undefined,
          workspaceProvenance,
        );
        env.runtime.emitTool(
          input,
          'completed',
          'workspace-status',
          'Workspace',
          undefined,
          workspaceProvenance,
        );
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
      const workspaceActivity = snapshot.activity.find((entry) => entry.id === 'workspace-status');
      assert.equal(workspaceActivity?.state, 'done');
      assert.equal(workspaceActivity?.detail, workspaceDetail);
      const shellActivity = snapshot.activity.find((entry) => entry.id === 'tool-shell');
      assert.equal(shellActivity?.state, 'done');
      assert.equal(shellActivity?.detail, 'Built-in');
      assert.ok(!shellActivity?.detail?.includes('pi_agent'));
      const richDetail = shellActivity?.richDetail;
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
    name: 'request user input submits structured answers without persisting secrets',
    criteria:
      'Pass when up to three generic questions remain live, answers are keyed by question id, and secret answer values never reach active/history/event persistence.',
    run: async () => {
      const env = makeEnv();
      const secret = 'top-secret-never-persist';
      env.runtime.onExecute = async (input) => {
        env.runtime.emitUiRequest(input, 'requestUserInput', 'ui-input', {
          questions: [
            {
              id: 'scope',
              header: 'Scope',
              question: 'Which area?',
              options: [
                { label: 'Renderer', description: 'Desktop UI' },
                { label: 'Runtime', description: 'Agent runtime' },
              ],
              isOther: true,
              isSecret: false,
            },
            {
              id: 'token',
              header: 'Credential',
              question: 'Temporary token',
              options: null,
              isOther: false,
              isSecret: true,
            },
          ],
        });
        await waitFor('structured input answer', () => env.runtime.answers.length === 1);
        env.runtime.emitContent(input, 'continued after input');
        return { text: 'continued after input' };
      };
      await submitDefault(env.controller);
      await waitFor(
        'request user input pending',
        () => env.controller.getSnapshot('thread-1').phase === 'awaiting-approval',
      );
      const approval = env.controller.getSnapshot('thread-1').approval;
      assert.ok(approval);
      assert.equal(approval.engineId, 'api');
      assert.equal(approval.questions?.length, 2);
      const activeBeforeAnswer = env.repos.activeRows.get('thread-1');
      assert.ok(activeBeforeAnswer);
      assert.doesNotMatch(JSON.stringify(activeBeforeAnswer), new RegExp(secret, 'u'));
      await env.controller.answerApproval({
        threadId: 'thread-1',
        attemptId: approval.attemptId,
        hostRequestId: approval.hostRequestId,
        uiRequestId: approval.uiRequestId,
        answers: {
          scope: { answers: ['Renderer'] },
          token: { answers: [secret] },
        },
      });
      await waitFor(
        'request user input run complete',
        () => env.controller.getSnapshot('thread-1').phase === 'completed',
      );
      assert.deepEqual(env.runtime.answers[0]?.answers, {
        scope: { answers: ['Renderer'] },
        token: { answers: [secret] },
      });
      const persistedProjection = JSON.stringify({
        events: env.appendedEvents,
        history: env.repos.historyRows,
        active: [...env.repos.activeRows.values()],
      });
      assert.doesNotMatch(persistedProjection, new RegExp(secret, 'u'));
      assert.equal(env.repos.historyRows[0]?.freeform_response, null);
      return {
        questionIds: approval.questions?.map((question) => question.id),
        runtimeAnswerKeys: Object.keys(env.runtime.answers[0]?.answers ?? {}),
        persistedSecret: persistedProjection.includes(secret),
      };
    },
  },
  {
    name: 'unknown UI request auto-cancels without creating a durable card',
    criteria:
      'Pass when an unknown UI primitive is cancelled immediately without a fake approval card or durable interaction history.',
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
      assert.equal(env.repos.historyRows.length, 0);
      assert.equal(env.controller.getSnapshot('thread-1').approval, null);
      return {
        answer: env.runtime.answers[0],
        historyCount: env.repos.historyRows.length,
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
      env.runtime.onExecute = async (input, signal) => {
        env.runtime.emitContent(input, `running ${input.threadId}`);
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
        return { text: '' };
      };
      let freshLookupCalls = 0;
      const findFreshCandidate = env.repos.agentRuns.findLatestFreshSessionCandidate;
      env.repos.agentRuns.findLatestFreshSessionCandidate = async (companyId, threadId) => {
        freshLookupCalls += 1;
        return findFreshCandidate(companyId, threadId);
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
      assert.equal(freshLookupCalls, 0, 'approval hydration never scans Fresh-session candidates');
      return {
        staleApproval: env.controller.getSnapshot('stale-thread').approval?.state,
        employeeStates: Array.from(employeeStates.entries()),
        activeRuns: global.activeRuns.map((run) => [run.threadId, run.employeeId, run.phase]),
      };
    },
  },
  {
    name: 'stale-approval hydration cannot interrupt a currently active thread',
    criteria:
      'Pass when a persisted stale approval for a thread is ignored while that same thread owns a live run, preserving its running phase and empty approval projection.',
    run: async () => {
      const env = makeEnv();
      env.repos.seedStaleApproval({
        threadId: 'hydration-race-thread',
        companyId: 'co',
        attemptId: 'attempt-stale-hydration-race',
        hostRequestId: 'host-stale-hydration-race',
        uiRequestId: 'ui-stale-hydration-race',
      });
      env.runtime.onExecute = async (_input, signal) => {
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
        return { text: 'stopped hydration race' };
      };

      await submitDefault(env.controller, {
        threadId: 'hydration-race-thread',
        employeeId: 'emp-1',
      });
      await waitFor(
        'hydration race run is active',
        () => env.controller.getSnapshot('hydration-race-thread').phase === 'running',
      );
      await env.controller.hydrateStaleApprovals('co');

      const snapshot = env.controller.getSnapshot('hydration-race-thread');
      assert.equal(snapshot.phase, 'running');
      assert.equal(snapshot.approval, null);
      assert.equal(env.controller.isActive('hydration-race-thread'), true);
      await env.controller.stopAndWait('hydration-race-thread');
      return {
        phaseAfterHydration: snapshot.phase,
        approvalAfterHydration: snapshot.approval,
        activeAfterHydration: true,
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
      env.runtime.onExecute = async (input, signal) => {
        env.runtime.emitContent(input, `running ${input.threadId}`);
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
        return { text: '' };
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
      await env.controller.stopAndWait('thread-a');
      await env.controller.stopAndWait('thread-b');
      await new Promise<void>((resolve) => setImmediate(resolve));
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
      env.runtime.onExecute = async (input, signal) => {
        if (input.threadId === 'thread-b') {
          env.runtime.emitContent(input, 'done b');
          return { text: 'done b' };
        }
        env.runtime.emitContent(input, 'running a');
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
        return { text: '' };
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
      await env.controller.stopAndWait('thread-a');
      await new Promise<void>((resolve) => setImmediate(resolve));
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
  {
    name: 'reload restores exact Fresh action and keeps attachment internals out of titles',
    criteria:
      'Pass when a latest failed plain Conversation Turn hydrates only Start fresh session, executes the materialized prompt with exact source authority, and titles from the visible user body.',
    run: async () => {
      const env = makeEnv();
      const userBody = 'Review the attached launch brief';
      const materialized = `${userBody}\n\n[attachments:1 internal-ref=vault-brief]`;
      seedFreshSessionSource(env, {
        runId: 'fresh-reload-source',
        threadId: 'fresh-reload-thread',
        recoveryLane: 'conversation',
        userBody,
        objective: materialized,
        attachments: [
          {
            id: 'vault-brief',
            name: 'launch-brief.md',
            sizeLabel: '12 B',
            kind: 'document',
          },
        ],
      });
      env.runtime.onExecute = async (input) => ({
        text: 'Fresh work completed',
        provenance: {
          engineId: 'pi-agent',
          accountId: 'subscription-test',
          billingMode: 'subscription',
          modelId: 'provider/model-leaf',
          runtimeModelRef: 'codex:preset-test',
          runId: input.runId ?? 'missing-run',
        },
      });

      await env.controller.hydrateFreshSessionAction('co', 'fresh-reload-thread');
      const hydrated = env.controller.getSnapshot('fresh-reload-thread');
      assert.equal(hydrated.phase, 'failed');
      assert.equal(hydrated.error?.recoveryAction?.label, 'Start fresh session');
      assert.equal(
        hydrated.error?.retry,
        undefined,
        'Fresh and ordinary Retry are mutually exclusive',
      );
      let threadLookupCallsAfterHydration = 0;
      const threadLookup = env.repos.agentRuns.findLatestFreshSessionCandidate;
      env.repos.agentRuns.findLatestFreshSessionCandidate = async (
        companyId: string,
        threadId: string,
      ) => {
        threadLookupCallsAfterHydration += 1;
        return threadLookup(companyId, threadId);
      };
      let exactSourceCalls = 0;
      const findFreshSource = env.repos.agentRuns.findFreshSessionSource;
      env.repos.agentRuns.findFreshSessionSource = async (
        companyId: string,
        threadId: string,
        sourceRunId: string,
      ) => {
        exactSourceCalls += 1;
        return findFreshSource(companyId, threadId, sourceRunId);
      };
      hydrated.error?.recoveryAction?.run();
      await waitFor(
        'reloaded Fresh completion',
        () => env.controller.getSnapshot('fresh-reload-thread').phase === 'completed',
      );
      await waitFor('semantic title input', () => env.runtime.generateTextCalls.length === 1);
      const execute = env.runtime.executeCalls[0];
      const titleInput = env.runtime.generateTextCalls[0]?.text ?? '';
      assert.equal(execute?.text, materialized, 'agent receives the durable materialized prompt');
      assert.equal(execute?.nativeSessionMode, 'fresh');
      assert.equal(execute?.nativeSessionResetSourceRunId, 'fresh-reload-source');
      assert.equal(
        threadLookupCallsAfterHydration,
        0,
        'one Fresh click revalidates only its exact source and never rehydrates the thread',
      );
      assert.equal(exactSourceCalls, 1, 'one Fresh click performs one exact source lookup');
      assert.match(titleInput, /User:\nReview the attached launch brief/u);
      assert.doesNotMatch(titleInput, /attachments:1|internal-ref|vault-brief/u);
      return {
        action: hydrated.error?.recoveryAction?.label,
        retry: hydrated.error?.retry ?? null,
        executeText: execute?.text,
        sourceRunId: execute?.nativeSessionResetSourceRunId,
        threadLookupCallsAfterHydration,
        exactSourceCalls,
        titleInput,
      };
    },
  },
  {
    name: 'Fresh hydration cannot overwrite a newer completed Turn after message I/O',
    criteria:
      'Pass when a newer durable Turn completes while old Fresh messages are loading and the post-await exact-source check refuses to publish the stale recovery action.',
    run: async () => {
      const loadEntered = new Deferred<void>();
      const releaseLoad = new Deferred<void>();
      const env = makeEnv({
        beforeLoadMessagesByIds: async () => {
          loadEntered.resolve();
          await releaseLoad.promise;
        },
      });
      const source = seedFreshSessionSource(env, {
        runId: 'fresh-hydration-stale-source',
        threadId: 'fresh-hydration-stale-thread',
        recoveryLane: 'conversation',
      });
      let exactSourceCalls = 0;
      const findFreshSource = env.repos.agentRuns.findFreshSessionSource;
      env.repos.agentRuns.findFreshSessionSource = async (
        companyId: string,
        threadId: string,
        sourceRunId: string,
      ) => {
        exactSourceCalls += 1;
        return findFreshSource(companyId, threadId, sourceRunId);
      };

      const hydration = env.controller.hydrateFreshSessionAction(
        'co',
        'fresh-hydration-stale-thread',
      );
      await loadEntered.promise;
      env.repos.runRows.set('fresh-hydration-newer', {
        ...source.row,
        run_id: 'fresh-hydration-newer',
        root_run_id: 'fresh-hydration-newer',
        status: 'completed',
        session_file: '/native/fresh-hydration-newer.jsonl',
        started_at: '2026-06-20T00:00:02.000Z',
        finished_at: '2026-06-20T00:00:03.000Z',
      });
      releaseLoad.resolve();
      await hydration;

      const snapshot = env.controller.getSnapshot('fresh-hydration-stale-thread');
      assert.equal(exactSourceCalls, 1, 'hydration rechecks the exact source after message I/O');
      assert.equal(snapshot.phase, 'idle');
      assert.equal(snapshot.attemptId, null);
      assert.equal(snapshot.error, null, 'stale Fresh action never overwrites the newer Turn');
      return {
        exactSourceCalls,
        phase: snapshot.phase,
        staleAction: snapshot.error?.recoveryAction?.label ?? null,
      };
    },
  },
  {
    name: 'Fresh double-click starts one attempt and cannot overwrite its snapshot',
    criteria:
      'Pass when two invocations share the preflight mutation lease, dispatch exactly one Fresh attempt, and the rejected duplicate cannot replace the new running snapshot.',
    run: async () => {
      const env = makeEnv();
      seedFreshSessionSource(env, {
        runId: 'fresh-double-source',
        threadId: 'fresh-double-thread',
        recoveryLane: 'conversation',
      });
      await env.controller.hydrateFreshSessionAction('co', 'fresh-double-thread');
      const sourceSnapshot = env.controller.getSnapshot('fresh-double-thread');
      const action = sourceSnapshot.error?.recoveryAction?.run;
      assert.ok(action);

      const lookupEntered = new Deferred<void>();
      const releaseLookup = new Deferred<void>();
      const findFreshSource = env.repos.agentRuns.findFreshSessionSource;
      env.repos.agentRuns.findFreshSessionSource = async (
        companyId: string,
        threadId: string,
        sourceRunId: string,
      ) => {
        lookupEntered.resolve();
        await releaseLookup.promise;
        return findFreshSource(companyId, threadId, sourceRunId);
      };
      env.runtime.onExecute = async (_input, signal) => {
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
        const error = new Error('stopped');
        error.name = 'AbortError';
        throw error;
      };

      action();
      action();
      await lookupEntered.promise;
      releaseLookup.resolve();
      await waitFor('single Fresh dispatch', () => env.runtime.executeCalls.length === 1);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const running = env.controller.getSnapshot('fresh-double-thread');
      assert.notEqual(running.attemptId, 'fresh-double-source');
      assert.equal(running.phase, 'running');
      assert.equal(running.error, null);
      assert.equal(env.runtime.executeCalls.length, 1);
      await env.controller.stopAndWait('fresh-double-thread');
      return {
        executeCalls: env.runtime.executeCalls.length,
        runningAttempt: running.attemptId,
        duplicateDidNotOverwrite: running.error === null,
      };
    },
  },
  {
    name: 'Fresh preflight blocks concurrent Submit before any write or dispatch',
    criteria:
      'Pass when Fresh owns the Conversation before its first DB await, so a same-thread Submit is rejected without persistence and Fresh remains the only dispatched attempt.',
    run: async () => {
      const env = makeEnv();
      seedFreshSessionSource(env, {
        runId: 'fresh-submit-source',
        threadId: 'fresh-submit-thread',
        recoveryLane: 'conversation',
      });
      await env.controller.hydrateFreshSessionAction('co', 'fresh-submit-thread');
      const persistedBefore = env.persisted.length;
      const lookupEntered = new Deferred<void>();
      const releaseLookup = new Deferred<void>();
      const findFreshSource = env.repos.agentRuns.findFreshSessionSource;
      env.repos.agentRuns.findFreshSessionSource = async (
        companyId: string,
        threadId: string,
        sourceRunId: string,
      ) => {
        lookupEntered.resolve();
        await releaseLookup.promise;
        return findFreshSource(companyId, threadId, sourceRunId);
      };
      env.runtime.onExecute = async () => ({ text: 'Fresh only' });
      env.controller.getSnapshot('fresh-submit-thread').error?.recoveryAction?.run();
      await lookupEntered.promise;
      await assert.rejects(
        () =>
          submitDefault(env.controller, {
            threadId: 'fresh-submit-thread',
            text: 'Competing submit',
          }),
        ConversationRunMutationLockedError,
      );
      assert.equal(env.persisted.length, persistedBefore, 'blocked Submit wrote no message');
      const blockedWriteDelta = env.persisted.length - persistedBefore;
      assert.equal(env.runtime.executeCalls.length, 0, 'Fresh waits for durable validation');
      releaseLookup.resolve();
      await waitFor(
        'Fresh after concurrent Submit rejection',
        () => env.controller.getSnapshot('fresh-submit-thread').phase === 'completed',
      );
      assert.equal(env.runtime.executeCalls.length, 1);
      return {
        blockedWrites: blockedWriteDelta,
        executeCalls: env.runtime.executeCalls.length,
        phase: env.controller.getSnapshot('fresh-submit-thread').phase,
      };
    },
  },
  {
    name: 'reload fails closed for every non-Conversation recovery lane',
    criteria:
      'Pass when direct delegation, Mission, and unclassified legacy rows never hydrate a Fresh action that would silently downgrade them into plain chat.',
    run: async () => {
      const env = makeEnv();
      seedFreshSessionSource(env, {
        runId: 'fresh-direct-source',
        threadId: 'fresh-direct-thread',
        recoveryLane: 'direct-delegation',
      });
      seedFreshSessionSource(env, {
        runId: 'fresh-mission-source',
        threadId: 'fresh-mission-thread',
        recoveryLane: 'mission',
      });
      const legacy = seedFreshSessionSource(env, {
        runId: 'fresh-legacy-source',
        threadId: 'fresh-legacy-thread',
        recoveryLane: 'conversation',
      });
      const legacyContext = JSON.parse(legacy.row.runtime_context_json ?? '{}') as Record<
        string,
        unknown
      >;
      legacyContext.recoveryLane = undefined;
      legacy.row.runtime_context_json = JSON.stringify(legacyContext);

      for (const threadId of [
        'fresh-direct-thread',
        'fresh-mission-thread',
        'fresh-legacy-thread',
      ]) {
        await env.controller.hydrateFreshSessionAction('co', threadId);
        const snapshot = env.controller.getSnapshot(threadId);
        assert.equal(snapshot.attemptId, null, `${threadId} must not become plain chat`);
        assert.equal(snapshot.error?.recoveryAction, undefined);
      }
      return {
        hydratedActions: [
          'fresh-direct-thread',
          'fresh-mission-thread',
          'fresh-legacy-thread',
        ].filter((threadId) => Boolean(env.controller.getSnapshot(threadId).error?.recoveryAction)),
      };
    },
  },
  {
    name: 'workspace producer stays silent for current Project and discloses recovery exactly once',
    criteria:
      'Pass when the production disclosure decision emits no Workspace activity/payload for the current Project, while a recovered binding becomes exact live activity and durable message content.',
    run: async () => {
      const env = makeEnv();
      env.runtime.onExecute = async (input) => {
        env.runtime.emitWorkspaceBinding(
          input,
          workspaceClaim(input, 'project_catalog', 'current_project_folder'),
        );
        env.runtime.emitContent(input, 'normal answer');
        return { text: 'normal answer' };
      };
      await submitDefault(env.controller, { threadId: 'workspace-current-thread' });
      await waitFor(
        'current Project completion',
        () => env.controller.getSnapshot('workspace-current-thread').phase === 'completed',
      );
      const current = env.controller.getSnapshot('workspace-current-thread');
      assert.equal(current.activity.filter((item) => item.tool === 'Workspace').length, 0);
      assert.equal(current.liveMessages[1]?.workspaceProvenance, undefined);
      assert.equal(
        env.persisted.find(
          (call) =>
            call.message.threadId === 'workspace-current-thread' &&
            call.message.author === 'employee' &&
            call.message.status === 'complete',
        )?.message.workspaceProvenance,
        undefined,
      );

      const provenance: WorkspaceProvenance = {
        availability: 'bound',
        source: 'conversation_history',
        reasonCode: 'recent_successful_workspace',
        displayPath: '/Users/test/Projects/offisim',
      };
      const detail = formatWorkspaceProvenance(provenance);
      assert.ok(detail);
      env.runtime.onExecute = async (input) => {
        env.runtime.emitWorkspaceBinding(
          input,
          workspaceClaim(input, 'conversation_history', 'recent_successful_workspace'),
        );
        env.runtime.emitContent(input, 'recovered answer');
        return { text: 'recovered answer' };
      };
      await submitDefault(env.controller, { threadId: 'workspace-recovered-thread' });
      await waitFor(
        'recovered Project completion',
        () => env.controller.getSnapshot('workspace-recovered-thread').phase === 'completed',
      );
      const recovered = env.controller.getSnapshot('workspace-recovered-thread');
      const workspaceItems = recovered.activity.filter((item) => item.tool === 'Workspace');
      assert.equal(workspaceItems.length, 1);
      assert.equal(workspaceItems[0]?.detail, detail);
      assert.deepEqual(recovered.liveMessages[1]?.workspaceProvenance, provenance);
      const durable = env.persisted.find(
        (call) =>
          call.message.threadId === 'workspace-recovered-thread' &&
          call.message.author === 'employee' &&
          call.message.status === 'complete',
      )?.message;
      assert.deepEqual(durable?.workspaceProvenance, provenance);
      const reloaded = JSON.parse(JSON.stringify(durable)) as ChatMessage;
      assert.deepEqual(reloaded.workspaceProvenance, provenance);
      return {
        currentWorkspaceActivities: current.activity.filter((item) => item.tool === 'Workspace')
          .length,
        currentProvenance: current.liveMessages[1]?.workspaceProvenance ?? null,
        recoveredWorkspaceActivities: workspaceItems.length,
        recoveredDetail: workspaceItems[0]?.detail,
        reloadedProvenance: reloaded.workspaceProvenance,
      };
    },
  },
  {
    name: 'restored live run strips skill tokens from engine-bound restored text',
    criteria:
      'Pass when a renderer reload hydrates a run whose durable bodies carry [[skill:id]] chip tokens and every engine-bound restored text (queued turn delivery) is stripped and rebuilt with an explicit invocation directive, while the durable projection keeps the token.',
    run: async () => {
      const row = conversationRow({
        runId: 'restore-skill-root',
        threadId: 'restore-skill-thread',
        status: 'running',
        userMessageId: 'restore-skill-user',
        assistantMessageId: 'restore-skill-assistant',
      });
      row.objective = 'Summarize this. [[skill:research-summary]]';
      const queued: ChatMessage = {
        id: 'restore-skill-queued',
        threadId: row.thread_id,
        author: 'boss',
        employeeId: null,
        body: 'Also queue this. [[skill:research-summary]]',
        at: Date.parse('2026-06-20T00:00:01.000Z'),
        attachments: [],
        attemptId: row.run_id,
        queueBehavior: 'followUp',
        queueState: 'pending',
        status: 'complete',
      };
      const env = makeEnv({ threadMessages: [queued] });
      env.repos.skillRows.set('research-summary', {
        skill_id: 'research-summary',
        name: 'Research Summary',
        description: 'Summarize source material.',
        scope: 'company',
        vault_path: 'companies/co/skills/research/SKILL.md',
      });
      seedConversationProjection(env, row, 'restore-skill-user', 'restore-skill-assistant');

      await env.controller.bootstrapLiveRuns('co');
      await waitFor('restored queued delivery', () => env.runtime.queuedMessages.length === 1);
      const delivered = env.runtime.queuedMessages[0]?.message.text ?? '';
      assert.ok(
        !delivered.includes('[[skill:'),
        `engine-bound queued text must not carry a raw skill token: ${delivered}`,
      );
      assert.match(delivered, /^Also queue this\./u);
      assert.ok(
        delivered.includes('Use the "Research Summary" skill for this task:'),
        'the restored queued turn rebuilds the invocation directive from skills data',
      );
      const durableUser = env.controller
        .getSnapshot(row.thread_id)
        .liveMessages.find((message) => message.id === 'restore-skill-user');
      assert.equal(
        durableUser?.body,
        'Summarize this. [[skill:research-summary]]',
        'the durable projection keeps the protected chip token',
      );
      return {
        delivered,
        durableUserBody: durableUser?.body,
      };
    },
  },
  {
    name: 'fresh-session recovery strips skill tokens from the engine prompt',
    criteria:
      'Pass when a reloaded failed Turn whose durable body carries a [[skill:id]] chip token executes Start fresh session with a token-free engine prompt that rebuilds the invocation directive from skills data.',
    run: async () => {
      const env = makeEnv();
      env.repos.skillRows.set('research-summary', {
        skill_id: 'research-summary',
        name: 'Research Summary',
        description: 'Summarize source material.',
        scope: 'company',
        vault_path: 'companies/co/skills/research/SKILL.md',
      });
      seedFreshSessionSource(env, {
        runId: 'fresh-skill-source',
        threadId: 'fresh-skill-thread',
        recoveryLane: 'conversation',
        userBody: 'Continue this. [[skill:research-summary]]',
      });

      await env.controller.hydrateFreshSessionAction('co', 'fresh-skill-thread');
      const hydrated = env.controller.getSnapshot('fresh-skill-thread');
      assert.equal(hydrated.phase, 'failed');
      assert.equal(hydrated.error?.recoveryAction?.label, 'Start fresh session');
      hydrated.error?.recoveryAction?.run();
      await waitFor(
        'fresh-skill completion',
        () => env.controller.getSnapshot('fresh-skill-thread').phase === 'completed',
      );
      const text = env.runtime.executeCalls[0]?.text ?? '';
      assert.ok(
        !text.includes('[[skill:'),
        `engine prompt must not carry a raw skill token: ${text}`,
      );
      assert.match(text, /^Continue this\./u);
      assert.ok(
        text.includes('Use the "Research Summary" skill for this task:'),
        'the fresh-session prompt rebuilds the invocation directive from skills data',
      );
      return { executeText: text };
    },
  },
  {
    name: 'terminated run merge prefers persisted seed while keeping live-only ids',
    criteria:
      'Pass when an inactive run phase lets the persisted seed win per id — a stale live copy cannot overwrite durable metadata — while live-only ids are still appended, and an active phase lets the live projection win.',
    run: async () => {
      const message = (input: Partial<ChatMessage> & Pick<ChatMessage, 'id'>): ChatMessage => ({
        threadId: 'merge-thread',
        author: 'employee',
        employeeId: 'emp-1',
        body: input.id,
        at: 0,
        status: 'complete',
        ...input,
      });
      const seed = [
        message({ id: 'm1', author: 'boss', employeeId: null, at: 1, queueState: 'consumed' }),
        message({ id: 'm2', body: 'durable answer', at: 2 }),
      ];
      const live = [
        message({ id: 'm2', body: 'stale partial', at: 2, status: 'streaming' }),
        message({ id: 'm3', body: 'live only', at: 3, status: 'streaming' }),
      ];
      const terminated = mergeMessages(seed, live, false);
      assert.deepEqual(
        terminated.map((entry) => entry.id),
        ['m1', 'm2', 'm3'],
        'live-only ids are still appended after the run terminates',
      );
      assert.equal(
        terminated.find((entry) => entry.id === 'm2')?.body,
        'durable answer',
        'persisted seed wins per id once the run is terminal',
      );
      assert.equal(
        terminated.find((entry) => entry.id === 'm1')?.queueState,
        'consumed',
        'stale live copies cannot overwrite durable metadata',
      );
      const active = mergeMessages(seed, live, true);
      assert.equal(
        active.find((entry) => entry.id === 'm2')?.body,
        'stale partial',
        'the live projection still wins while the run is active',
      );
      return {
        terminated: terminated.map((entry) => [entry.id, entry.body, entry.status]),
        activeSharedId: active.find((entry) => entry.id === 'm2')?.body,
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
