import assert from 'node:assert/strict';
import type { RuntimeEvent } from '@offisim/shared-types';
import {
  ConversationRunAlreadyActiveError,
  type ConversationRunController,
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

  activeInteractions = {
    upsert: async (row: ActiveInteractionRow) => {
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
  }): void {
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
      created_at: '2026-06-20T00:00:00.000Z',
      updated_at: '2026-06-20T00:00:00.000Z',
    });
  }
}

function makeEnv(): HarnessEnv {
  const eventBus = new InMemoryEventBus();
  const runtime = new FakeRuntime(eventBus);
  const persisted: PersistCall[] = [];
  const appendedEvents: AppendEventCall[] = [];
  const repos = new FakeRepos();
  let now = Date.parse('2026-06-20T00:00:00.000Z');
  let uuid = 0;
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
    name: 'stop persists interrupted partial assistant checkpoint',
    criteria:
      'Pass when Stop aborts runtime, snapshot becomes interrupted, and the persisted assistant checkpoint is marked interrupted.',
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
      await waitFor(
        'interrupted run',
        () => env.controller.getSnapshot('thread-1').phase === 'interrupted',
      );
      assert.ok(env.persisted.some((call) => call.message.status === 'interrupted'));
      return {
        phase: env.controller.getSnapshot('thread-1').phase,
        interruptedPersisted: env.persisted.filter((call) => call.message.status === 'interrupted')
          .length,
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
        env.runtime.emitTool(input, 'started', 'tool-read', 'read_file');
        env.runtime.emitTool(input, 'completed', 'tool-read', 'read_file');
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
      return { activeCount: emp?.activeCount, activeRunIds: [...(emp?.activeRunIds ?? [])] };
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
      await waitFor('b completed', () => env.controller.getSnapshot('thread-b').phase === 'completed');
      const attemptA = env.controller.getSnapshot('thread-a').attemptId;
      const workloads = projectEmployeeWorkloads(env.controller.getGlobalSnapshot(), 'prj');
      const emp = workloads.get('emp-1');
      assert.equal(emp?.activeCount, 1);
      assert.equal(emp?.dominant?.state, 'working');
      assert.equal(emp?.dominant?.runId, attemptA);
      return { activeCount: emp?.activeCount, dominantRunId: emp?.dominant?.runId, attemptA };
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
