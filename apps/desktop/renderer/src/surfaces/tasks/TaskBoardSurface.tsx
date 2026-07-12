import { useUiState } from '@/app/ui-state.js';
import { conversationRunController } from '@/assistant/runtime/conversation-run-controller.js';
import { useInterruptedRunRecovery } from '@/assistant/runtime/conversation-run-react.js';
import { useCompanyEmployees } from '@/data/queries.js';
import { Select, type SelectOption } from '@/design-system/grammar/Select.js';
import { cn } from '@/lib/utils.js';
import { getRepos } from '@/runtime/repos.js';
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  errorDetail,
} from '@/surfaces/shared/SurfaceStates.js';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Clock3,
  Eye,
  ListChecks,
  Pause,
  Search,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DiffPanel } from './DiffPanel.js';
import { InterruptedRunCardView } from './InterruptedRunCardView.js';
import {
  type TaskBoardChildRow,
  type TaskBoardRow,
  type TaskBoardStatus,
  type WorkspaceLeaseReviewRow,
  filterTaskRows,
  flattenTaskRows,
  useProjectLeaseStatusMap,
  useProjectWorkspaceLeaseReviews,
  useTaskBoard,
} from './task-board-data.js';
import {
  appendWorkspaceLeaseAction,
  requestWorkspaceLeaseChanges,
  reviewWorkspaceLease,
} from './workspace-lease-actions.js';

const ROW_HEIGHT = 54;
const STATUS_OPTIONS: ReadonlyArray<SelectOption> = [
  { value: 'all', label: 'All statuses' },
  { value: 'running', label: 'Running' },
  { value: 'pending_review', label: 'Pending review' },
  { value: 'merged', label: 'Merged' },
  { value: 'discarded', label: 'Discarded' },
  { value: 'interrupted', label: 'Interrupted' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function statusLabel(status: TaskBoardStatus): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'pending_review':
      return 'Pending review';
    case 'merged':
      return 'Merged';
    case 'discarded':
      return 'Discarded';
    case 'interrupted':
      return 'Interrupted';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
  }
}

function taskStatusFromLease(
  status: WorkspaceLeaseReviewRow['status'] | undefined,
  fallback: TaskBoardStatus,
): TaskBoardStatus {
  return status === 'active' ? 'running' : (status ?? fallback);
}

function formatWhen(value: string | null): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function summarizeUsage(usageJson: string | null): string {
  if (!usageJson) return 'No usage yet';
  try {
    const value = JSON.parse(usageJson) as Record<string, unknown>;
    const total =
      value.totalTokens ??
      value.total_tokens ??
      value.tokens ??
      value.outputTokens ??
      value.output_tokens;
    return typeof total === 'number' ? `${total.toLocaleString()} tokens` : 'Usage recorded';
  } catch {
    return 'Usage recorded';
  }
}

function employeeName(
  row: TaskBoardRow | TaskBoardChildRow,
  employeeNames: Map<string, string>,
): string {
  if (!row.employeeId) return 'Team run';
  return employeeNames.get(row.employeeId) ?? row.employeeId;
}

function summarizeResult(resultSummaryJson: string | null): string {
  if (!resultSummaryJson) return 'No summary yet';
  try {
    const parsed = JSON.parse(resultSummaryJson) as Record<string, unknown>;
    const summary = parsed.summary;
    return typeof summary === 'string' && summary.trim() ? summary.trim() : 'Summary recorded';
  } catch {
    return 'Summary recorded';
  }
}

function summarizePaths(paths: readonly string[]): string {
  if (paths.length === 0) return 'No changed paths recorded';
  if (paths.length <= 3) return paths.join(', ');
  return `${paths.slice(0, 3).join(', ')} +${paths.length - 3}`;
}

function StatusIcon({ status }: { status: TaskBoardStatus }) {
  if (status === 'running') return <Clock3 aria-hidden />;
  if (status === 'completed' || status === 'merged') return <CheckCircle2 aria-hidden />;
  if (status === 'pending_review') return <Eye aria-hidden />;
  if (status === 'discarded') return <Ban aria-hidden />;
  if (status === 'interrupted') return <Pause aria-hidden />;
  if (status === 'cancelled') return <Ban aria-hidden />;
  return <XCircle aria-hidden />;
}

