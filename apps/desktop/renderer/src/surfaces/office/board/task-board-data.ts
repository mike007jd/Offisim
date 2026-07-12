import type { ConversationRunPhase } from '@/assistant/runtime/conversation-run-controller.js';
import { useActiveConversationRuns } from '@/assistant/runtime/conversation-run-react.js';
import { missionRunManager } from '@/runtime/mission/mission-run-manager.js';
import { getRepos } from '@/runtime/repos.js';
import type { AgentEventRow, AgentRunRow } from '@offisim/core/browser';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';

export type TaskBoardStatus =
  | 'running'
  | 'pending_review'
  | 'merged'
  | 'discarded'
  | 'interrupted'
  | 'completed'
  | 'failed'
  | 'cancelled';

const PERSISTED_TASK_STATUSES = [
  'running',
  'interrupted',
  'completed',
  'failed',
  'cancelled',
] as const;

const STATUS_RANK: Record<TaskBoardStatus, number> = {
  running: 0,
  pending_review: 1,
  interrupted: 2,
  failed: 3,
  cancelled: 4,
  completed: 5,
  merged: 6,
  discarded: 7,
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
  searchChildFiltered?: boolean;
}

type TaskBoardChildRow = Omit<TaskBoardRow, 'children'>;

export interface TaskBoardVisibleRow {
  row: TaskBoardRow | TaskBoardChildRow;
  level: 0 | 1;
  childCount: number;
}

export const WORKSPACE_LEASE_SNAPSHOT_EVENT = 'workspace.lease.snapshot';
export const WORKSPACE_LEASE_ACTION_EVENT = 'workspace.lease.action';

export interface WorkspaceLeaseReviewRow {
  leaseId: string;
  threadId: string;
  rootRunId: string;
  runId: string;
  relatedRunIds: string[];
  relatedRootRunIds: string[];
  projectId: string | null;
  workspaceRoot: string | null;
  access: string | null;
  cwd: string | null;
  branch: string | null;
  isolated: boolean;
  status: 'active' | 'pending_review' | 'merged' | 'discarded' | 'failed';
  phase: string | null;
  reason: string | null;
  changedPaths: string[];
  files: Array<{ path: string; diff: string }>;
  conflicts: string[];
  loopAttempt: number | null;
  loopMaxAttempts: number | null;
  verificationSummary: string | null;
  verificationPassed: boolean | null;
  terminationReason: string | null;
  updatedAt: string;
  createdAt: string;
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
  pending_review: number;
  merged: number;
  discarded: number;
}

interface TaskBoardView {
  rows: TaskBoardRow[];
  stats: TaskBoardStats;
}

