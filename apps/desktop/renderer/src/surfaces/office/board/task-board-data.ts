import type { ConversationRunPhase } from '@/assistant/runtime/conversation-run-controller.js';
import { useActiveConversationRuns } from '@/assistant/runtime/conversation-run-react.js';
import type {
  ReviewAnnotation,
  ReviewDecision,
  ReviewWorkbenchState,
} from '@/data/review-workbench.js';
import { type WorkspaceLeaseLifecycleRow, invokeCommand } from '@/lib/tauri-commands.js';
import { missionRunManager } from '@/runtime/mission/mission-run-manager.js';
import { createTauriGitWorktreeOps } from '@/runtime/mission/workspace/git-worktree-ops.js';
import { getRepos } from '@/runtime/repos.js';
import {
  type AgentEventRow,
  type AgentRunRow,
  createWorkspaceLeaseManager,
} from '@offisim/core/browser';
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
const WORKSPACE_LEASE_EVENT_WINDOW = 500;

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
  review: ReviewWorkbenchState | null;
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

function asReviewWorkbenchState(value: unknown): ReviewWorkbenchState | null {
  const record = asRecord(value);
  const revision = record ? asString(record.revision) : null;
  const decisionsRecord = asRecord(record?.decisions);
  if (!revision || !decisionsRecord || !Array.isArray(record?.annotations)) return null;
  const decisions: Record<string, ReviewDecision> = {};
  for (const [key, decision] of Object.entries(decisionsRecord)) {
    if (decision === 'pending' || decision === 'accepted' || decision === 'returned') {
      decisions[key] = decision;
    }
  }
  const annotations = record.annotations.flatMap((value): ReviewAnnotation[] => {
    const annotation = asRecord(value);
    const id = asString(annotation?.id);
    const fileId = asString(annotation?.fileId);
    const hunkId = asString(annotation?.hunkId);
    const path = asString(annotation?.path);
    const label = asString(annotation?.label);
    const body = asString(annotation?.body);
    const state = annotation?.state;
    if (
      !id ||
      !fileId ||
      !hunkId ||
      !path ||
      !label ||
      !body ||
      (state !== 'draft' && state !== 'submitted' && state !== 'resolved')
    ) {
      return [];
    }
    return [
      {
        id,
        fileId,
        hunkId,
        lineId: asString(annotation?.lineId),
        path,
        label,
        body,
        state,
      },
    ];
  });
  return {
    revision,
    decisions,
    annotations,
    appliedReturnAnchors: asStringArray(record.appliedReturnAnchors),
  };
}

function parsePayload(row: AgentEventRow): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(row.payload_json));
  } catch {
    return null;
  }
}

export function workspaceLeaseStatusFromLifecycle(
  row: WorkspaceLeaseLifecycleRow,
): WorkspaceLeaseReviewRow['status'] {
  if (row.status === 'released') return 'merged';
  if (row.status === 'discarded') return 'discarded';
  if (row.status === 'invalid') return 'failed';
  return row.ownerBindingStatus === 'active' ? 'active' : 'pending_review';
}

function rowFromLifecycle(row: WorkspaceLeaseLifecycleRow): WorkspaceLeaseReviewRow {
  const rootRunId = row.activeRootRunId ?? row.createdRootRunId;
  return {
    leaseId: row.leaseId,
    threadId: row.threadId ?? '',
    rootRunId,
    runId: row.registeredRunId,
    relatedRunIds: [row.registeredRunId],
    relatedRootRunIds: [...new Set([row.createdRootRunId, rootRunId])],
    projectId: row.projectId,
    workspaceRoot: row.workspaceRoot,
    access: 'write',
    cwd: row.cwd,
    branch: row.branch,
    isolated: true,
    status: workspaceLeaseStatusFromLifecycle(row),
    phase: null,
    reason: null,
    changedPaths: [],
    files: [],
    conflicts: [],
    loopAttempt: null,
    loopMaxAttempts: null,
    verificationSummary: null,
    verificationPassed: null,
    terminationReason: null,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    lastAction: null,
    lastActionError: null,
    review: null,
  };
}

