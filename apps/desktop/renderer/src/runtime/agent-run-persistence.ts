import {
  assertPersistedChatMessageWithRepositories,
  loadPersistedChatMessageWithRepositories,
  persistChatMessageWithRepositories,
} from '@/data/chat-message-events.js';
import type { ChatMessage } from '@/data/types.js';
import { type TaskWorkspaceBindingClaim, invokeCommand } from '@/lib/tauri-commands.js';
import { agentRunEvent } from '@offisim/core/browser';
import type { AgentRunRow, RuntimeRepositories } from '@offisim/core/browser';
import type {
  AgentRunArtifactPayload,
  AgentRunEvent,
  AgentRunFinishedPayload,
  AgentRunStartedPayload,
  AgentRunUsage,
  RunFailureKind,
  WorkspaceDiagnosticsUpdatedPayload,
} from '@offisim/shared-types';
import { WORKSPACE_DIAGNOSTICS_UPDATED_EVENT } from '@offisim/shared-types';
import { AgentRunPersistenceQueue } from './agent-run-persistence-queue.js';
import type { LiveConversationTerminalPayload } from './desktop-agent-runtime.js';
import { EmployeeProjectMemoryDistillationQueue } from './employee-project-memory-distillation-queue.js';
import type { PiAgentHostEvent } from './pi-runtime-driver.js';
import { persistRunStartIfAbsent } from './recovery/persist-run-idempotency.js';
import { resolveAgentRunProjectId } from './recovery/reconcile-interrupted-runs.js';
import { aggregateSubtreeUsage } from './recovery/usage-aggregation.js';
import { runtimeEventBus } from './repos.js';
import {
  type PersistedRunContext,
  mergeRunContextPreservingNativeIdentity,
  normalizeStreamCursor,
  parseRunContext,
} from './run-context.js';
import { persistRunCostAndNotify } from './run-cost-refresh.js';

export class AgentRunPersistence extends AgentRunPersistenceQueue {
  constructor(
    private readonly companyId: string,
    private readonly repos: RuntimeRepositories,
    private readonly memoryDistillationQueue = new EmployeeProjectMemoryDistillationQueue(),
  ) {
    super();
  }

  async buildLiveConversationTerminalMessage(
    row: AgentRunRow,
    context: Partial<PersistedRunContext>,
    terminal: LiveConversationTerminalPayload | undefined,
  ): Promise<ChatMessage | null> {
    const projection = context.conversationProjection;
    if (!projection || !terminal) return null;
    const existing = await loadPersistedChatMessageWithRepositories({
      repos: this.repos,
      threadId: row.thread_id,
      messageId: projection.assistantMessageId,
    });
    const body = terminal.text.trim() || existing?.body.trim() || '';
    const reasoning = terminal.reasoning?.trim() || existing?.reasoning?.trim();
    const workspaceProvenance = context.workspaceProvenance ?? existing?.workspaceProvenance;
    if (!body && !reasoning && !workspaceProvenance && terminal.status !== 'completed') return null;
    const status =
      terminal.status === 'completed'
        ? ('complete' as const)
        : terminal.status === 'failed'
          ? ('failed' as const)
          : ('interrupted' as const);
    return {
      id: projection.assistantMessageId,
      threadId: row.thread_id,
      author: 'employee',
      employeeId: row.employee_id,
      body,
      ...(reasoning ? { reasoning } : {}),
      at: existing?.at ?? (Date.parse(context.createdAt ?? '') || Date.now()),
      replyToMessageId: projection.userMessageId,
      attemptId: row.run_id,
      status,
      ...(workspaceProvenance ? { workspaceProvenance } : {}),
    };
  }

