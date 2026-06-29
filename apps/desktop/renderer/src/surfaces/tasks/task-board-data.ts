import { useActiveConversationRuns } from '@/assistant/runtime/conversation-run-react.js';
import type { ConversationRunPhase } from '@/assistant/runtime/conversation-run-controller.js';
import { missionRunManager } from '@/runtime/mission/mission-run-manager.js';
import { getRepos } from '@/runtime/repos.js';
import type { AgentEventRow, AgentRunRow } from '@offisim/core/browser';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';

export type TaskBoardStatus = 'running' | 'interrupted' | 'completed' | 'failed' | 'cancelled';

const TASK_STATUSES: readonly TaskBoardStatus[] = [
  'running',
  'interrupted',
  'completed',
  'failed',
  'cancelled',
];

const STATUS_RANK: Record<TaskBoardStatus, number> = {
  running: 0,
  interrupted: 1,
  failed: 2,
  cancelled: 3,
  completed: 4,
};

export interface TaskBoardRow {
  runId: string;
  threadId: string;
  companyId: string;
  projectId: string | null;
  parentRunId: string | null;
  rootRunId: string;
  employeeId: string | null;
  relation: string | null;
  access: string | null;
  objective: string | null;
  status: TaskBoardStatus;
  phase: ConversationRunPhase | null;
  source: 'office' | 'workspace' | null;
  sessionFile: string | null;
  startedAt: string;
  finishedAt: string | null;
  usageJson: string | null;
  resultSummaryJson: string | null;
  live: boolean;
  children: TaskBoardChildRow[];
}

export type TaskBoardChildRow = Omit<TaskBoardRow, 'children'>;

export interface TaskBoardVisibleRow {
  row: TaskBoardRow | TaskBoardChildRow;
  level: 0 | 1;
  childCount: number;
}

export const WORKSPACE_LEASE_SNAPSHOT_EVENT = 'workspace.lease.snapshot';
export const WORKSPACE_LEASE_ACTION_EVENT = 'workspace.lease.action';

export interface WorkspaceLeaseReviewRow {
  leaseId: string;
  rootRunId: string;
  runId: string;
  projectId: string | null;
  workspaceRoot: string | null;
  access: string | null;
  cwd: string | null;
  branch: string | null;
  isolated: boolean;
  status: string;
  phase: string | null;
  reason: string | null;
  changedPaths: string[];
  conflicts: string[];
  updatedAt: string;
  lastAction: string | null;
  lastActionError: string | null;
}

interface TaskBoardStats {
  total: number;
  running: number;
  interrupted: number;
  completed: number;
  failed: number;
  cancelled: number;
}

interface TaskBoardView {
  rows: TaskBoardRow[];
  stats: TaskBoardStats;
}

function normalizeStatus(value: string): TaskBoardStatus {
  return TASK_STATUSES.includes(value as TaskBoardStatus) ? (value as TaskBoardStatus) : 'failed';
}

function phaseToStatus(phase: ConversationRunPhase): TaskBoardStatus | null {
  switch (phase) {
    case 'preparing':
    case 'running':
    case 'awaiting-approval':
      return 'running';
    case 'completed':
      return 'completed';
    case 'interrupted':
      return 'interrupted';
    case 'failed':
      return 'failed';
    case 'idle':
      return null;
  }
  return null;
}

function rowFromAgentRun(row: AgentRunRow): TaskBoardRow {
  return {
    runId: row.run_id,
    threadId: row.thread_id,
    companyId: row.company_id,
    projectId: row.project_id,
    parentRunId: row.parent_run_id,
    rootRunId: row.root_run_id,
    employeeId: row.employee_id,
    relation: row.relation,
    access: row.access,
    objective: row.objective,
    status: normalizeStatus(row.status),
    phase: null,
    source: null,
    sessionFile: row.session_file,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    usageJson: row.usage_json,
    resultSummaryJson: row.result_summary_json,
    live: false,
    children: [],
  };
}

