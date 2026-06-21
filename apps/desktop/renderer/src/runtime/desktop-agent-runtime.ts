import { buildDelegationContext } from '@/data/employee-persona.js';
import { ensureProjectBoundForRun } from '@/runtime/ensure-default-workspace.js';
import { agentRunEvent, llmStreamChunk, toolExecutionTelemetry } from '@offisim/core/browser';
import type { RuntimeRepositories } from '@offisim/core/browser';
import type {
  AgentRunEvent,
  AgentRunFinishedPayload,
  AgentRunStartedPayload,
  RuntimeEvent,
} from '@offisim/shared-types';
import { Channel, invoke } from '@tauri-apps/api/core';
import { readPiModelOverride } from './pi-agent-config.js';
import { resolveThreadMode } from './pi-thread-mode-store.js';
import { resolveThreadThinkingOverride } from './pi-thread-thinking-store.js';
import { getRepos, runtimeEventBus } from './repos.js';

export interface DesktopAgentRunInput {
  text: string;
  threadId: string;
  employeeId: string | null;
  projectId: string | null;
  /** Controller-owned run id used to isolate stream/tool/UI events per attempt. */
  runId?: string;
  /**
   * Per-turn Pi registry model id (provider/model). When omitted the runtime
   * falls back to the global Settings override, then to Pi's default. Pi still
   * resolves credentials and the real catalog; this only forwards the id.
   */
  model?: string;
  /**
   * Per-conversation permission mode (`plan` / `ask` / `auto` / `full`). When
   * omitted the runtime resolves the thread's stored mode (default `auto`). The
   * host enforces it as Pi tool gating; this only forwards the string.
   */
  permissionMode?: string;
  /**
   * Per-conversation thinking level / reasoning effort (`off` / `minimal` /
   * `low` / `medium` / `high` / `xhigh`). When omitted the runtime forwards the
   * thread's explicit override if one was set, else nothing — so Pi applies its
   * own default/session level. A generic agent capability — the host clamps it to
   * the model's reasoning capabilities; this only forwards the string.
   */
  thinkingLevel?: string;
}

export interface DesktopAgentRunResult {
  text: string;
  reasoning?: string;
}

export interface PiAgentModelSummary {
  provider?: string;
  id?: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
}

interface PiAgentHostResponse {
  text: string;
  reasoning?: string;
  sessionId?: string;
  sessionFile?: string;
  model?: PiAgentModelSummary;
}

type PiAgentHostEvent =
  | {
      kind: 'started';
      sessionId?: string;
      sessionFile?: string;
      model?: PiAgentModelSummary;
      modelFallbackMessage?: string;
    }
  | { kind: 'messageDelta'; delta: string; channel?: 'content' | 'reasoning' }
  | { kind: 'messageEnd'; text: string; stopReason?: string; errorMessage?: string }
  | {
      kind: 'tool';
      status: 'started' | 'running' | 'completed' | 'failed';
      toolCallId: string;
      toolName: string;
      detail?: string;
      durationMs?: number;
    }
  | {
      kind: 'uiRequest';
      id: string;
      method: string;
      title: string;
      message?: string;
      options?: string[];
      placeholder?: string;
      prefill?: string;
    }
  | {
      kind: 'agentRun';
      threadId: string;
      rootRunId: string;
      runId: string;
      parentRunId?: string;
      employeeId?: string;
      relation?: string;
      runType: string;
      payload: unknown;
    }
  | { kind: 'result'; response: PiAgentHostResponse }
  | { kind: 'error'; code: string; message: string };