export function buildWorkspaceLeaseReviewRows(
  lifecycleRows: readonly WorkspaceLeaseLifecycleRow[],
  events: readonly AgentEventRow[],
  rootRunId: string,
): WorkspaceLeaseReviewRow[] {
  return buildWorkspaceLeaseRows(lifecycleRows, events, rootRunId);
}

export function buildProjectWorkspaceLeaseReviewRows(
  lifecycleRows: readonly WorkspaceLeaseLifecycleRow[],
  events: readonly AgentEventRow[],
): WorkspaceLeaseReviewRow[] {
  return buildWorkspaceLeaseRows(lifecycleRows, events, null);
}

interface WorkspaceLeaseDiffProjection {
  changedPaths: string[];
  files: Array<{ path: string; diff: string }>;
}

interface WorkspaceLeaseDiffCacheEntry {
  identity: string;
  pending: Promise<WorkspaceLeaseDiffProjection>;
  expiresAtUnixMs: number;
}

export interface WorkspaceLeaseDiffCache {
  delete(key: string): void;
  getOrCollect(
    key: string,
    identity: string,
    collect: () => Promise<WorkspaceLeaseDiffProjection>,
  ): Promise<WorkspaceLeaseDiffProjection>;
}

const WORKSPACE_LEASE_DIFF_CACHE_TTL_MS = 5_000;

export function createWorkspaceLeaseDiffCache(
  now: () => number = Date.now,
): WorkspaceLeaseDiffCache {
  const entries = new Map<string, WorkspaceLeaseDiffCacheEntry>();
  return {
    delete(key) {
      entries.delete(key);
    },
    getOrCollect(key, identity, collect) {
      const cached = entries.get(key);
      const currentTime = now();
      if (cached?.identity === identity && currentTime < cached.expiresAtUnixMs) {
        return cached.pending;
      }
      const pending = collect();
      const entry = { identity, pending, expiresAtUnixMs: Number.POSITIVE_INFINITY };
      entries.set(key, entry);
      void pending.then(
        () => {
          if (entries.get(key) === entry)
            entry.expiresAtUnixMs = now() + WORKSPACE_LEASE_DIFF_CACHE_TTL_MS;
        },
        () => {
          if (entries.get(key) === entry) entries.delete(key);
        },
      );
      return pending;
    },
  };
}

const workspaceLeaseDiffCache = createWorkspaceLeaseDiffCache();

function workspaceLeaseDiffCacheKey(row: WorkspaceLeaseReviewRow): string {
  return JSON.stringify([row.projectId, row.leaseId]);
}

function workspaceLeaseDiffIdentity(row: WorkspaceLeaseReviewRow): string {
  return JSON.stringify([
    row.updatedAt,
    row.runId,
    row.workspaceRoot,
    row.cwd,
    row.branch,
    row.status,
  ]);
}

async function collectWorkspaceLeaseDiff(
  row: WorkspaceLeaseReviewRow,
): Promise<WorkspaceLeaseDiffProjection> {
  if (!row.projectId || !row.workspaceRoot || !row.cwd || !row.branch) {
    throw new Error(`Workspace lease ${row.leaseId} has incomplete durable Git identity.`);
  }
  const manager = createWorkspaceLeaseManager({
    gitOps: createTauriGitWorktreeOps({ projectId: row.projectId }),
    now: () => new Date().toISOString(),
    newId: () => crypto.randomUUID(),
  });
  const lease = manager.adoptLease({
    leaseId: row.leaseId,
    runId: row.runId,
    workspaceRoot: row.workspaceRoot,
    access: 'write',
    cwd: row.cwd,
    branch: row.branch,
    isolated: true,
    status: row.status === 'active' ? 'active' : 'pending_review',
    reason: row.reason ?? undefined,
    createdAt: row.createdAt,
  });
  return manager.collectDiff(lease);
}