export function buildTaskTree(rows: readonly AgentRunRow[]): TaskBoardRow[] {
  const byRoot = new Map<string, TaskBoardRow>();
  const children = new Map<string, TaskBoardChildRow[]>();
  for (const row of rows) {
    const mapped = rowFromAgentRun(row);
    if (row.run_id === row.root_run_id) {
      byRoot.set(row.run_id, mapped);
    } else {
      const { children: _children, ...child } = mapped;
      const list = children.get(row.root_run_id) ?? [];
      list.push(child);
      children.set(row.root_run_id, list);
    }
  }
  for (const [rootRunId, list] of children) {
    const root = byRoot.get(rootRunId);
    if (!root) continue;
    root.children = list.sort(sortRows);
  }
  return [...byRoot.values()];
}

function emptyStats(): TaskBoardStats {
  return { total: 0, running: 0, interrupted: 0, completed: 0, failed: 0, cancelled: 0 };
}

function buildStats(rows: readonly TaskBoardRow[]): TaskBoardStats {
  const stats = emptyStats();
  stats.total = rows.length;
  for (const row of rows) stats[row.status] += 1;
  return stats;
}

function sortRows(
  a: TaskBoardRow | TaskBoardChildRow,
  b: TaskBoardRow | TaskBoardChildRow,
): number {
  const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (rank !== 0) return rank;
  return Date.parse(b.startedAt) - Date.parse(a.startedAt);
}

export function useTaskBoard(companyId: string | null): TaskBoardView & {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
} {
  const live = useActiveConversationRuns();
  const activeMissionRuns = useSyncExternalStore(
    missionRunManager.subscribe,
    missionRunManager.getSnapshot,
    missionRunManager.getSnapshot,
  );
  const hasLiveMissionRuns = activeMissionRuns.some((run) => run.companyId === companyId);
  const runs = useQuery({
    queryKey: ['task-board', companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const repos = await getRepos();
      if (!repos.agentRuns) return [];
      const rows = await repos.agentRuns.findByStatus(companyId, [...TASK_STATUSES]);
      return buildTaskTree(rows);
    },
    enabled: Boolean(companyId),
    refetchInterval: live.activeRuns.length > 0 || hasLiveMissionRuns ? 2_000 : false,
  });

  const rows = useMemo(() => {
    const byRunId = new Map<string, TaskBoardRow>();
    for (const row of runs.data ?? []) byRunId.set(row.runId, row);

    for (const snapshot of live.runs) {
      if (!companyId || snapshot.companyId !== companyId || !snapshot.attemptId) continue;
      const status = phaseToStatus(snapshot.phase);
      if (!status) continue;
      const existing = byRunId.get(snapshot.attemptId);
      byRunId.set(snapshot.attemptId, {
        runId: snapshot.attemptId,
        threadId: snapshot.threadId,
        companyId,
        projectId: snapshot.projectId,
        parentRunId: null,
        rootRunId: snapshot.attemptId,
        employeeId: snapshot.employeeId,
        relation: null,
        access: existing?.access ?? null,
        objective: existing?.objective ?? null,
        status,
        phase: snapshot.phase,
        source: snapshot.source,
        sessionFile: existing?.sessionFile ?? null,
        startedAt: existing?.startedAt ?? new Date().toISOString(),
        finishedAt: existing?.finishedAt ?? null,
        usageJson: existing?.usageJson ?? null,
        resultSummaryJson: existing?.resultSummaryJson ?? null,
        live: true,
        children: existing?.children ?? [],
      });
    }

    return [...byRunId.values()].sort(sortRows);
  }, [companyId, live.runs, runs.data]);

  return {
    rows,
    stats: buildStats(rows),
    isLoading: runs.isLoading,
    isError: runs.isError,
    error: runs.error,
    refetch: runs.refetch,
  };
}

export function filterTaskRows(
  rows: readonly TaskBoardRow[],
  filters: { status: TaskBoardStatus | 'all'; search: string },
): TaskBoardRow[] {
  const q = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.status !== 'all' && row.status !== filters.status) return false;
    if (!q) return true;
    const ownMatch = [
      row.runId,
      row.threadId,
      row.employeeId ?? '',
      row.objective ?? '',
      row.status,
      row.source ?? '',
    ].some((value) => value.toLowerCase().includes(q));
    if (ownMatch) return true;
    return row.children.some((child) =>
      [
        child.runId,
        child.employeeId ?? '',
        child.relation ?? '',
        child.access ?? '',
        child.objective ?? '',
        child.status,
      ].some((value) => value.toLowerCase().includes(q)),
    );
  });
}

