import {
  useActiveConversationRuns,
} from '@/assistant/runtime/conversation-run-react.js';
import type { ConversationRunPhase } from '@/assistant/runtime/conversation-run-controller.js';
import { missionRunManager } from '@/runtime/mission/mission-run-manager.js';
import { getRepos } from '@/runtime/repos.js';
import type { AgentRunRow } from '@offisim/core/browser';
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
  employeeId: string | null;
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
    projectId: null,
    employeeId: row.employee_id,
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
  };
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

function sortRows(a: TaskBoardRow, b: TaskBoardRow): number {
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
      return rows.filter((row) => row.run_id === row.root_run_id).map(rowFromAgentRun);
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
        employeeId: snapshot.employeeId,
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
    return [
      row.runId,
      row.threadId,
      row.employeeId ?? '',
      row.objective ?? '',
      row.status,
      row.source ?? '',
    ].some((value) => value.toLowerCase().includes(q));
  });
}