export async function hydrateEventlessWorkspaceLeaseDiffs(
  rows: readonly WorkspaceLeaseReviewRow[],
  lifecycleRows: readonly WorkspaceLeaseLifecycleRow[],
  events: readonly AgentEventRow[],
  collectDiff: (
    row: WorkspaceLeaseReviewRow,
  ) => Promise<WorkspaceLeaseDiffProjection> = collectWorkspaceLeaseDiff,
  cache: WorkspaceLeaseDiffCache = workspaceLeaseDiffCache,
): Promise<WorkspaceLeaseReviewRow[]> {
  const lifecycleByLease = new Map(lifecycleRows.map((row) => [row.leaseId, row]));
  const leasesWithSnapshots = new Set<string>();
  for (const event of events) {
    if (event.event_type !== WORKSPACE_LEASE_SNAPSHOT_EVENT) continue;
    const payload = parsePayload(event);
    const leaseId = payload ? asString(payload.leaseId) : null;
    const lifecycle = leaseId ? lifecycleByLease.get(leaseId) : null;
    if (leaseId && lifecycle?.projectId === event.project_id) leasesWithSnapshots.add(leaseId);
  }
  for (const row of rows) {
    const lifecycle = lifecycleByLease.get(row.leaseId);
    if (lifecycle?.status !== 'active' || leasesWithSnapshots.has(row.leaseId)) {
      cache.delete(workspaceLeaseDiffCacheKey(row));
    }
  }
  return Promise.all(
    rows.map(async (row) => {
      const lifecycle = lifecycleByLease.get(row.leaseId);
      if (lifecycle?.status !== 'active' || leasesWithSnapshots.has(row.leaseId)) return row;
      const diff = await cache.getOrCollect(
        workspaceLeaseDiffCacheKey(row),
        workspaceLeaseDiffIdentity(row),
        () => collectDiff(row),
      );
      return { ...row, changedPaths: diff.changedPaths, files: diff.files };
    }),
  );
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
      const perProject = await Promise.all(
        scopeProjectIds.map(async (projectId) => {
          const [lifecycleRows, snapshots, actions] = await Promise.all([
            invokeCommand('workspace_lease_list', { projectId }),
            repos.agentEvents.findByProject(projectId, {
              eventType: WORKSPACE_LEASE_SNAPSHOT_EVENT,
              limit: WORKSPACE_LEASE_EVENT_WINDOW,
            }),
            repos.agentEvents.findByProject(projectId, {
              eventType: WORKSPACE_LEASE_ACTION_EVENT,
              limit: WORKSPACE_LEASE_EVENT_WINDOW,
            }),
          ]);
          const events = [...snapshots, ...actions];
          return hydrateEventlessWorkspaceLeaseDiffs(
            buildProjectWorkspaceLeaseReviewRows(lifecycleRows, events),
            lifecycleRows,
            events,
          );
        }),
      );
      return perProject.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    enabled: scopeProjectIds.length > 0,
    refetchInterval: 2_000,
  };
}