export function flattenTaskRows(
  rows: readonly TaskBoardRow[],
  expandedRunIds: ReadonlySet<string>,
): TaskBoardVisibleRow[] {
  const visible: TaskBoardVisibleRow[] = [];
  for (const row of rows) {
    visible.push({ row, level: 0, childCount: row.children.length });
    if (!expandedRunIds.has(row.runId)) continue;
    for (const child of row.children) {
      visible.push({ row: child, level: 1, childCount: 0 });
    }
  }
  return visible;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function parsePayload(row: AgentEventRow): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(row.payload_json));
  } catch {
    return null;
  }
}

export function buildWorkspaceLeaseReviewRows(
  events: readonly AgentEventRow[],
  rootRunId: string,
): WorkspaceLeaseReviewRow[] {
  const byLease = new Map<string, WorkspaceLeaseReviewRow>();
  const ordered = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const event of ordered) {
    const payload = parsePayload(event);
    if (!payload || asString(payload.rootRunId) !== rootRunId) continue;
    const leaseId = asString(payload.leaseId);
    if (!leaseId) continue;
    if (event.event_type === WORKSPACE_LEASE_SNAPSHOT_EVENT) {
      const current = byLease.get(leaseId);
      byLease.set(leaseId, {
        leaseId,
        rootRunId,
        runId: asString(payload.runId) ?? current?.runId ?? '',
        projectId: asString(payload.projectId) ?? current?.projectId ?? null,
        workspaceRoot: asString(payload.workspaceRoot) ?? current?.workspaceRoot ?? null,
        access: asString(payload.access) ?? current?.access ?? null,
        cwd: asString(payload.cwd) ?? current?.cwd ?? null,
        branch: asString(payload.branch) ?? current?.branch ?? null,
        isolated:
          typeof payload.isolated === 'boolean' ? payload.isolated : (current?.isolated ?? false),
        status: asString(payload.status) ?? current?.status ?? 'unknown',
        phase: asString(payload.phase) ?? current?.phase ?? null,
        reason: asString(payload.reason) ?? current?.reason ?? null,
        changedPaths: asStringArray(payload.changedPaths),
        conflicts: asStringArray(payload.conflicts),
        updatedAt: asString(payload.capturedAt) ?? event.created_at,
        lastAction: current?.lastAction ?? null,
        lastActionError: current?.lastActionError ?? null,
      });
      continue;
    }
    if (event.event_type === WORKSPACE_LEASE_ACTION_EVENT) {
      const current = byLease.get(leaseId);
      if (!current) continue;
      const action = asString(payload.action);
      const status = asString(payload.status);
      byLease.set(leaseId, {
        ...current,
        status: status ?? current.status,
        phase: action ?? current.phase,
        reason: asString(payload.reason) ?? current.reason,
        updatedAt: asString(payload.createdAt) ?? event.created_at,
        lastAction: action,
        lastActionError: asString(payload.error),
      });
    }
  }
  return [...byLease.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function useWorkspaceLeaseReviews(
  threadId: string | null,
  rootRunId: string | null,
): {
  rows: WorkspaceLeaseReviewRow[];
  isLoading: boolean;
  refetch: () => Promise<unknown>;
} {
  const query = useQuery({
    queryKey: ['workspace-lease-reviews', threadId, rootRunId],
    queryFn: async () => {
      if (!threadId || !rootRunId) return [];
      const repos = await getRepos();
      if (!repos.agentEvents) return [];
      const [snapshots, actions] = await Promise.all([
        repos.agentEvents.findByThread(threadId, { eventType: WORKSPACE_LEASE_SNAPSHOT_EVENT }),
        repos.agentEvents.findByThread(threadId, { eventType: WORKSPACE_LEASE_ACTION_EVENT }),
      ]);
      return buildWorkspaceLeaseReviewRows([...snapshots, ...actions], rootRunId);
    },
    enabled: Boolean(threadId && rootRunId),
  });
  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