const TASK_TITLE_MAX_CHARS = 60;

/** Row/detail headline: the objective's first sentence, capped at 60 chars with
 *  an ellipsis. The full prompt stays available via title attributes and the
 *  detail panel. */
function taskTitle(objective: string | null): string | null {
  const text = objective?.trim();
  if (!text) return null;
  const firstSegment = text.split(/\r?\n/, 1)[0] ?? text;
  const sentenceMatch = /^.*?[.。!?！？](?=\s|$)/.exec(firstSegment);
  const sentence = (sentenceMatch?.[0] ?? firstSegment).trim();
  if (sentence.length <= TASK_TITLE_MAX_CHARS) return sentence;
  return `${sentence.slice(0, TASK_TITLE_MAX_CHARS).trimEnd()}…`;
}

export function TaskBoardSurface() {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const setSurface = useUiState((s) => s.setSurface);
  const board = useTaskBoard(companyId || null);
  const leaseStatusByRunId = useProjectLeaseStatusMap(projectId || null);
  const projectLeaseReviews = useProjectWorkspaceLeaseReviews(projectId || null);
  const employees = useCompanyEmployees(companyId || null);
  const recovery = useInterruptedRunRecovery(companyId || null, {
    skipReconcile: true,
  });
  const [status, setStatus] = useState<TaskBoardStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(() => new Set());
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [busyLeaseId, setBusyLeaseId] = useState<string | null>(null);
  const [newObjective, setNewObjective] = useState('');
  const [delegateEmployeeId, setDelegateEmployeeId] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void recovery.refetch();
  }, [recovery.refetch]);

  const employeeNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const employee of employees.data ?? []) map.set(employee.id, employee.name);
    return map;
  }, [employees.data]);
  const employeeOptions = useMemo(
    () =>
      (employees.data ?? [])
        .filter((employee) => !employee.disabled)
        .map((employee) => ({ value: employee.id, label: employee.name })),
    [employees.data],
  );

  useEffect(() => {
    if (!delegateEmployeeId && employeeOptions[0]) setDelegateEmployeeId(employeeOptions[0].value);
  }, [delegateEmployeeId, employeeOptions]);

  const displayRows = useMemo(
    () =>
      board.rows.map((row) => ({
        ...row,
        status: taskStatusFromLease(leaseStatusByRunId.get(row.runId)?.status, row.status),
        children: row.children.map((child) => ({
          ...child,
          status: taskStatusFromLease(leaseStatusByRunId.get(child.runId)?.status, child.status),
        })),
      })),
    [board.rows, leaseStatusByRunId],
  );
  const filteredRows = useMemo(
    () => filterTaskRows(displayRows, { status, search }),
    [displayRows, search, status],
  );

  const visibleRows = useMemo(
    () => flattenTaskRows(filteredRows, expandedRunIds),
    [expandedRunIds, filteredRows],
  );

  const selectedRow = useMemo(
    () => visibleRows.find((item) => item.row.runId === selectedRunId)?.row ?? null,
    [selectedRunId, visibleRows],
  );
  const taskByRunId = useMemo(
    () =>
      new Map(displayRows.flatMap((row) => [row, ...row.children]).map((row) => [row.runId, row])),
    [displayRows],
  );
  const employeeByRunId = useMemo(
    () => new Map([...taskByRunId].map(([runId, row]) => [runId, row.employeeId])),
    [taskByRunId],
  );
  const leaseReviews = useMemo(
    () => ({
      ...projectLeaseReviews,
      rows: selectedRow
        ? projectLeaseReviews.rows.filter((lease) =>
            selectedRow.parentRunId
              ? lease.relatedRunIds.includes(selectedRow.runId)
              : lease.relatedRootRunIds.includes(selectedRow.rootRunId),
          )
        : [],
    }),
    [projectLeaseReviews, selectedRow],
  );

  const interruptedRunIds = useMemo(
    () => new Set(board.rows.filter((row) => row.status === 'interrupted').map((row) => row.runId)),
    [board.rows],
  );

  const recoveryCards = useMemo(
    () => recovery.cards.filter((card) => interruptedRunIds.has(card.runId)),
    [interruptedRunIds, recovery.cards],
  );

  const recoveryByRunId = useMemo(
    () => new Map(recoveryCards.map((card) => [card.runId, card])),
    [recoveryCards],
  );

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => visibleRows[index]?.row.runId ?? index,
    overscan: 8,
  });

  const refetchBoard = useCallback(async () => {
    await Promise.all([board.refetch(), recovery.refetch()]);
  }, [board, recovery]);

  const cancelRun = useCallback(
    async (row: TaskBoardRow | TaskBoardChildRow) => {
      if (!companyId) return;
      setBusyRunId(row.runId);
      try {
        if (row.parentRunId) {
          conversationRunController.stopChild(row.threadId, row.runId);
          toast.success('Task stop requested.');
          return;
        }
        conversationRunController.stop(row.threadId);
        const markCancelled = async () => {
          const latestRepos = await getRepos();
          await latestRepos.agentRuns?.updateStatus(row.runId, 'cancelled', {
            finishedAt: new Date().toISOString(),
          });
        };
        await markCancelled();
        // Pi abort/failure events can arrive late after a provider timeout. Task Board
        // Cancel is terminal, so confirm the final status past that window.
        for (const delayMs of [250, 1_000, 3_000, 10_000, 30_000, 75_000]) {
          window.setTimeout(() => {
            void markCancelled()
              .then(refetchBoard)
              .catch((err: unknown) => {
                console.warn('[task-board] failed to confirm cancelled run', {
                  runId: row.runId,
                  err,
                });
              });
          }, delayMs);
        }
        await refetchBoard();
        toast.success('Run cancelled.');
      } catch (err) {
        toast.error(errorDetail(err, 'Could not cancel the run.'));
      } finally {
        setBusyRunId(null);
      }
    },
    [companyId, refetchBoard],
  );

  const resumeRun = useCallback(
    async (runId: string) => {
      setBusyRunId(runId);
      try {
        await recovery.resume(runId);
        await refetchBoard();
        toast.success('Run resumed.');
      } catch (err) {
        toast.error(errorDetail(err, 'Could not resume the run.'));
      } finally {
        setBusyRunId(null);
      }
    },
    [recovery, refetchBoard],
  );

  const discardRun = useCallback(
    async (runId: string) => {
      setBusyRunId(runId);
      try {
        await recovery.discard(runId);
        await refetchBoard();
        toast.success('Interrupted run discarded.');
      } catch (err) {
        toast.error(errorDetail(err, 'Could not discard the run.'));
      } finally {
        setBusyRunId(null);
      }
    },
    [recovery, refetchBoard],
  );

  const recordLeaseAction = useCallback(
    async (lease: WorkspaceLeaseReviewRow, action: string, status: string, extra = {}) => {
      if (!companyId) return;
      await appendWorkspaceLeaseAction(lease, companyId, action, status, extra);
    },
    [companyId],
  );

  const runLeaseAction = useCallback(
    async (lease: WorkspaceLeaseReviewRow, action: 'merge' | 'discard') => {
      setBusyLeaseId(lease.leaseId);
      try {
        if (!companyId) return;
        const outcome = await reviewWorkspaceLease(lease, companyId, action);
        await Promise.all([leaseReviews.refetch(), refetchBoard()]);
        toast.success(
          outcome === 'merged'
            ? 'Task merged.'
            : outcome === 'discarded'
              ? 'Task discarded.'
              : 'Merge decision completed.',
        );
      } catch (err) {
        await recordLeaseAction(lease, `${action}_failed`, 'failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        await leaseReviews.refetch();
        toast.error(errorDetail(err, `Could not ${action} the task.`));
      } finally {
        setBusyLeaseId(null);
      }
    },
    [companyId, leaseReviews, recordLeaseAction, refetchBoard],
  );

  const dispatchTask = useCallback(
    async (
      objective: string,
      employeeId: string,
      lease?: WorkspaceLeaseReviewRow,
      feedback?: string,
    ) => {
      if (!companyId || !projectId || !objective.trim() || !employeeId) return;
      if (lease && feedback) {
        await requestWorkspaceLeaseChanges(lease, {
          companyId,
          projectId,
          employeeId,
          objective,
          feedback,
        });
        toast.success('Rework delegated in the same worktree.');
        await refetchBoard();
        return;
      }
      const repos = await getRepos();
      const threadId = `thread-${crypto.randomUUID()}`;
      await repos.chatThreads.create({
        thread_id: threadId,
        project_id: projectId,
        employee_id: null,
        title: 'Task Board delegation',
      });
      await conversationRunController.submit({
        companyId,
        projectId,
        threadId,
        employeeId: null,
        text: objective,
        stagedAttachments: [],
        source: 'workspace',
        directDelegation: {
          employeeId,
          objective,
          access: 'write',
          workKind: 'implement',
        },
      });
      setNewObjective('');
      toast.success('Task delegated.');
      await refetchBoard();
    },
    [companyId, projectId, refetchBoard],
  );

  const resetFilters = useCallback(() => {
    setSearch('');
    setStatus('all');
  }, []);

  const toggleExpanded = useCallback((runId: string) => {
    setExpandedRunIds((current) => {
      const next = new Set(current);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }, []);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="off-task">
      <div className="off-task-filter">
        <Select
          options={STATUS_OPTIONS}
          value={status}
          aria-label="Run status"
          onChange={(e) => setStatus(e.target.value as TaskBoardStatus | 'all')}
        />
        <div className="off-task-search">
          <Search aria-hidden className="off-task-search-ico" />
          <input
            className="off-focusable"
            value={search}
            placeholder="Search runs..."
            aria-label="Search runs"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="off-task-refresh off-focusable"
          onClick={() => void refetchBoard()}
        >
          Refresh
        </button>
      </div>
      <div className="off-task-dispatch" aria-label="Delegate a new task">
        <input
          className="off-focusable"
          value={newObjective}
          placeholder="Insert a task objective…"
          aria-label="New task objective"
          onChange={(event) => setNewObjective(event.target.value)}
        />
        <Select
          options={employeeOptions}
          value={delegateEmployeeId}
          aria-label="Task assignee"
          onChange={(event) => setDelegateEmployeeId(event.target.value)}
        />
        <button
          type="button"
          className="off-task-action is-primary off-focusable"
          disabled={!newObjective.trim() || !delegateEmployeeId}
          onClick={() => void dispatchTask(newObjective, delegateEmployeeId)}
        >
          Delegate
        </button>
      </div>

      <div className="off-task-stats" aria-label="Task board overview">
        <div className="off-task-stat">
          <span className="off-task-stat-v">{board.stats.running}</span>
          <span className="off-task-stat-l">Running</span>
        </div>
        <div className="off-task-stat is-interrupted">
          <span className="off-task-stat-v">{board.stats.interrupted}</span>
          <span className="off-task-stat-l">Interrupted</span>
        </div>
        <div className="off-task-stat">
          <span className="off-task-stat-v">{board.stats.completed}</span>
          <span className="off-task-stat-l">Completed</span>
        </div>
        <div className="off-task-stat is-muted">
          <span className="off-task-stat-v">{board.stats.total}</span>
          <span className="off-task-stat-l">Total tasks</span>
        </div>
      </div>

      {recoveryCards.length > 0 ? (
        <div className="off-task-recovery-strip" aria-label="Interrupted run recovery">
          {recoveryCards.map((card) => (
            <InterruptedRunCardView
              key={card.runId}
              card={card}
              selected={selectedRunId === card.runId}
              busy={busyRunId === card.runId}
              onResume={() => void resumeRun(card.runId)}
              onDiscard={() => void discardRun(card.runId)}
              onViewPartial={() => setSelectedRunId(card.runId)}
            />
          ))}
        </div>
      ) : null}

      {board.isError && board.rows.length === 0 ? (
        <div className="off-task-empty-wrap">
          <ErrorState
            title="Couldn't load tasks"
            detail={errorDetail(board.error, 'The task board failed to load.')}
            onRetry={() => void refetchBoard()}
          />
        </div>
      ) : board.isLoading && board.rows.length === 0 ? (
        <div className="off-task-empty-wrap">
          <SkeletonRows rows={8} />
        </div>
      ) : board.rows.length === 0 ? (
        <div className="off-task-empty-wrap">
          <EmptyState
            icon={ListChecks}
            title="No agent runs yet"
            description="Runs appear here once work starts in Office or Connect."
            action={{ label: 'Open Office', onClick: () => setSurface('office') }}
          />
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="off-task-empty-wrap">
          <EmptyState
            icon={Search}
            title="No runs match your filters"
            description="Try a different status or search term."
            action={{ label: 'Reset filters', onClick: resetFilters }}
          />
        </div>
      ) : (
        <div className={cn('off-task-body', selectedRow && 'is-split')}>
          <div className="off-task-list" ref={scrollRef}>
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualItems.map((vi) => {
                const item = visibleRows[vi.index];
                if (!item) return null;
                const row = item.row;
                const selected = row.runId === selectedRunId;
                const card = recoveryByRunId.get(row.runId);
                const isRoot = item.level === 0;
                const expandable = isRoot && item.childCount > 0;
                const expanded = expandable && expandedRunIds.has(row.runId);
                return (
                  <div
                    key={row.runId}
                    className={cn('off-task-row', selected && 'is-selected', !isRoot && 'is-child')}
                    style={{
                      position: 'absolute',
                      top: 0,
                      transform: `translateY(${vi.start}px)`,
                      width: '100%',
                    }}
                  >
                    <button
                      type="button"
                      className="off-task-tree-toggle off-focusable"
                      disabled={!expandable}
                      title={expanded ? 'Collapse child runs' : 'Expand child runs'}
                      onClick={() => toggleExpanded(row.runId)}
                    >
                      {expandable ? (
                        expanded ? (
                          <ChevronDown aria-hidden />
                        ) : (
                          <ChevronRight aria-hidden />
                        )
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="off-task-row-main off-focusable"
                      onClick={() => setSelectedRunId(selected ? null : row.runId)}
                    >
                      <span className={cn('off-task-badge', `is-${row.status}`)}>
                        <StatusIcon status={row.status} />
                        {statusLabel(row.status)}
                      </span>
                      <span className="off-task-title" title={row.objective ?? undefined}>
                        {!isRoot && row.relation ? `${row.relation}: ` : ''}
                        {taskTitle(row.objective) || `${employeeName(row, employeeNames)} run`}
                      </span>
                      <span className="off-task-meta">
                        {employeeName(row, employeeNames)} · {formatWhen(row.startedAt)}
                        {!isRoot && row.access ? ` · ${row.access}` : ''}
                        {isRoot && item.childCount > 0 ? ` · ${item.childCount} child runs` : ''}
                        {row.live ? ' · live' : ''}
                      </span>
                    </button>
                    <div className="off-task-row-actions">
                      <button
                        type="button"
                        className="off-task-icon-btn off-focusable"
                        onClick={() => setSelectedRunId(row.runId)}
                        title="View partial run detail"
                      >
                        <Eye aria-hidden />
                      </button>
                      {row.status === 'running' ? (
                        <button
                          type="button"
                          className="off-task-action is-danger off-focusable"
                          disabled={busyRunId === row.runId}
                          onClick={() => void cancelRun(row)}
                        >
                          <CircleStop aria-hidden />
                          Stop
                        </button>
                      ) : isRoot && row.status === 'interrupted' && card ? (
                        <button
                          type="button"
                          className="off-task-action is-primary off-focusable"
                          disabled={busyRunId === row.runId}
                          onClick={() => void resumeRun(row.runId)}
                        >
                          Resume
                        </button>
                      ) : row.status === 'failed' || row.status === 'cancelled' ? (
                        <button
                          type="button"
                          className="off-task-action is-primary off-focusable"
                          disabled={!row.objective || !(row.employeeId || delegateEmployeeId)}
                          onClick={() =>
                            void dispatchTask(
                              row.objective ?? '',
                              row.employeeId ?? delegateEmployeeId,
                            )
                          }
                        >
                          Re-delegate
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedRow ? (
            <aside className="off-task-detail" aria-label="Run detail">
              <div className="off-task-detail-head">
                <div>
                  <div className="off-task-detail-kicker">{statusLabel(selectedRow.status)}</div>
                  <h2>{taskTitle(selectedRow.objective) || 'Agent run'}</h2>
                </div>
                <button
                  type="button"
                  className="off-task-icon-btn off-focusable"
                  onClick={() => setSelectedRunId(null)}
                  title="Close run detail"
                >
                  <XCircle aria-hidden />
                </button>
              </div>
              {selectedRow.objective ? (
                <p className="off-task-detail-objective">{selectedRow.objective}</p>
              ) : null}
              <dl className="off-task-detail-grid">
                <div>
                  <dt>Owner</dt>
                  <dd>{employeeName(selectedRow, employeeNames)}</dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>{formatWhen(selectedRow.startedAt)}</dd>
                </div>
                <div>
                  <dt>Finished</dt>
                  <dd>{formatWhen(selectedRow.finishedAt)}</dd>
                </div>
                <div>
                  <dt>Usage</dt>
                  <dd>{summarizeUsage(selectedRow.usageJson)}</dd>
                </div>
                <div>
                  <dt>Summary</dt>
                  <dd>{summarizeResult(selectedRow.resultSummaryJson)}</dd>
                </div>
              </dl>
              <details className="off-task-detail-tech">
                <summary>Technical details</summary>
                <dl className="off-task-detail-grid">
                  <div>
                    <dt>Run</dt>
                    <dd>{selectedRow.runId}</dd>
                  </div>
                  <div>
                    <dt>Thread</dt>
                    <dd>{selectedRow.threadId}</dd>
                  </div>
                  <div>
                    <dt>Relation</dt>
                    <dd>{selectedRow.relation || 'Root'}</dd>
                  </div>
                  <div>
                    <dt>Access</dt>
                    <dd>{selectedRow.access || 'Not recorded'}</dd>
                  </div>
                  <div>
                    <dt>Session file</dt>
                    <dd>{selectedRow.sessionFile || 'Not recorded'}</dd>
                  </div>
                </dl>
              </details>
              {recoveryByRunId.has(selectedRow.runId) ? (
                <p className="off-task-detail-note">
                  {recoveryByRunId.get(selectedRow.runId)?.whatResumeWillDo}
                </p>
              ) : null}
              <section className="off-task-lease-review" aria-label="Workspace lease review">
                <div className="off-task-lease-head">
                  <h3>Worktree review</h3>
                  <button
                    type="button"
                    className="off-task-refresh off-focusable"
                    onClick={() => void leaseReviews.refetch()}
                  >
                    Refresh
                  </button>
                </div>
                {leaseReviews.isLoading ? (
                  <p className="off-task-detail-note">Loading worktree leases...</p>
                ) : leaseReviews.rows.length === 0 ? (
                  <p className="off-task-detail-note">No delegated write worktrees recorded.</p>
                ) : (
                  <div className="off-task-lease-list">
                    {leaseReviews.rows.map((lease) => {
                      return (
                        <article className="off-task-lease" key={lease.leaseId}>
                          <div className="off-task-lease-top">
                            <span className={cn('off-task-lease-status', `is-${lease.status}`)}>
                              {lease.status}
                            </span>
                            <span className="off-task-lease-id">{lease.runId}</span>
                          </div>
                          <dl className="off-task-lease-grid">
                            <div>
                              <dt>Branch</dt>
                              <dd>{lease.branch || 'Not recorded'}</dd>
                            </div>
                            <div>
                              <dt>CWD</dt>
                              <dd>{lease.cwd || 'Not recorded'}</dd>
                            </div>
                            <div>
                              <dt>Changed paths</dt>
                              <dd>{summarizePaths(lease.changedPaths)}</dd>
                            </div>
                            <div>
                              <dt>Conflicts</dt>
                              <dd>
                                {lease.conflicts.length > 0 ? lease.conflicts.join(', ') : 'None'}
                              </dd>
                            </div>
                          </dl>
                          {lease.reason || lease.lastActionError ? (
                            <p className="off-task-lease-note">
                              {lease.lastActionError || lease.reason}
                            </p>
                          ) : null}
                          <DiffPanel
                            files={lease.files}
                            status={lease.status}
                            busy={busyLeaseId === lease.leaseId}
                            onMerge={() => void runLeaseAction(lease, 'merge')}
                            onDiscard={() => void runLeaseAction(lease, 'discard')}
                            onRequestChanges={(feedback) =>
                              void dispatchTask(
                                taskByRunId.get(lease.runId)?.objective ??
                                  selectedRow.objective ??
                                  'Continue the delegated task.',
                                employeeByRunId.get(lease.runId) ?? delegateEmployeeId,
                                lease,
                                feedback,
                              )
                            }
                          />
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}
