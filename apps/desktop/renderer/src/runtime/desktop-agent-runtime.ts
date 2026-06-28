import { buildDelegationContext, buildMcpScope } from '@/data/employee-persona.js';
import { ensureProjectBoundForRun } from '@/runtime/ensure-default-workspace.js';
import { agentRunEvent, llmStreamChunk, toolExecutionTelemetry } from '@offisim/core/browser';
import type { RuntimeRepositories } from '@offisim/core/browser';
import type {
  AgentRunArtifactPayload,
  AgentRunEvent,
  AgentRunFinishedPayload,
  AgentRunStartedPayload,
  AgentRunUsage,
  RuntimeEvent,
} from '@offisim/shared-types';
import { Channel, invoke } from '@tauri-apps/api/core';
import {
  MISSION_EVALUATION_SUBMITTED_EVENT,
  type MissionEvaluationSubmittedPayload,
} from './mission/mission-events.js';
import { readPiModelOverride } from './pi-agent-config.js';
import type { PiAgentHostEvent, PiAgentHostResponse } from './pi-runtime-driver.js';
import { persistRunStartIfAbsent } from './recovery/persist-run-idempotency.js';
import { aggregateSubtreeUsage } from './recovery/usage-aggregation.js';

// Re-export the mission-bridge event vocabulary so existing importers of
// desktop-agent-runtime keep working; the canonical definition lives in
// mission/mission-events.ts (tauri-free, harness-importable).
export { MISSION_EVALUATION_SUBMITTED_EVENT };
export type { MissionEvaluationSubmittedPayload };
import { resolveThreadMode } from './pi-thread-mode-store.js';
import { resolveThreadThinkingOverride } from './pi-thread-thinking-store.js';
import { getRepos, runtimeEventBus } from './repos.js';

/**
 * Frozen, additive capability profile for the agent runtime request (PR-03).
 * `'work'` (default) is the existing execute path — byte-for-byte unchanged when
 * the field is absent. `'collaboration'` routes to the HOST-ENFORCED no-tools /
 * no-workspace / no-persistence streaming path (daily company chat). `'enhance'`
 * stays its own dedicated one-shot Tauri command (PR-06), not a value here, and
 * `'loop_compile'` is reserved for PR-07. Shaped so future profiles only ADD a
 * branch; the work execute path never reads it.
 */
export type AgentCapabilityProfile = 'work' | 'collaboration';

export interface DesktopAgentRunInput {
  text: string;
  threadId: string;
  employeeId: string | null;
  projectId: string | null;
  /**
   * Frozen capability enum (PR-03). Absent / `'work'` = the existing work execute
   * path, unchanged. `'collaboration'` is NOT served through this `execute()` —
   * the collaboration transport (runtime/collaboration) invokes the dedicated
   * `agent_runtime_collaborate` command instead, so a work run can never silently
   * acquire the collaboration profile and vice-versa. Carried on the input type so
   * the wire contract is frozen in one place.
   */
  capabilityProfile?: AgentCapabilityProfile;
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
  /**
   * Verified Missions scope (MS-005). When the renderer's MissionRunController
   * runs a mission attempt it sets these so the host registers the mission-bridge
   * tools (`submit_for_evaluation` / `query_mission_state`) and the agent's prompt
   * carries the goal/criteria. `missionContextJson` is the minimal context packet
   * the host forwards to the bridge; `missionId` / `attemptId` are carried for
   * symmetry + future Rust-side use. Absent on a plain chat — existing behavior
   * is unchanged when no missionId is present. `runId` IS the attempt's run id
   * (rootRunId), which is how the runtime correlates the agent's
   * submit_for_evaluation events back to the attempt.
   */
  missionId?: string;
  attemptId?: string;
  missionContextJson?: string;
}

export interface DesktopAgentRunResult {
  text: string;
  reasoning?: string;
  /**
   * The root session's own token usage for this run, when the host reported it.
   * Surfaced on the return (not only folded into the `agent_runs` row by
   * `reconcileRoot`) so a synchronous caller — e.g. the Mission loop's token
   * budget (§19.2) — can debit deterministically without racing the persist
   * queue. Absent when the run threw before returning usage.
   */
  usage?: AgentRunUsage;
}

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
  resume(runId: string): Promise<DesktopAgentRunResult>;
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

/** Build a `mission.evaluation.submitted` RuntimeEvent inline (renderer-only
 *  host→controller bridge — no core factory), mirroring agentUiRequestEvent. */
