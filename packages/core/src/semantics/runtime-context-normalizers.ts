import type {
  AgentContextPackNodeSummary,
  AgentContextPackPendingInteraction,
  AgentContextPackTaskRun,
  InteractionRequest,
} from '@offisim/shared-types';

export interface TaskRunLike {
  readonly task_run_id: string;
  readonly employee_id: string | null;
  readonly task_type: string;
  readonly status: string;
}

export interface NodeSummaryLike {
  readonly node_name: string;
  readonly employee_id: string | null;
  readonly step_index: number | null;
  readonly summary_text: string;
}

const ACTIVE_TASK_STATUSES = new Set([
  'running',
  'queued',
  'waiting_input',
  'waiting_dependency',
  'review_ready',
]);

export function normalizePendingInteraction(
  request: InteractionRequest | null,
): AgentContextPackPendingInteraction | null {
  if (!request) return null;
  return {
    kind: request.kind,
    severity: request.severity,
    title: request.title,
    employeeId: request.employeeId ?? null,
    taskRunId: request.taskRunId ?? null,
  };
}

export function normalizeActiveTaskRuns(
  rows: readonly TaskRunLike[],
  limit = 6,
): AgentContextPackTaskRun[] {
  const active = rows.filter((r) => ACTIVE_TASK_STATUSES.has(r.status));
  const sorted = active.length > 0
    ? active
    : rows.filter((r) => r.status === 'completed').slice(-limit);
  return sorted.slice(0, limit).map((r) => ({
    taskRunId: r.task_run_id,
    employeeId: r.employee_id,
    taskType: r.task_type,
    status: r.status,
  }));
}

export function normalizeNodeSummaries(
  rows: readonly NodeSummaryLike[],
  limit = 4,
): AgentContextPackNodeSummary[] {
  return rows.slice(0, limit).map((r) => ({
    nodeName: r.node_name,
    employeeId: r.employee_id,
    stepIndex: r.step_index,
    summaryText: r.summary_text,
  }));
}

export function deriveRecommendedFocus(
  pending: AgentContextPackPendingInteraction | null,
  activeTaskRuns: readonly AgentContextPackTaskRun[],
  nodeSummaries: readonly AgentContextPackNodeSummary[],
): string | null {
  if (pending) {
    switch (pending.kind) {
      case 'permission_request':
        return 'Waiting for user approval before proceeding.';
      case 'plan_review':
        return 'Waiting for plan review before execution.';
      case 'agent_question':
        return 'Waiting for user clarification.';
    }
  }

  const blocked = activeTaskRuns.filter(
    (t) => t.status === 'waiting_input' || t.status === 'waiting_dependency',
  );
  if (blocked.length > 0) {
    return `${blocked.length} task${blocked.length > 1 ? 's' : ''} blocked, waiting for input or dependencies.`;
  }

  const running = activeTaskRuns.filter((t) => t.status === 'running');
  if (running.length > 0) {
    return `${running.length} task${running.length > 1 ? 's' : ''} currently executing.`;
  }

  const lastSummary = nodeSummaries[0];
  if (lastSummary) {
    return `Last completed: ${lastSummary.nodeName}${lastSummary.stepIndex != null ? ` step ${lastSummary.stepIndex}` : ''}.`;
  }

  return null;
}