// Wire-contract typecheck guard. These canonical events must stay assignable to
// PiAgentHostEvent; `satisfies` makes tsc fail here if the renderer union drifts
// from the camelCase wire contract shared with the Rust host (pi_agent_host.rs)
// and the Node emitter (scripts/pi-agent-host-wire.mjs). The runtime round-trip is
// gated by check:pi-wire-contract and the cargo fixture test.
export const PI_WIRE_CONTRACT_EXAMPLES = [
  { kind: 'started', sessionId: 's', sessionFile: '/f', modelFallbackMessage: 'm' },
  { kind: 'messageDelta', delta: 'x', channel: 'content' },
  { kind: 'messageDelta', delta: 'r', channel: 'reasoning' },
  { kind: 'messageEnd', text: 't', stopReason: 'end_turn', errorMessage: 'e' },
  {
    kind: 'tool',
    status: 'completed',
    toolCallId: 'c',
    toolName: 'bash',
    detail: 'd',
    durationMs: 1,
  },
  {
    kind: 'uiRequest',
    id: 'ui-1',
    method: 'confirm',
    title: 'Approve command?',
    message: 'force-push\n\ngit push --force',
  },
  {
    kind: 'agentRun',
    threadId: 'th',
    rootRunId: 'attempt-1',
    runId: 'run-1',
    parentRunId: 'attempt-1',
    employeeId: 'emp-1',
    relation: 'delegate',
    runType: 'run.started',
    payload: { objective: 'scout', access: 'read' },
  },
  { kind: 'result', response: { text: 't', reasoning: 'r', sessionId: 's', sessionFile: '/f' } },
  { kind: 'error', code: 'upstream', message: 'm' },
] satisfies PiAgentHostEvent[];

/** The user's answer to an `agent.ui.request`. `requestId` locates the paused run;
 *  `id` matches the specific prompt. `confirmed` answers a confirm, `value`
 *  answers select / input / editor, `cancelled` dismisses any of them. Generic so
 *  the UI never names a backend — each runtime maps it to its own transport. */
export interface AgentUiAnswer {
  requestId: string;
  id: string;
  confirmed?: boolean;
  value?: string;
  cancelled?: boolean;
}

export interface DesktopAgentRuntime {
  execute(input: DesktopAgentRunInput): Promise<DesktopAgentRunResult>;
  abort(threadId: string): void;
  /** Deliver the user's answer to a mid-run `agent.ui.request` back to the host. */
  answerUiRequest(answer: AgentUiAnswer): Promise<void>;
  dispose(): Promise<void>;
}

function newRequestId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Event name for the agent's mid-run "ask the user something" bridge — shared by
 *  the producer (here) and the ConversationRunController consumer so the two
 *  can't drift on a typo. Backend-neutral on purpose: any agent that pauses to
 *  prompt the user (Pi today via `ctx.ui`, others later) routes through this. */
export const AGENT_UI_REQUEST_EVENT = 'agent.ui.request';

/** Payload shape for the `agent.ui.request` renderer event. An agent paused
 *  mid-run and asked the user something (confirm / select / input / editor). The
 *  renderer needs `requestId` to route the answer back to the run's host and `id`
 *  to match the specific prompt. Mirrors a Pi extension-UI request, but the shape
 *  is generic so it isn't tied to any one backend. */
export interface AgentUiRequestPayload {
  requestId: string;
  runId: string;
  id: string;
  method: string;
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
}

/** Build an `agent.ui.request` RuntimeEvent inline (no core event factory — this
 *  is a renderer-only host→UI bridge). Matches the envelope shape the core
 *  factories return so `runtimeEventBus.emit` typechecks against RuntimeEvent. */
function agentUiRequestEvent(
  companyId: string,
  threadId: string,
  payload: AgentUiRequestPayload,
): RuntimeEvent<AgentUiRequestPayload> {
  return {
    type: AGENT_UI_REQUEST_EVENT,
    entityId: payload.id,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload,
  };
}

function piRunScope(
  projectId: string | null,
  threadId: string,
  employeeId: string | null,
  runId?: string,
) {
  return {
    conversationKey: `${projectId ?? ''}::${threadId}::${employeeId ?? ''}`,
    runId: runId || `pi-${crypto.randomUUID()}`,
    threadId,
  };
}

function toolStatus(status: PiAgentHostEvent & { kind: 'tool' }) {
  if (status.status === 'failed') return 'error' as const;
  if (status.status === 'completed') return 'completed' as const;
  return 'started' as const;
}