  /** Mark the root run terminal and reconcile any child left in `running` — the
   *  case where a root abort killed the host before a child's terminal event
   *  could be emitted. Also rolls the subtree's usage up into the root record.
   *  On a normal finish every child is already terminal, so the reconciliation is
   *  a no-op. The root row itself was opened by the synthesized run.started. */
  async persistRootTerminal(
    rootRunId: string,
    status: 'completed' | 'failed' | 'cancelled',
    rootUsage?: AgentRunUsage,
    failureKind?: RunFailureKind,
    conversation?: {
      context: Partial<PersistedRunContext>;
      terminal: LiveConversationTerminalPayload;
      streamCursor?: number;
    },
  ): Promise<void> {
    const repo = this.repos.agentRuns;
    const finishedAt = new Date().toISOString();
    const children = await repo.findByRoot(rootRunId);
    // Roll the whole subtree's usage up into the root record, and reconcile any
    // child left `running` — the case where a root abort killed the host before
    // a child's terminal event (full abort-tree propagation rides the in-process
    // host kill; here we just keep the DB honest). The root's OWN usage comes
    // from the param (persistAgentRun doesn't write the root's terminal event),
    // so children + root sum with no double-count. Shared with the startup
    // interrupted-run reconciler (DR-003).
    const { usageJson, dangling } = aggregateSubtreeUsage(children, rootRunId, rootUsage);
    const root = children.find((run) => run.run_id === rootRunId);
    if (!root) {
      throw new Error(`Cannot finalize missing root agent_run ${rootRunId}.`);
    }
    const conversationMessage = conversation
      ? await this.buildLiveConversationTerminalMessage(
          root,
          conversation.context,
          conversation.terminal,
        )
      : null;
    const terminalCursor = normalizeStreamCursor(conversation?.streamCursor);
    const shouldPersistTerminalCursor = Boolean(
      conversation && terminalCursor > normalizeStreamCursor(conversation.context.streamCursor),
    );
    const terminalContext = conversation
      ? {
          ...conversation.context,
          ...(shouldPersistTerminalCursor ? { streamCursor: terminalCursor } : {}),
        }
      : null;
    await persistRunCostAndNotify({
      persist: async () => {
        let expectedTerminalContextJson: string | null = null;
        await this.repos.asyncTransact(async (transactionRepos) => {
          const tx = transactionRepos ?? this.repos;
          const current = await tx.agentRuns.findById(rootRunId);
          if (!current) throw new Error(`Cannot finalize missing root agent_run ${rootRunId}.`);
          const currentContext = parseRunContext(current.runtime_context_json);
          const competitiveDraft = currentContext?.competitiveDraft;
          const terminalContextJson = terminalContext
            ? JSON.stringify(
                mergeRunContextPreservingNativeIdentity(
                  current.runtime_context_json,
                  terminalContext,
                ),
              )
            : null;
          expectedTerminalContextJson = terminalContextJson;
          await Promise.all([
            tx.agentRuns.updateStatus(rootRunId, status, {
              finishedAt,
              usageJson,
              // The root's typed failure cause is only meaningful on a failed
              // terminal; completed/cancelled roots never write one.
              ...(status === 'failed' ? { failureKind: failureKind ?? null } : {}),
            }),
            ...dangling.map((id) => tx.agentRuns.updateStatus(id, 'cancelled', { finishedAt })),
            ...(terminalContextJson
              ? [tx.agentRuns.updateRuntimeContext(rootRunId, terminalContextJson)]
              : []),
            ...(conversationMessage
              ? [
                  persistChatMessageWithRepositories({
                    message: conversationMessage,
                    companyId: root.company_id,
                    projectId: resolveAgentRunProjectId(root),
                    repos: tx,
                  }),
                ]
              : []),
          ]);
          if (competitiveDraft) {
            const attempt = await tx.competitiveDraftAttempts.findById(competitiveDraft.attemptId);
            if (
              !attempt ||
              attempt.group_id !== competitiveDraft.groupId ||
              attempt.run_id !== rootRunId
            ) {
              throw new Error('Competitive draft terminal does not match its durable attempt.');
            }
            const attemptStatus =
              status === 'completed' ? 'ready' : status === 'failed' ? 'failed' : 'cancelled';
            const resultSummary = conversation?.terminal.text?.trim();
            await tx.competitiveDraftAttempts.update(competitiveDraft.attemptId, {
              status: attemptStatus,
              result_summary_json: resultSummary
                ? JSON.stringify({ summary: resultSummary })
                : null,
              usage_json: usageJson,
              finished_at: finishedAt,
            });
            const attempts = await tx.competitiveDraftAttempts.listByGroup(
              competitiveDraft.groupId,
            );
            const terminalAttempts = attempts.map((row) =>
              row.attempt_id === competitiveDraft.attemptId
                ? { ...row, status: attemptStatus }
                : row,
            );
            if (
              terminalAttempts.length > 0 &&
              terminalAttempts.every((row) => row.status !== 'planned' && row.status !== 'running')
            ) {
              const allFailed = terminalAttempts.every(
                (row) => row.status === 'failed' || row.status === 'cancelled',
              );
              await tx.competitiveDraftGroups.updateStatus(
                competitiveDraft.groupId,
                allFailed ? 'failed' : 'reviewing',
                { updatedAt: finishedAt },
              );
            }
          }
        });
        const readback = await this.repos.agentRuns.findById(rootRunId);
        if (
          !readback ||
          readback.status !== status ||
          (expectedTerminalContextJson &&
            readback.runtime_context_json !== expectedTerminalContextJson)
        ) {
          throw new Error('Root terminal durable readback did not match the committed checkpoint.');
        }
        if (conversationMessage) {
          await assertPersistedChatMessageWithRepositories({
            repos: this.repos,
            expected: conversationMessage,
            errorMessage:
              'Conversation terminal message durable readback did not match the committed checkpoint.',
          });
        }
      },
      eventSink: runtimeEventBus,
      companyId: this.companyId,
      threadId: root?.thread_id ?? '',
      runId: rootRunId,
    });
    if (shouldPersistTerminalCursor && conversation) {
      conversation.context.streamCursor = terminalCursor;
    }
    if (status !== 'cancelled' && root.employee_id && root.project_id) {
      this.memoryDistillationQueue.enqueue({
        repos: this.repos,
        run: root,
        status,
        summary: conversation?.terminal.text ?? root.result_summary_json,
      });
    }
  }