function normalizeStatus(value: string): TaskBoardStatus {
  return PERSISTED_TASK_STATUSES.includes(value as (typeof PERSISTED_TASK_STATUSES)[number])
    ? (value as TaskBoardStatus)
    : 'failed';
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
  return {
    total: 0,
    running: 0,
    pending_review: 0,
    merged: 0,
    discarded: 0,
    interrupted: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
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

function rootRowMatchesSearch(row: TaskBoardRow, q: string): boolean {
  return [
    row.runId,
    row.threadId,
    row.employeeId ?? '',
    row.objective ?? '',
    row.status,
    row.source ?? '',
  ].some((value) => value.toLowerCase().includes(q));
}

function childRowMatchesSearch(row: TaskBoardChildRow, q: string): boolean {
  return [
    row.runId,
    row.employeeId ?? '',
    row.relation ?? '',
    row.access ?? '',
    row.objective ?? '',
    row.status,
  ].some((value) => value.toLowerCase().includes(q));
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
      const rows = await repos.agentRuns.findByStatus(companyId, [...PERSISTED_TASK_STATUSES]);
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
        children: (() => {
          const childById = new Map(
            (existing?.children ?? []).map((child) => [child.runId, child]),
          );
          for (const delegation of snapshot.delegations) {
            const current = childById.get(delegation.runId);
            childById.set(delegation.runId, {
              runId: delegation.runId,
              threadId: snapshot.threadId,
              companyId,
              projectId: snapshot.projectId,
              parentRunId: delegation.parentRunId,
              rootRunId: snapshot.attemptId,
              employeeId: delegation.employeeId,
              relation: 'delegate',
              access: current?.access ?? null,
              objective: delegation.objective,
              status:
                delegation.state === 'done'
                  ? 'completed'
                  : delegation.state === 'failed'
                    ? 'failed'
                    : delegation.state === 'cancelled'
                      ? 'cancelled'
                      : 'running',
              phase: null,
              source: snapshot.source,
              sessionFile: current?.sessionFile ?? null,
              startedAt: current?.startedAt ?? new Date().toISOString(),
              finishedAt: current?.finishedAt ?? null,
              usageJson: current?.usageJson ?? null,
              resultSummaryJson: current?.resultSummaryJson ?? null,
              live: delegation.state === 'running',
            });
          }
          return [...childById.values()].sort(sortRows);
        })(),
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
  const filtered: TaskBoardRow[] = [];
  for (const row of rows) {
    if (filters.status !== 'all' && row.status !== filters.status) continue;
    if (!q) {
      filtered.push(row);
      continue;
    }
    const children = row.children.filter((child) => childRowMatchesSearch(child, q));
    if (children.length > 0) {
      filtered.push({ ...row, children, searchChildFiltered: true });
      continue;
    }
    if (rootRowMatchesSearch(row, q)) {
      filtered.push(row);
    }
  }
  return filtered;
}

export function flattenTaskRows(
  rows: readonly TaskBoardRow[],
  expandedRunIds: ReadonlySet<string>,
): TaskBoardVisibleRow[] {
  const visible: TaskBoardVisibleRow[] = [];
  for (const row of rows) {
    visible.push({ row, level: 0, childCount: row.children.length });
    const expanded = expandedRunIds.has(row.runId);
    const children = expanded || row.searchChildFiltered ? row.children : [];
    if (!expanded && children.length === 0) continue;
    for (const child of children) {
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

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asDiffFiles(value: unknown): Array<{ path: string; diff: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const path = record ? asString(record.path) : null;
    return path ? [{ path, diff: typeof record?.diff === 'string' ? record.diff : '' }] : [];
  });
}

function leaseReviewStatus(
  payload: Record<string, unknown>,
  current?: WorkspaceLeaseReviewRow,
): WorkspaceLeaseReviewRow['status'] {
  const phase = asString(payload.phase);
  const action = asString(payload.action);
  const status = asString(payload.status);
  if (phase === 'released_after_merge' || phase === 'integrated' || action === 'merge_completed') {
    return 'merged';
  }
  if (
    phase === 'released_after_discard' ||
    action === 'discard_completed' ||
    status === 'discarded'
  ) {
    return 'discarded';
  }
  if (status === 'conflicted' || action?.endsWith('_failed')) return 'failed';
  // A verification-terminated loop (stuck / attempt cap / budget) is a FAILED
  // run whose worktree is retained for inspection — leaving the lease 'active'
  // would keep painting the child as Running with a live Stop control.
  if (phase === 'verification_terminated') return 'failed';
  if (phase === 'planned' || phase === 'pending_review' || status === 'pending_review') {
    return 'pending_review';
  }
  if (status === 'active') return 'active';
  return current?.status ?? 'active';
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
  return buildWorkspaceLeaseRows(events, rootRunId);
}

export function buildProjectWorkspaceLeaseReviewRows(
  events: readonly AgentEventRow[],
): WorkspaceLeaseReviewRow[] {
  return buildWorkspaceLeaseRows(events, null);
}

/** One cache/query contract for both project and company Board views. A company
 * view is simply the sorted set of its project ids, so overlapping scopes share
 * the same loader and event projection. */
export function workspaceLeaseReviewsQueryOptions(projectIds: readonly string[]) {
  const scopeProjectIds = [...new Set(projectIds.filter(Boolean))].sort();
  return {
    queryKey: ['workspace-lease-reviews', scopeProjectIds] as const,
    queryFn: async () => {
      const repos = await getRepos();
      if (!repos.agentEvents) return [];
      const perProject = await Promise.all(
        scopeProjectIds.map(async (projectId) => {
          const [snapshots, actions] = await Promise.all([
            repos.agentEvents?.findByProject(projectId, {
              eventType: WORKSPACE_LEASE_SNAPSHOT_EVENT,
            }),
            repos.agentEvents?.findByProject(projectId, {
              eventType: WORKSPACE_LEASE_ACTION_EVENT,
            }),
          ]);
          return buildProjectWorkspaceLeaseReviewRows([...(snapshots ?? []), ...(actions ?? [])]);
        }),
      );
      return perProject.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    enabled: scopeProjectIds.length > 0,
    refetchInterval: 2_000,
  };
}

function buildWorkspaceLeaseRows(
  events: readonly AgentEventRow[],
  rootRunId: string | null,
): WorkspaceLeaseReviewRow[] {
  const byLease = new Map<string, WorkspaceLeaseReviewRow>();
  const ordered = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const event of ordered) {
    const payload = parsePayload(event);
    const eventRootRunId = payload ? asString(payload.rootRunId) : null;
    if (!payload || !eventRootRunId || (rootRunId && eventRootRunId !== rootRunId)) continue;
    const leaseId = asString(payload.leaseId);
    if (!leaseId) continue;
    if (event.event_type === WORKSPACE_LEASE_SNAPSHOT_EVENT) {
      const current = byLease.get(leaseId);
      const changedPaths = asStringArray(payload.changedPaths);
      const files = asDiffFiles(payload.files);
      const runId = asString(payload.runId) ?? current?.runId ?? '';
      const originRunId = asString(payload.originRunId);
      byLease.set(leaseId, {
        leaseId,
        threadId: event.thread_id,
        rootRunId: eventRootRunId,
        runId,
        relatedRunIds: [
          ...new Set([
            ...(current?.relatedRunIds ?? []),
            ...(runId ? [runId] : []),
            ...(originRunId ? [originRunId] : []),
          ]),
        ],
        relatedRootRunIds: [...new Set([...(current?.relatedRootRunIds ?? []), eventRootRunId])],
        projectId: asString(payload.projectId) ?? current?.projectId ?? null,
        workspaceRoot: asString(payload.workspaceRoot) ?? current?.workspaceRoot ?? null,
        access: asString(payload.access) ?? current?.access ?? null,
        cwd: asString(payload.cwd) ?? current?.cwd ?? null,
        branch: asString(payload.branch) ?? current?.branch ?? null,
        isolated:
          typeof payload.isolated === 'boolean' ? payload.isolated : (current?.isolated ?? false),
        status: leaseReviewStatus(payload, current),
        phase: asString(payload.phase) ?? current?.phase ?? null,
        reason: asString(payload.reason) ?? current?.reason ?? null,
        changedPaths: changedPaths.length > 0 ? changedPaths : (current?.changedPaths ?? []),
        files: files.length > 0 ? files : (current?.files ?? []),
        conflicts: asStringArray(payload.conflicts),
        loopAttempt: asNumber(payload.loopAttempt) ?? current?.loopAttempt ?? null,
        loopMaxAttempts: asNumber(payload.loopMaxAttempts) ?? current?.loopMaxAttempts ?? null,
        verificationSummary:
          asString(payload.verificationSummary) ?? current?.verificationSummary ?? null,
        verificationPassed:
          typeof payload.verificationPassed === 'boolean'
            ? payload.verificationPassed
            : (current?.verificationPassed ?? null),
        terminationReason:
          asString(payload.terminationReason) ?? current?.terminationReason ?? null,
        updatedAt: asString(payload.capturedAt) ?? event.created_at,
        createdAt: asString(payload.createdAt) ?? current?.createdAt ?? event.created_at,
        lastAction: current?.lastAction ?? null,
        lastActionError: current?.lastActionError ?? null,
      });
      continue;
    }
    if (event.event_type === WORKSPACE_LEASE_ACTION_EVENT) {
      const current = byLease.get(leaseId);
      if (!current) continue;
      const action = asString(payload.action);
      byLease.set(leaseId, {
        ...current,
        status: leaseReviewStatus(payload, current),
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

export function useProjectWorkspaceLeaseReviews(projectId: string | null): {
  rows: WorkspaceLeaseReviewRow[];
  isLoading: boolean;
  refetch: () => Promise<unknown>;
} {
  const query = useQuery(workspaceLeaseReviewsQueryOptions(projectId ? [projectId] : []));
  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