class DesktopPiAgentRuntime implements DesktopAgentRuntime {
  private readonly inFlightByThread = new Map<string, string>();
  // Serializes all agent_runs writes in event-arrival order. agentRun events
  // stream in order on the Channel, but each persist is async — chaining them
  // guarantees a child's run.started row is created before its run.completed
  // update (and the root row before any child), instead of racing as bare
  // fire-and-forget writes would. Each step self-guards, so one failure never
  // breaks the chain or the live run.
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly companyId: string,
    private readonly repos: RuntimeRepositories,
  ) {}

  private enqueuePersist(work: () => Promise<void>): void {
    this.persistQueue = this.persistQueue.then(work);
  }

  async execute(input: DesktopAgentRunInput): Promise<DesktopAgentRunResult> {
    const projectId = await ensureProjectBoundForRun(this.repos, this.companyId, input.projectId);
    const runScope = piRunScope(projectId, input.threadId, input.employeeId, input.runId);
    const requestId = newRequestId('pi-agent');
    const startedAtByTool = new Map<string, number>();
    let finalText = '';
    let reasoningText = '';
    let channelError: Error | null = null;
    const onEvent = new Channel<PiAgentHostEvent>();
    onEvent.onmessage = (event) => {
      if (event.kind === 'messageDelta' && event.delta) {
        const channel = event.channel === 'reasoning' ? 'reasoning' : 'content';
        if (channel === 'reasoning') {
          reasoningText += event.delta;
        }
        runtimeEventBus.emit(
          llmStreamChunk(
            this.companyId,
            input.threadId,
            'pi_agent',
            event.delta,
            channel,
            runScope,
          ),
        );
        return;
      }
      if (event.kind === 'messageEnd' && event.text) {
        finalText = event.text;
        return;
      }
      if (event.kind === 'tool') {
        const startedAt = startedAtByTool.get(event.toolCallId) ?? Date.now();
        if (event.status === 'started') {
          startedAtByTool.set(event.toolCallId, startedAt);
        }
        const completedAt =
          event.status === 'completed' || event.status === 'failed' ? Date.now() : undefined;
        runtimeEventBus.emit(
          toolExecutionTelemetry(this.companyId, input.threadId, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            toolType: 'builtin',
            evidenceClass: 'sdk-native',
            threadId: input.threadId,
            nodeName: 'pi_agent',
            employeeId: input.employeeId ?? undefined,
            startedAt,
            completedAt,
            durationMs:
              event.durationMs ?? (completedAt ? Math.max(0, completedAt - startedAt) : undefined),
            status: toolStatus(event),
            errorType: event.status === 'failed' ? (event.detail ?? 'pi_tool_failed') : undefined,
            chatConversationKey: runScope.conversationKey,
            chatRunId: runScope.runId,
          }),
        );
        return;
      }
      if (event.kind === 'uiRequest') {
        // The agent paused mid-run to ask the user something (Ask mode). Surface
        // it to the UI carrying this run's requestId so the approval bar can
        // answer it back through pi_agent_ui_response.
        runtimeEventBus.emit(
          agentUiRequestEvent(this.companyId, input.threadId, {
            requestId,
            runId: runScope.runId,
            id: event.id,
            method: event.method,
            title: event.title,
            message: event.message,
            options: event.options,
            placeholder: event.placeholder,
            prefill: event.prefill,
          }),
        );
        return;
      }
      if (event.kind === 'agentRun') {
        // A delegation run-tree event. Rebuild the neutral AgentRunEvent, fan it
        // onto the bus (run-tree projection + chat/office consume it), and persist
        // the run's start/finish to agent_runs.
        const agentEvt = {
          threadId: event.threadId,
          rootRunId: event.rootRunId,
          runId: event.runId,
          ...(event.parentRunId ? { parentRunId: event.parentRunId } : {}),
          ...(event.employeeId ? { employeeId: event.employeeId } : {}),
          ...(event.relation ? { relation: event.relation } : {}),
          type: event.runType,
          payload: event.payload,
        } as AgentRunEvent;
        runtimeEventBus.emit(agentRunEvent(this.companyId, agentEvt));
        this.enqueuePersist(() => this.persistAgentRun(agentEvt));
        return;
      }
      if (event.kind === 'result') {
        finalText = event.response.text || finalText;
        return;
      }
      if (event.kind === 'error') {
        channelError = new Error(event.message);
      }
    };

    // Resolve, in one DB pass, the acting employee's persona (forwarded as Pi's
    // `appendSystemPrompt` — a generic agent capability, an extra system prompt)
    // plus the delegation roster (the teammates this root agent may delegate to).
    // Both are built renderer-side (we own the employee repo) and forwarded
    // verbatim. A failure must never fail the run, so it degrades to no persona
    // addendum + no delegation.
    const { systemPromptAppend, roster } = await buildDelegationContext(
      this.repos,
      this.companyId,
      input.employeeId,
    ).catch(() => ({ systemPromptAppend: null, roster: [] }));

    // When delegation is possible (a non-empty roster), the root run gets its own
    // agent_runs row — it's the tree root, and child rows reference it via
    // parent_run_id (FK). Created before the invoke so it commits ahead of any
    // child's run.started write on the serialized persist chain.
    const delegationRoot = roster.length > 0;
    if (delegationRoot) {
      this.enqueuePersist(() => this.createRootRun(runScope.runId, input));
    }

    this.inFlightByThread.set(input.threadId, requestId);
    try {
      const commandResponse = (await invoke('pi_agent_execute', {
        req: {
          requestId,
          text: input.text,
          companyId: this.companyId,
          threadId: input.threadId,
          projectId,
          employeeId: input.employeeId,
          model: input.model?.trim() || readPiModelOverride() || undefined,
          permissionMode: input.permissionMode?.trim() || resolveThreadMode(input.threadId),
          // Like `model`: forward only an explicit override, else `undefined` so
          // the host omits it and Pi resolves its own default/session level
          // rather than Offisim pinning every run to `medium`.
          thinkingLevel:
            input.thinkingLevel?.trim() || resolveThreadThinkingOverride(input.threadId),
          systemPromptAppend: systemPromptAppend ?? undefined,
          // Delegation scope: the root run id lets the host stamp child agentRun
          // events; the roster tells it who can be delegated to. Empty roster →
          // the host registers no delegate tool.
          rootRunId: runScope.runId,
          roster,
        },
        onEvent,
      })) as PiAgentHostResponse;
      if (commandResponse.reasoning && !reasoningText.trim()) {
        runtimeEventBus.emit(
          llmStreamChunk(
            this.companyId,
            input.threadId,
            'pi_agent',
            commandResponse.reasoning,
            'reasoning',
            runScope,
          ),
        );
      }
      finalText = commandResponse.text || finalText;
      if (channelError) throw channelError;
      const reasoning = (commandResponse.reasoning || reasoningText).trim();
      if (delegationRoot) {
        this.enqueuePersist(() => this.finalizeRootRun(runScope.runId, 'completed'));
      }
      return { text: finalText, ...(reasoning ? { reasoning } : {}) };
    } catch (err) {
      if (delegationRoot) {
        this.enqueuePersist(() => this.finalizeRootRun(runScope.runId, 'failed'));
      }
      throw err;
    } finally {
      if (this.inFlightByThread.get(input.threadId) === requestId) {
        this.inFlightByThread.delete(input.threadId);
      }
    }
  }

  /** Create the root run's agent_runs row — the delegation tree root that child
   *  rows reference via parent_run_id. Self-guarding. */
  private async createRootRun(rootRunId: string, input: DesktopAgentRunInput): Promise<void> {
    const repo = this.repos.agentRuns;
    if (!repo) return;
    try {
      await repo.create({
        run_id: rootRunId,
        thread_id: input.threadId,
        company_id: this.companyId,
        parent_run_id: null,
        root_run_id: rootRunId,
        employee_id: input.employeeId,
        relation: null,
        objective: null,
        access: null,
        status: 'running',
      });
    } catch (err) {
      console.warn('[desktop-agent-runtime] create root agent_run failed', { rootRunId, err });
    }
  }

  /** Mark the root run terminal and reconcile any child left in `running` — the
   *  case where a root abort killed the host before a child's terminal event
   *  could be emitted (full abort-tree propagation lands in Phase 2). On a normal
   *  finish every child is already terminal, so the reconciliation is a no-op. */
  private async finalizeRootRun(
    rootRunId: string,
    status: 'completed' | 'failed' | 'cancelled',
  ): Promise<void> {
    const repo = this.repos.agentRuns;
    if (!repo) return;
    const finishedAt = new Date().toISOString();
    try {
      const children = await repo.findByRoot(rootRunId);
      // Roll the whole subtree's usage up into the root record, and reconcile any
      // child left `running` — the case where a root abort killed the host before
      // a child's terminal event (full abort-tree propagation rides the in-process
      // host kill; here we just keep the DB honest).
      const agg = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
      const dangling: string[] = [];
      for (const child of children) {
        if (child.run_id === rootRunId) continue;
        if (child.usage_json) {
          try {
            const u = JSON.parse(child.usage_json) as Partial<typeof agg>;
            agg.input += u.input ?? 0;
            agg.output += u.output ?? 0;
            agg.cacheRead += u.cacheRead ?? 0;
            agg.cacheWrite += u.cacheWrite ?? 0;
            agg.cost += u.cost ?? 0;
            agg.turns += u.turns ?? 0;
          } catch {
            /* ignore a malformed usage blob */
          }
        }
        if (child.status === 'running') dangling.push(child.run_id);
      }
      const usageJson =
        agg.input || agg.output || agg.cost || agg.turns ? JSON.stringify(agg) : null;
      await Promise.all([
        repo.updateStatus(rootRunId, status, { finishedAt, usageJson }),
        ...dangling.map((id) => repo.updateStatus(id, 'cancelled', { finishedAt })),
      ]);
    } catch (err) {
      console.warn('[desktop-agent-runtime] finalize root agent_run failed', { rootRunId, err });
    }
  }

  /** Persist a delegation run's lifecycle to agent_runs. Runs on the serialized
   *  persist chain — a DB write failure logs but never breaks the live run. Only
   *  the start/finish events carry persistable state; tool/delta events stay
   *  transient. */
  private async persistAgentRun(evt: AgentRunEvent): Promise<void> {
    const repo = this.repos.agentRuns;
    if (!repo) return;
    try {
      if (evt.type === 'run.started') {
        const payload = evt.payload as AgentRunStartedPayload;
        await repo.create({
          run_id: evt.runId,
          thread_id: evt.threadId,
          company_id: this.companyId,
          parent_run_id: evt.parentRunId ?? null,
          root_run_id: evt.rootRunId,
          employee_id: evt.employeeId ?? null,
          relation: evt.relation ?? null,
          objective: payload.objective ?? null,
          access: payload.access ?? null,
          status: 'running',
        });
      } else if (
        evt.type === 'run.completed' ||
        evt.type === 'run.failed' ||
        evt.type === 'run.cancelled'
      ) {
        const payload = evt.payload as AgentRunFinishedPayload;
        await repo.updateStatus(evt.runId, payload.status, {
          resultSummaryJson: payload.summary ? JSON.stringify({ summary: payload.summary }) : null,
          usageJson: payload.usage ? JSON.stringify(payload.usage) : null,
          finishedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn('[desktop-agent-runtime] persist agent_run failed', { runId: evt.runId, err });
    }
  }

  abort(threadId: string): void {
    const requestId = this.inFlightByThread.get(threadId);
    if (!requestId) return;
    void invoke('pi_agent_abort', { requestId }).catch((err: unknown) => {
      console.warn('[desktop-agent-runtime] Pi abort failed', { threadId, err });
    });
  }

  async answerUiRequest(answer: AgentUiAnswer): Promise<void> {
    await invoke('pi_agent_ui_response', {
      requestId: answer.requestId,
      id: answer.id,
      confirmed: answer.confirmed,
      value: answer.value,
      cancelled: answer.cancelled,
    });
  }

  async dispose(): Promise<void> {
    for (const requestId of this.inFlightByThread.values()) {
      await invoke('pi_agent_abort', { requestId }).catch(() => undefined);
    }
    this.inFlightByThread.clear();
  }
}

const runtimeCache = new Map<string, Promise<DesktopAgentRuntime>>();

async function assembleRuntime(companyId: string): Promise<DesktopAgentRuntime> {
  const repos = await getRepos();
  for (const required of ['threads', 'chatThreads', 'projects'] as const) {
    if (!repos[required]) {
      throw new Error(`Cannot start Pi Agent runtime: repos.${required} is unavailable.`);
    }
  }
  return new DesktopPiAgentRuntime(companyId, repos);
}

export function getDesktopAgentRuntime(companyId: string): Promise<DesktopAgentRuntime> {
  const cached = runtimeCache.get(companyId);
  if (cached) return cached;
  const promise = assembleRuntime(companyId).catch((err) => {
    runtimeCache.delete(companyId);
    throw err;
  });
  runtimeCache.set(companyId, promise);
  return promise;
}

export async function disposeDesktopAgentRuntime(companyId: string): Promise<void> {
  const cached = runtimeCache.get(companyId);
  if (!cached) return;
  runtimeCache.delete(companyId);
  try {
    const runtime = await cached;
    await runtime.dispose();
  } catch (err) {
    console.warn('[desktop-agent-runtime] dispose failed', { companyId, err });
  }
}