function buildWorkspaceLeaseRows(
  lifecycleRows: readonly WorkspaceLeaseLifecycleRow[],
  events: readonly AgentEventRow[],
  rootRunId: string | null,
): WorkspaceLeaseReviewRow[] {
  const lifecycleByLease = new Map(
    lifecycleRows.map((lifecycle) => [lifecycle.leaseId, lifecycle]),
  );
  const byLease = new Map(
    lifecycleRows.map((lifecycle) => [lifecycle.leaseId, rowFromLifecycle(lifecycle)]),
  );
  const ordered = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const event of ordered) {
    const payload = parsePayload(event);
    const eventRootRunId = payload ? asString(payload.rootRunId) : null;
    if (!payload) continue;
    const leaseId = asString(payload.leaseId);
    if (!leaseId) continue;
    const current = byLease.get(leaseId);
    if (!current || current.projectId !== event.project_id) continue;
    const lifecycle = lifecycleByLease.get(leaseId);
    if (!lifecycle) continue;
    const lifecycleStatus = workspaceLeaseStatusFromLifecycle(lifecycle);
    const eventRunId = asString(payload.runId);
    const originRunId = asString(payload.originRunId);
    const reworkRootRunId = asString(payload.reworkRootRunId);
    const relatedRunIds = [
      ...new Set([
        ...current.relatedRunIds,
        ...(eventRunId ? [eventRunId] : []),
        ...(originRunId ? [originRunId] : []),
      ]),
    ];
    const relatedRootRunIds = [
      ...new Set([
        ...current.relatedRootRunIds,
        ...(eventRootRunId ? [eventRootRunId] : []),
        ...(reworkRootRunId ? [reworkRootRunId] : []),
      ]),
    ];
    if (event.event_type === WORKSPACE_LEASE_SNAPSHOT_EVENT) {
      const changedPaths = asStringArray(payload.changedPaths);
      const files = asDiffFiles(payload.files);
      byLease.set(leaseId, {
        ...current,
        runId: eventRunId ?? current.runId,
        relatedRunIds,
        relatedRootRunIds,
        status: workspaceLeaseStatusFromEvent(
          lifecycleStatus,
          current.status,
          payload,
          event.event_type,
        ),
        phase: asString(payload.phase) ?? current.phase,
        reason: asString(payload.reason) ?? current.reason,
        changedPaths: changedPaths.length > 0 ? changedPaths : current.changedPaths,
        files: files.length > 0 ? files : current.files,
        conflicts:
          asStringArray(payload.conflicts).length > 0
            ? asStringArray(payload.conflicts)
            : current.conflicts,
        loopAttempt: asNumber(payload.loopAttempt) ?? current.loopAttempt,
        loopMaxAttempts: asNumber(payload.loopMaxAttempts) ?? current.loopMaxAttempts,
        verificationSummary: asString(payload.verificationSummary) ?? current.verificationSummary,
        verificationPassed:
          typeof payload.verificationPassed === 'boolean'
            ? payload.verificationPassed
            : current.verificationPassed,
        terminationReason: asString(payload.terminationReason) ?? current.terminationReason,
      });
      continue;
    }
    if (event.event_type === WORKSPACE_LEASE_ACTION_EVENT) {
      const action = asString(payload.action);
      const review = asReviewWorkbenchState(payload.review);
      byLease.set(leaseId, {
        ...current,
        relatedRunIds,
        relatedRootRunIds,
        status: workspaceLeaseStatusFromEvent(
          lifecycleStatus,
          current.status,
          payload,
          event.event_type,
        ),
        phase: action ?? current.phase,
        reason: asString(payload.reason) ?? current.reason,
        lastAction: action,
        lastActionError: asString(payload.error),
        review: review ?? current.review,
      });
    }
  }
  return [...byLease.values()]
    .filter((row) => !rootRunId || row.relatedRootRunIds.includes(rootRunId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function workspaceLeaseStatusFromEvent(
  lifecycleStatus: WorkspaceLeaseReviewRow['status'],
  currentStatus: WorkspaceLeaseReviewRow['status'],
  payload: Record<string, unknown>,
  eventType: string,
): WorkspaceLeaseReviewRow['status'] {
  if (
    lifecycleStatus === 'merged' ||
    lifecycleStatus === 'discarded' ||
    lifecycleStatus === 'failed'
  ) {
    return lifecycleStatus;
  }
  const action = eventType === WORKSPACE_LEASE_ACTION_EVENT ? asString(payload.action) : null;
  const phase = asString(payload.phase);
  const eventStatus = asString(payload.status);
  if (action?.endsWith('_failed') || eventStatus === 'failed') return 'failed';
  if (
    phase === 'planned' ||
    phase === 'pending_review' ||
    phase === 'verification_terminated'
  ) {
    return 'pending_review';
  }
  if (
    eventStatus === 'active' ||
    eventStatus === 'pending_review' ||
    eventStatus === 'merged' ||
    eventStatus === 'discarded'
  ) {
    return eventStatus;
  }
  return currentStatus;
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