  /** Persist a delegation run's lifecycle to agent_runs. Runs on the serialized
   *  persist chain — a DB write failure logs but never breaks the live run. Only
   *  the start/finish events carry persistable state; tool/delta events stay
   *  transient. */
  async persistAgentRun(evt: AgentRunEvent): Promise<void> {
    const repo = this.repos.agentRuns;
    try {
      if (evt.type === 'run.started') {
        if (evt.runId === evt.rootRunId) {
          this.memoryDistillationQueue.cancelActiveForForegroundRun();
        }
        const payload = evt.payload as AgentRunStartedPayload;
        // Insert-if-absent: a resume replays run.started for an existing run; the
        // existing row (flipped interrupted→running only after backend authority
        // revalidation) must be left untouched, not re-created or clobbered.
        await persistRunStartIfAbsent(repo, {
          run_id: evt.runId,
          thread_id: evt.threadId,
          company_id: this.companyId,
          project_id: payload.projectId ?? null,
          parent_run_id: evt.parentRunId ?? null,
          root_run_id: evt.rootRunId,
          employee_id: evt.employeeId ?? null,
          relation: evt.relation ?? null,
          work_kind: evt.workKind ?? null,
          objective: payload.objective ?? null,
          access: payload.access ?? null,
          status: 'running',
          runtime_context_json: payload.runtimeContextJson ?? null,
        });
        const competitiveDraft = parseRunContext(
          payload.runtimeContextJson ?? null,
        )?.competitiveDraft;
        if (competitiveDraft) {
          const attempt = await this.repos.competitiveDraftAttempts.findById(
            competitiveDraft.attemptId,
          );
          if (
            !attempt ||
            attempt.group_id !== competitiveDraft.groupId ||
            attempt.run_id !== evt.runId ||
            attempt.thread_id !== evt.threadId ||
            attempt.employee_id !== evt.employeeId ||
            attempt.ordinal !== competitiveDraft.attemptIndex
          ) {
            throw new Error('Competitive draft start does not match its durable attempt.');
          }
          await this.repos.competitiveDraftAttempts.update(competitiveDraft.attemptId, {
            status: 'running',
          });
        }
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
          // The typed failure cause is durable only on a failed terminal;
          // completed/cancelled runs never carry one.
          ...(evt.type === 'run.failed' ? { failureKind: payload.failureKind ?? null } : {}),
        });
        if (evt.type !== 'run.cancelled' && evt.runId !== evt.rootRunId) {
          const run = await repo.findById(evt.runId);
          if (run?.employee_id && run.project_id) {
            this.memoryDistillationQueue.enqueue({
              repos: this.repos,
              run,
              status: evt.type === 'run.completed' ? 'completed' : 'failed',
              summary: payload.summary,
            });
          }
        }
      }
    } catch (err) {
      console.warn('[desktop-agent-runtime] persist agent_run failed', { runId: evt.runId, err });
    }
  }

  async persistWorkspaceLeaseSnapshot(
    event: Extract<PiAgentHostEvent, { kind: 'agentRun' }>,
    fallbackProjectId: string | null,
  ): Promise<void> {
    const repo = this.repos.agentEvents;
    const payload =
      event.payload && typeof event.payload === 'object'
        ? (event.payload as Record<string, unknown>)
        : {};
    const projectId =
      typeof payload.projectId === 'string' && payload.projectId.trim()
        ? payload.projectId
        : fallbackProjectId;
    try {
      await repo.append({
        event_id: crypto.randomUUID(),
        project_id: projectId,
        thread_id: event.threadId,
        company_id: this.companyId,
        agent_name: event.employeeId ?? event.runId,
        event_type: 'workspace.lease.snapshot',
        payload_json: JSON.stringify({
          ...payload,
          rootRunId: event.rootRunId,
          runId: event.runId,
          parentRunId: event.parentRunId ?? null,
        }),
        parent_event_id: null,
      });
    } catch (err) {
      console.warn('[desktop-agent-runtime] persist workspace lease snapshot failed', {
        runId: event.runId,
        err,
      });
    }
  }

  async persistWorkspaceCheckpoint(
    event: Extract<PiAgentHostEvent, { kind: 'agentRun' }>,
    fallbackProjectId: string | null,
  ): Promise<void> {
    const payload =
      event.payload && typeof event.payload === 'object'
        ? (event.payload as Record<string, unknown>)
        : {};
    const projectId =
      typeof payload.projectId === 'string' && payload.projectId.trim()
        ? payload.projectId
        : fallbackProjectId;
    try {
      await this.repos.agentEvents.append({
        event_id:
          typeof payload.checkpointId === 'string' ? payload.checkpointId : crypto.randomUUID(),
        project_id: projectId,
        thread_id: event.threadId,
        company_id: this.companyId,
        agent_name: event.employeeId ?? event.runId,
        event_type: 'workspace.checkpoint',
        payload_json: JSON.stringify({
          ...payload,
          rootRunId: event.rootRunId,
          runId: event.runId,
          parentRunId: event.parentRunId ?? null,
        }),
        parent_event_id: null,
      });
    } catch (err) {
      console.warn('[desktop-agent-runtime] persist workspace checkpoint failed', {
        runId: event.runId,
        err,
      });
    }
  }

  async persistWorkspaceDiagnostics(
    event: Extract<PiAgentHostEvent, { kind: 'agentRun' }>,
    projectId: string | null,
    payload: WorkspaceDiagnosticsUpdatedPayload,
  ): Promise<boolean> {
    const level =
      payload.counts.error > 0 ? 'error' : payload.counts.warning > 0 ? 'warning' : 'clear';
    try {
      await this.repos.agentEvents.append({
        event_id: crypto.randomUUID(),
        project_id: projectId,
        thread_id: event.threadId,
        company_id: this.companyId,
        agent_name: event.employeeId ?? event.runId,
        event_type: `${WORKSPACE_DIAGNOSTICS_UPDATED_EVENT}.${level}`,
        payload_json: JSON.stringify(payload),
        parent_event_id: null,
      });
      return true;
    } catch (err) {
      console.warn('[desktop-agent-runtime] persist workspace diagnostics failed', {
        runId: event.runId,
        path: payload.path,
        err,
      });
      return false;
    }
  }

  /** Persist an `artifact.created` run event as a deliverable row, then emit the
   *  bus event so the Outputs panel refetches AFTER the row is committed. The
   *  agent published a workspace-relative path; we read it through the SAME
   *  sandboxed Tauri command the file browser uses (`project_read_file`), so an
   *  out-of-workspace path is rejected by Rust and no row is written (VM-002
   *  acceptance-(c)). Runs on the serialized persist chain; never throws — a
   *  failure logs and the row is simply skipped (mirrors persistAgentRun). */
  async persistArtifact(
    evt: AgentRunEvent,
    bindingClaim: TaskWorkspaceBindingClaim | null,
  ): Promise<void> {
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
    if (!bindingClaim) {
      console.warn(
        '[desktop-agent-runtime] artifact.created arrived without a workspace binding claim — skipped',
        { runId: evt.runId, path },
      );
      return;
    }
    // Read the file through the sandboxed workspace command. A workspace-jail
    // violation or a missing file rejects here → no row, no bus event.
    let content: string;
    try {
      content = await invokeCommand('project_read_file', {
        path,
        projectId: bindingClaim.projectId,
        bindingClaim,
      });
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
        // Record the producing employee as the artifact's contributor so the
        // output card can show real producer provenance (J1); empty only when the
        // run had no employee scope (e.g. a bare root turn).
        contributors_json: JSON.stringify(evt.employeeId ? [evt.employeeId] : []),
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

  async persistMcpToolCall(
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
      approvalStatus?: unknown;
    };
    const server = typeof payload.server === 'string' ? payload.server : '';
    const tool = typeof payload.tool === 'string' ? payload.tool : '';
    if (!server || !tool) return;
    const employeeId = event.employeeId ?? fallbackEmployeeId ?? 'unknown';
    const createdAt = new Date().toISOString();
    const isError = payload.isError === true;
    const approvalStatus =
      payload.approvalStatus === 'human_approved' ||
      payload.approvalStatus === 'human_denied' ||
      payload.approvalStatus === 'not_required'
        ? payload.approvalStatus
        : payload.write === true && payload.approved === true
          ? 'human_approved'
          : 'not_required';
    try {
      await this.repos.mcpAudit.create({
        audit_id: crypto.randomUUID(),
        thread_id: event.threadId,
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
        approval_status: approvalStatus,
        approved_by: approvalStatus === 'human_approved' ? 'boss' : null,
        created_at: createdAt,
      });
      if (payload.write === true && approvalStatus === 'human_approved') {
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
}