function missionEvaluationSubmittedEvent(
  companyId: string,
  threadId: string,
  payload: MissionEvaluationSubmittedPayload,
): RuntimeEvent<MissionEvaluationSubmittedPayload> {
  return {
    type: MISSION_EVALUATION_SUBMITTED_EVENT,
    entityId: payload.criterionId,
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
  // Request ids the user aborted. A Rust-side abort kills the host and resolves
  // the invoke with empty text (not an error), so execute() consults this to
  // classify the root run's terminal as cancelled rather than completed/failed.
  private readonly abortedRequests = new Set<string>();
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
    return this.runPiTurn(input, 'agent_runtime_execute');
  }

  async resume(runId: string): Promise<DesktopAgentRunResult> {
    const repo = this.repos.agentRuns;
    if (!repo) throw new Error('Cannot resume Pi Agent run: agentRuns repo is unavailable.');
    const row = await repo.findById(runId);
    if (!row || row.company_id !== this.companyId) {
      throw new Error('Cannot resume Pi Agent run: run not found for this company.');
    }
    if (row.status !== 'interrupted') {
      throw new Error(`Cannot resume Pi Agent run: expected interrupted, got ${row.status}.`);
    }
    await repo.updateStatus(runId, 'running', { finishedAt: null });
    return this.runPiTurn(
      {
        text: `Continue the interrupted task from its saved Pi session.\n\nOriginal objective:\n${
          row.objective || 'Untitled run'
        }`,
        threadId: row.thread_id,
        employeeId: row.employee_id,
        projectId: null,
        runId: row.run_id,
        permissionMode: row.access === 'read' ? 'plan' : undefined,
      },
      'agent_runtime_resume',
    );
  }

  private async runPiTurn(
    input: DesktopAgentRunInput,
    commandName: 'agent_runtime_execute' | 'agent_runtime_resume',
  ): Promise<DesktopAgentRunResult> {
    const projectId = await ensureProjectBoundForRun(this.repos, this.companyId, input.projectId);
    const runScope = piRunScope(projectId, input.threadId, input.employeeId, input.runId);
    const requestId = newRequestId('pi-agent');
    const startedAtByTool = new Map<string, number>();
    let finalText = '';
    let reasoningText = '';
    let channelError: Error | null = null;

    // The renderer is the AgentRunEventNormalizer for the ROOT run: it already
    // sees every root fact as a legacy wire line (tool / uiRequest / result /
    // error), so it synthesizes the root's neutral agent.run stream here — the
    // SAME contract child runs arrive on from the host supervisor. The root's
    // runId IS its rootRunId and it has no parent/relation. Every user run gets
    // this stream (not only delegating ones), so a plain dev task drives the
    // office dramaturgy + run projection just like delegated work.
    const permissionMode = input.permissionMode?.trim() || resolveThreadMode(input.threadId);
    const rootAccess: 'read' | 'write' = permissionMode === 'plan' ? 'read' : 'write';
    const rootRun = (
      type: AgentRunEvent['type'],
      payload: AgentRunEvent['payload'],
    ): AgentRunEvent =>
      ({
        threadId: input.threadId,
        rootRunId: runScope.runId,
        runId: runScope.runId,
        ...(input.employeeId ? { employeeId: input.employeeId } : {}),
        type,
        payload,
      }) as AgentRunEvent;
    const emitRootBus = (evt: AgentRunEvent): void => {
      runtimeEventBus.emit(agentRunEvent(this.companyId, evt));
    };

    const onEvent = new Channel<PiAgentHostEvent>();
    onEvent.onmessage = (event) => {
      if (event.kind === 'started') {
        if (event.sessionFile) {
          this.enqueuePersist(() =>
            this.repos.agentRuns?.updateStatus(runScope.runId, 'running', {
              sessionFile: event.sessionFile,
            }) ?? Promise.resolve(),
          );
        }
        return;
      }
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
        // Normalize the root's tool call onto the run stream (started → completed;
        // the transient `running` update has no agentRun counterpart).
        if (event.status === 'started') {
          emitRootBus(
            rootRun('tool.started', {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              status: 'started',
            }),
          );
        } else if (event.status === 'completed' || event.status === 'failed') {
          emitRootBus(
            rootRun('tool.completed', {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              status: event.status,
            }),
          );
        }
        return;
      }
      if (event.kind === 'uiRequest') {
        // The agent paused mid-run to ask the user something (Ask mode). Surface
        // it to the UI carrying this run's requestId so the approval bar can
        // answer it back through agent_runtime_answer.
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
        // A confirm prompt is an approval request — surface it on the run stream
        // so the office stages an approval beat (same contract as a child's).
        if (event.method === 'confirm') {
          emitRootBus(
            rootRun('approval.requested', {
              uiRequestId: event.id,
              title: event.title,
              message: event.message,
            }),
          );
        }
        return;
      }
      if (event.kind === 'agentRun') {
        if (event.runType === 'mcp.tool.called') {
          this.enqueuePersist(() => this.persistMcpToolCall(event, input.employeeId));
          return;
        }
        // Mission-bridge signals (MS-005) ride the same `agentRun` wire kind but
        // are NOT run-tree dramaturgy events — they are verification signals for
        // the MissionRunController, not the AgentRunEvent union. Intercept them
        // here and fan them onto the bus on their own channel; never persist them
        // as agent_runs and never feed them to the office projection. The
        // deterministic evaluator over the real workspace is still the truth (§5)
        // — this is only the agent saying "criterion ready".
        if (event.runType === 'evaluation_submitted') {
          const p = (event.payload ?? {}) as {
            criterionId?: string;
            summary?: string;
            evidenceRefs?: string[];
          };
          if (typeof p.criterionId === 'string' && p.criterionId.trim()) {
            runtimeEventBus.emit(
              missionEvaluationSubmittedEvent(this.companyId, event.threadId, {
                runId: event.runId,
                rootRunId: event.rootRunId,
                criterionId: p.criterionId,
                summary: typeof p.summary === 'string' ? p.summary : '',
                evidenceRefs: Array.isArray(p.evidenceRefs)
                  ? p.evidenceRefs.filter((r): r is string => typeof r === 'string')
                  : [],
              }),
            );
          }
          return;
        }
        if (event.runType === 'mission_state_query') {
          // A read-only audit ping; nothing to persist or project. The host
          // already returned the context to the agent synchronously.
          return;
        }
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
          ...(event.workKind ? { workKind: event.workKind } : {}),
          type: event.runType,
          payload: event.payload,
        } as AgentRunEvent;
        if (event.runType === 'artifact.created') {
          // An artifact-publish event: persist the deliverable row FIRST, then emit
          // the bus event — so the Outputs refetch only fires after the row exists.
          // (persistArtifact reads + hashes the file and inserts; it emits the bus
          // event itself on a successful insert.)
          this.enqueuePersist(() => this.persistArtifact(agentEvt, projectId));
        } else {
          runtimeEventBus.emit(agentRunEvent(this.companyId, agentEvt));
          this.enqueuePersist(() => this.persistAgentRun(agentEvt));
        }
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
    const mcpTools = await buildMcpScope(
      this.repos,
      this.companyId,
      input.employeeId,
      projectId,
    ).catch(() => []);

    // Open the root run on the stream + persist its row BEFORE the invoke, so it
    // commits ahead of any child's run.started write on the serialized persist
    // chain (children reference it via parent_run_id FK). Unconditional: every
    // run is a tree root, delegating or not.
    const startedEvt = rootRun('run.started', { objective: input.text, access: rootAccess });
    emitRootBus(startedEvt);
    this.enqueuePersist(() => this.persistAgentRun(startedEvt));

    this.inFlightByThread.set(input.threadId, requestId);
    try {
      const commandResponse = (await invoke(commandName, {
        req: {
          requestId,
          text: input.text,
          companyId: this.companyId,
          threadId: input.threadId,
          projectId,
          employeeId: input.employeeId,
          model: input.model?.trim() || readPiModelOverride() || undefined,
          permissionMode,
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
          // Mission scope (MS-005): present only on a mission attempt. When set,
          // the host registers the mission-bridge tools; the bridge's events ride
          // this run's rootRunId so the MissionRunController correlates them to the
          // attempt. Undefined on a plain chat — host registers no mission bridge.
          missionContextJson: input.missionContextJson?.trim() || undefined,
          mcpTools,
        },
        onEvent,
      })) as PiAgentHostResponse;
      // Root session's own usage — folded into the root agent_runs row by
      // reconcileRoot (children come from their own rows). Only in scope in this
      // try-branch; the catch branch's invoke threw before returning.
      const rootUsage = commandResponse.usage;
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
      // A Rust abort resolves the invoke with empty text (not an error), so
      // classify the terminal from the aborted-set: cancelled, not completed.
      if (this.abortedRequests.has(requestId)) {
        emitRootBus(rootRun('run.cancelled', { status: 'cancelled' }));
        this.enqueuePersist(() => this.reconcileRoot(runScope.runId, 'cancelled', rootUsage));
      } else {
        emitRootBus(
          rootRun('run.completed', {
            status: 'completed',
            ...(finalText ? { summary: finalText } : {}),
            ...(rootUsage ? { usage: rootUsage } : {}),
          }),
        );
        this.enqueuePersist(() => this.reconcileRoot(runScope.runId, 'completed', rootUsage));
      }
      return {
        text: finalText,
        ...(reasoning ? { reasoning } : {}),
        ...(rootUsage ? { usage: rootUsage } : {}),
      };
    } catch (err) {
      // A thrown invoke / channel error is a failure unless the user aborted —
      // abort wins (it can surface as a throw on some teardown paths).
      const aborted = this.abortedRequests.has(requestId);
      const status = aborted ? 'cancelled' : 'failed';
      const message = err instanceof Error ? err.message : String(err);
      emitRootBus(rootRun(aborted ? 'run.cancelled' : 'run.failed', { status, summary: message }));
      // rootUsage isn't in scope here — the invoke threw before returning it, so
      // there is no root usage to fold in. reconcileRoot still sums any children.
      this.enqueuePersist(() => this.reconcileRoot(runScope.runId, status, undefined));
      throw err;
    } finally {
      this.abortedRequests.delete(requestId);
      if (this.inFlightByThread.get(input.threadId) === requestId) {
        this.inFlightByThread.delete(input.threadId);
      }
    }
  }

  /** Mark the root run terminal and reconcile any child left in `running` — the
   *  case where a root abort killed the host before a child's terminal event
   *  could be emitted. Also rolls the subtree's usage up into the root record.
   *  On a normal finish every child is already terminal, so the reconciliation is
   *  a no-op. The root row itself was opened by the synthesized run.started. */
  private async reconcileRoot(
    rootRunId: string,
    status: 'completed' | 'failed' | 'cancelled',
    rootUsage?: AgentRunUsage,
  ): Promise<void> {
    const repo = this.repos.agentRuns;
    if (!repo) return;
    const finishedAt = new Date().toISOString();
    try {
      const children = await repo.findByRoot(rootRunId);
      // Roll the whole subtree's usage up into the root record, and reconcile any
      // child left `running` — the case where a root abort killed the host before
      // a child's terminal event (full abort-tree propagation rides the in-process
      // host kill; here we just keep the DB honest). The root's OWN usage comes
      // from the param (persistAgentRun doesn't write the root's terminal event),
      // so children + root sum with no double-count. Shared with the startup
      // interrupted-run reconciler (DR-003).
      const { usageJson, dangling } = aggregateSubtreeUsage(children, rootRunId, rootUsage);
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
        // Insert-if-absent: a resume replays run.started for an existing run; the
        // existing row (already flipped interrupted→running with partial usage by
        // the resume lane) must be left untouched, not re-created or clobbered.
        await persistRunStartIfAbsent(repo, {
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

  /** Persist an `artifact.created` run event as a deliverable row, then emit the
   *  bus event so the Outputs panel refetches AFTER the row is committed. The
   *  agent published a workspace-relative path; we read it through the SAME
   *  sandboxed Tauri command the file browser uses (`project_read_file`), so an
   *  out-of-workspace path is rejected by Rust and no row is written (VM-002
   *  acceptance-(c)). Runs on the serialized persist chain; never throws — a
   *  failure logs and the row is simply skipped (mirrors persistAgentRun). */
  private async persistArtifact(evt: AgentRunEvent, projectId: string | null): Promise<void> {
    const payload = evt.payload as AgentRunArtifactPayload;
    const path = payload.path?.trim();
    const deliverableId = payload.deliverableId?.trim();
    if (!path || !deliverableId) {
      console.warn(
        '[desktop-agent-runtime] artifact.created missing path/deliverableId — skipped',
        {
          runId: evt.runId,
        },
      );
      return;
    }
    // Read the file through the sandboxed workspace command. A workspace-jail
    // violation or a missing file rejects here → no row, no bus event.
    let content: string;
    try {
      content = (await invoke('project_read_file', { path, projectId })) as string;
    } catch (err) {
      console.warn(
        '[desktop-agent-runtime] artifact.created path unreadable (out-of-workspace or missing) — no deliverable written',
        { path, err },
      );
      return;
    }
    // Hex sha256 of the content for provenance.
    let hash: string;
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
      hash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (err) {
      console.warn('[desktop-agent-runtime] artifact hash failed', { path, err });
      return;
    }
    const repo = this.repos.deliverables;
    if (!repo) {
      console.warn(
        '[desktop-agent-runtime] deliverables repo unavailable — artifact not persisted',
      );
      return;
    }
    const basename = path.split(/[\\/]/).pop() || path;
    try {
      await repo.insert({
        deliverable_id: deliverableId,
        company_id: this.companyId,
        thread_id: null,
        chat_thread_id: evt.threadId,
        title: payload.title,
        content,
        kind: payload.kind === 'file' ? 'file' : 'document',
        file_name: basename,
        mime_type: payload.mimeType ?? null,
        contributors_json: '[]',
        created_at: new Date().toISOString(),
        run_id: evt.runId,
        content_hash: hash,
        version: 1,
      });
    } catch (err) {
      console.warn('[desktop-agent-runtime] persist artifact failed', {
        runId: evt.runId,
        deliverableId,
        err,
      });
      return;
    }
    // Row committed — now fan the run event onto the bus so the Outputs refetch
    // (useDeliverableRefresh) sees artifact.created with the row already present.
    runtimeEventBus.emit(agentRunEvent(this.companyId, evt));
  }

  private async persistMcpToolCall(
    event: Extract<PiAgentHostEvent, { kind: 'agentRun' }>,
    fallbackEmployeeId: string | null,
  ): Promise<void> {
    const payload = (event.payload ?? {}) as {
      server?: unknown;
      tool?: unknown;
      arguments?: unknown;
      result?: unknown;
      isError?: unknown;
      error?: unknown;
      latencyMs?: unknown;
      write?: unknown;
      approved?: unknown;
    };
    const server = typeof payload.server === 'string' ? payload.server : '';
    const tool = typeof payload.tool === 'string' ? payload.tool : '';
    if (!server || !tool) return;
    const employeeId = event.employeeId ?? fallbackEmployeeId ?? 'unknown';
    const createdAt = new Date().toISOString();
    const isError = payload.isError === true;
    try {
      await this.repos.mcpAudit.create({
        audit_id: crypto.randomUUID(),
        thread_id: event.threadId,
        task_run_id: null,
        employee_id: employeeId,
        server_name: server,
        tool_name: tool,
        arguments_json: JSON.stringify(payload.arguments ?? {}),
        result_json: JSON.stringify(payload.result ?? null),
        error:
          typeof payload.error === 'string'
            ? payload.error
            : isError
              ? 'mcp tool returned isError'
              : null,
        latency_ms: typeof payload.latencyMs === 'number' ? Math.max(0, payload.latencyMs) : 0,
        approved_by: payload.approved === true ? 'boss' : 'auto',
        created_at: createdAt,
      });
      if (payload.write === true && payload.approved === true) {
        await this.repos.toolPermissionApprovals.create({
          approval_id: crypto.randomUUID(),
          thread_id: event.threadId,
          company_id: this.companyId,
          employee_id: employeeId,
          server_name: server,
          tool_name: tool,
          scope: 'thread',
          approved_by: 'boss',
          policy_hash: `${server}:${tool}:write`,
          consumed_at: null,
          created_at: createdAt,
          expires_at: null,
        });
      }
    } catch (err) {
      console.warn('[desktop-agent-runtime] persist MCP audit failed', {
        server,
        tool,
        threadId: event.threadId,
        err,
      });
    }
  }

  abort(threadId: string): void {
    const requestId = this.inFlightByThread.get(threadId);
    if (!requestId) return;
    // Mark before invoking: a Rust abort resolves execute()'s invoke with empty
    // text, and the flag is how execute() knows to classify the terminal as
    // cancelled rather than completed.
    this.abortedRequests.add(requestId);
    void invoke('agent_runtime_abort', { requestId }).catch((err: unknown) => {
      console.warn('[desktop-agent-runtime] Pi abort failed', { threadId, err });
    });
  }

  async answerUiRequest(answer: AgentUiAnswer): Promise<void> {
    await invoke('agent_runtime_answer', {
      requestId: answer.requestId,
      id: answer.id,
      confirmed: answer.confirmed,
      value: answer.value,
      cancelled: answer.cancelled,
    });
  }

  async dispose(): Promise<void> {
    for (const requestId of this.inFlightByThread.values()) {
      await invoke('agent_runtime_abort', { requestId }).catch(() => undefined);
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
