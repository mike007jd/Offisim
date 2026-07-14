import { useUiState } from '@/app/ui-state.js';
import { conversationRunController } from '@/assistant/runtime/conversation-run-controller.js';
import { useInterruptedRunRecovery } from '@/assistant/runtime/conversation-run-react.js';
import { useCompanyEmployees, useProjects } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import {
  type UsageTokenSummary,
  combineUsageTokenSummaries,
  formatUsageTokens,
  summarizeUsageTokens,
} from '@/data/usage-token-coverage.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { getRepos } from '@/runtime/repos.js';
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  errorDetail,
} from '@/surfaces/shared/SurfaceStates.js';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Columns3,
  GitCompareArrows,
  History,
  Link2,
  Play,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  type ActivityRecord,
  collapseReroutes,
  domainIcon,
  formatRelativeTimestamp,
  getDisplaySummary,
  getEventLevel,
  groupByTime,
  useActivityRecords,
} from './activity-data.js';
import {
  type TaskBoardRow,
  type TaskBoardStatus,
  type WorkspaceLeaseReviewRow,
  useProjectWorkspaceLeaseReviews,
  useTaskBoard,
  workspaceLeaseReviewsQueryOptions,
} from './task-board-data.js';
import { useWorkspaceLeaseDecisionVersion } from './use-workspace-lease-decision.js';
import {
  type WorkspaceLeaseReviewOutcome,
  appendWorkspaceLeaseAction,
  requestWorkspaceLeaseChanges,
  reviewWorkspaceLease,
  workspaceLeaseDecisionAction,
} from './workspace-lease-actions.js';

type BoardColumnId = 'running' | 'pending_review' | 'done' | 'attention';

interface BoardColumn {
  id: BoardColumnId;
  title: string;
  detail: string;
  statuses: readonly TaskBoardStatus[];
}

const BOARD_COLUMNS: readonly BoardColumn[] = [
  { id: 'running', title: 'Running', detail: 'Work in progress', statuses: ['running'] },
  {
    id: 'pending_review',
    title: 'Pending review',
    detail: 'Waiting for your decision',
    statuses: ['pending_review'],
  },
  {
    id: 'done',
    title: 'Done',
    detail: 'Merged and completed',
    statuses: ['merged', 'completed'],
  },
  {
    id: 'attention',
    title: 'Needs attention',
    detail: 'Failed, cancelled, or interrupted',
    statuses: ['failed', 'cancelled', 'interrupted'],
  },
];

const TITLE_MAX = 88;

function taskTitle(objective: string | null): string {
  const text = objective?.trim();
  if (!text) return 'Untitled request';
  const firstLine = text.split(/\r?\n/, 1)[0] ?? text;
  const sentence = (/^.*?[.。!?！？](?=\s|$)/.exec(firstLine)?.[0] ?? firstLine).trim();
  return sentence.length > TITLE_MAX ? `${sentence.slice(0, TITLE_MAX).trimEnd()}…` : sentence;
}

function tokenCount(
  usageJson: string | null,
): UsageTokenSummary & { includesChildren: boolean; recorded: boolean } {
  if (!usageJson) {
    return {
      knownTokens: 0,
      coverage: 'unavailable',
      includesChildren: false,
      recorded: false,
    };
  }
  try {
    const usage = JSON.parse(usageJson) as Record<string, unknown>;
    const scope = usage.scope as Record<string, unknown> | undefined;
    return {
      ...summarizeUsageTokens(usage),
      includesChildren: scope?.kind === 'task-aggregate',
      recorded: true,
    };
  } catch {
    return {
      knownTokens: 0,
      coverage: 'unavailable',
      includesChildren: false,
      recorded: true,
    };
  }
}

function rowTokens(row: TaskBoardRow): UsageTokenSummary {
  const root = tokenCount(row.usageJson);
  if (root.includesChildren) return root;
  return combineUsageTokenSummaries(
    [root, ...row.children.map((child) => tokenCount(child.usageJson))].filter(
      (summary) => summary.recorded,
    ),
  );
}

function completedChildren(row: TaskBoardRow): number {
  return row.children.filter((child) => ['completed', 'merged', 'discarded'].includes(child.status))
    .length;
}

function leasesForRow(row: TaskBoardRow, leases: readonly WorkspaceLeaseReviewRow[]) {
  return leases.filter((lease) => lease.relatedRootRunIds.includes(row.rootRunId));
}

function effectiveStatus(
  row: TaskBoardRow,
  leases: readonly WorkspaceLeaseReviewRow[],
): TaskBoardStatus {
  const related = leasesForRow(row, leases);
  if (related.some((lease) => lease.status === 'pending_review')) return 'pending_review';
  if (related.some((lease) => lease.status === 'failed')) return 'failed';
  if (row.status === 'running' || related.some((lease) => lease.status === 'active'))
    return 'running';
  if (related.length > 0 && related.every((lease) => lease.status === 'merged')) return 'merged';
  return row.status;
}

function countDiffLines(files: readonly { diff: string }[]) {
  let added = 0;
  let removed = 0;
  for (const file of files) {
    for (const line of file.diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
      if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
    }
  }
  return { added, removed };
}

function toastLeaseOutcomes(
  outcomes: readonly WorkspaceLeaseReviewOutcome[],
  failedCount = 0,
): void {
  const merged = outcomes.filter((outcome) => outcome === 'merged').length;
  const discarded = outcomes.filter((outcome) => outcome === 'discarded').length;
  const hostResolved = outcomes.filter((outcome) => outcome === 'host_resolved').length;
  const parts = [
    merged ? `${merged} merged` : '',
    discarded ? `${discarded} discarded` : '',
    hostResolved ? `${hostResolved} completed by Pi` : '',
    failedCount ? `${failedCount} failed` : '',
  ].filter(Boolean);
  const message = `Lease decision: ${parts.join(', ')}.`;
  if (failedCount > 0 || parts.length > 1) toast.warning(message);
  else toast.success(message);
}

export function BoardStage() {
  useWorkspaceLeaseDecisionVersion();
  const companyId = useUiState((state) => state.companyId);
  const projectId = useUiState((state) => state.projectId);
  const requestThreadFocus = useUiState((state) => state.requestThreadFocus);
  const openStageView = useUiState((state) => state.openStageView);
  const highlightedRunId = useUiState((state) => state.boardHighlightedRunId);
  const highlightBoardRun = useUiState((state) => state.highlightBoardRun);
  const lens = useUiState((state) => state.boardLens);
  const setLens = useUiState((state) => state.setBoardLens);
  const board = useTaskBoard(companyId || null);
  const employees = useCompanyEmployees(companyId || null);
  const projects = useProjects(companyId || null);
  const projectIds = useMemo(
    () => (projects.data ?? []).map((project) => project.id),
    [projects.data],
  );
  const leaseQuery = useQuery(workspaceLeaseReviewsQueryOptions(projectIds));
  const recovery = useInterruptedRunRecovery(companyId || null, { skipReconcile: true });
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    void recovery.refetch();
  }, [recovery.refetch]);

  useEffect(() => {
    if (!highlightedRunId) return;
    const highlightedRow = board.rows.find((row) => row.runId === highlightedRunId);
    if (!highlightedRow) return;
    const highlightedScope = highlightedRow.projectId === projectId ? 'project' : 'company';
    if (highlightedScope === 'company') {
      highlightBoardRun(null);
      return;
    }
    setSelectedRunId(highlightedRunId);
    const timer = window.setTimeout(() => highlightBoardRun(null), 4_500);
    return () => window.clearTimeout(timer);
  }, [board.rows, highlightBoardRun, highlightedRunId, projectId]);

  const employeeById = useMemo(
    () => new Map((employees.data ?? []).map((employee) => [employee.id, employee])),
    [employees.data],
  );
  const allLeases = leaseQuery.data ?? [];
  const scopedRows = useMemo(
    () =>
      board.rows
        .filter((row) => row.projectId === projectId)
        .map((row) => ({ ...row, status: effectiveStatus(row, allLeases) }))
        .filter((row) => row.status !== 'discarded'),
    [allLeases, board.rows, projectId],
  );
  const selectedRow = scopedRows.find((row) => row.runId === selectedRunId) ?? null;
  const selectedLeases = selectedRow ? leasesForRow(selectedRow, allLeases) : [];
  const hasPendingDecision = (leases: readonly WorkspaceLeaseReviewRow[]) =>
    leases.some((lease) => workspaceLeaseDecisionAction(lease.leaseId) !== null);

  const refresh = useCallback(async () => {
    await Promise.all([board.refetch(), leaseQuery.refetch(), recovery.refetch()]);
  }, [board, leaseQuery, recovery]);

  const retry = useCallback(
    async (row: TaskBoardRow) => {
      if (!companyId || !row.projectId || !row.objective) return;
      const employeeId =
        row.children.find((child) => child.employeeId)?.employeeId ?? row.employeeId ?? null;
      if (!employeeId) {
        toast.error('No previous assignee is available for this request.');
        return;
      }
      setBusyId(row.runId);
      try {
        const repos = await getRepos();
        const threadId = `thread-${crypto.randomUUID()}`;
        await repos.chatThreads.create({
          thread_id: threadId,
          project_id: row.projectId,
          employee_id: null,
          title: 'Board retry',
        });
        await conversationRunController.submit({
          companyId,
          projectId: row.projectId,
          threadId,
          employeeId: null,
          text: row.objective,
          stagedAttachments: [],
          source: 'workspace',
          directDelegation: {
            employeeId,
            objective: row.objective,
            access: 'write',
            workKind: 'implement',
          },
        });
        toast.success('Request re-delegated.');
        await refresh();
      } catch (error) {
        toast.error(errorDetail(error, 'Could not retry the request.'));
      } finally {
        setBusyId(null);
      }
    },
    [companyId, refresh],
  );

  const discard = useCallback(
    async (row: TaskBoardRow) => {
      const rowLeases = leasesForRow(row, allLeases);
      if (rowLeases.some((lease) => lease.status === 'active')) {
        toast.error('Stop the active task before discarding this request.');
        return;
      }
      setBusyId(row.runId);
      try {
        const leases = rowLeases.filter((lease) =>
          ['pending_review', 'failed'].includes(lease.status),
        );
        const outcomes: WorkspaceLeaseReviewOutcome[] = [];
        if (leases.length > 0 && companyId) {
          for (const lease of leases) {
            outcomes.push(await reviewWorkspaceLease(lease, companyId, 'discard'));
          }
        } else if (
          row.status === 'interrupted' &&
          recovery.cards.some((card) => card.runId === row.runId)
        ) {
          await recovery.discard(row.runId);
        } else {
          const repos = await getRepos();
          await repos.agentRuns.updateStatus(row.runId, 'discarded', {
            finishedAt: new Date().toISOString(),
          });
        }
        if (outcomes.length > 0) toastLeaseOutcomes(outcomes);
        else toast.success('Request discarded.');
        if (selectedRunId === row.runId) setSelectedRunId(null);
        await refresh();
      } catch (error) {
        const detail =
          typeof error === 'string' && error.trim()
            ? error.trim()
            : errorDetail(error, 'Could not discard the request.');
        toast.error(
          detail.includes('still owned by an active task')
            ? 'Stop the active task before discarding this request.'
            : detail,
        );
      } finally {
        setBusyId(null);
      }
    },
    [allLeases, companyId, recovery, refresh, selectedRunId],
  );

  const decideLeases = useCallback(
    async (action: 'merge' | 'discard') => {
      if (!companyId || !selectedRow) return;
      const actionable = selectedLeases.filter((lease) => lease.status === 'pending_review');
      if (actionable.length === 0) return;
      setBusyId(selectedRow.runId);
      const succeeded: Array<{
        lease: WorkspaceLeaseReviewRow;
        outcome: WorkspaceLeaseReviewOutcome;
      }> = [];
      const failed: Array<{ lease: WorkspaceLeaseReviewRow; error: unknown }> = [];
      let outcomeRecordingError: unknown = null;
      try {
        for (const lease of actionable) {
          try {
            const outcome = await reviewWorkspaceLease(lease, companyId, action);
            succeeded.push({ lease, outcome });
          } catch (error) {
            failed.push({ lease, error });
            try {
              await appendWorkspaceLeaseAction(lease, companyId, `${action}_failed`, 'failed', {
                error: error instanceof Error ? error.message : String(error),
              });
            } catch (recordError) {
              outcomeRecordingError = recordError;
            }
          }
        }
        if (outcomeRecordingError) {
          toast.error(
            errorDetail(
              outcomeRecordingError,
              'A lease failed and its failure outcome could not be recorded.',
            ),
          );
        } else if (failed.length === 0) {
          toastLeaseOutcomes(succeeded.map((result) => result.outcome));
        } else if (succeeded.length > 0) {
          toastLeaseOutcomes(
            succeeded.map((result) => result.outcome),
            failed.length,
          );
        } else {
          toast.error(
            errorDetail(failed[0]?.error, `Could not ${action} any lease in this request.`),
          );
        }
        if (failed.length > 0) return;
        setSelectedRunId(null);
      } finally {
        await refresh();
        setBusyId(null);
      }
    },
    [companyId, refresh, selectedLeases, selectedRow],
  );

  const requestChanges = useCallback(async () => {
    if (!companyId || !selectedRow || !feedback.trim()) return;
    const actionable = selectedLeases.filter((lease) => lease.status === 'pending_review');
    setBusyId(selectedRow.runId);
    try {
      for (const lease of actionable) {
        const child = selectedRow.children.find((candidate) =>
          lease.relatedRunIds.includes(candidate.runId),
        );
        const employeeId = child?.employeeId ?? selectedRow.employeeId;
        if (!lease.projectId || !employeeId)
          throw new Error('The delegated lease has no assignee.');
        await requestWorkspaceLeaseChanges(lease, {
          companyId,
          projectId: lease.projectId,
          employeeId,
          objective: child?.objective ?? selectedRow.objective ?? 'Continue the delegated request.',
          feedback: feedback.trim(),
        });
      }
      setFeedback('');
      toast.success('Rework delegated in the existing worktree.');
      setSelectedRunId(null);
      await refresh();
    } catch (error) {
      toast.error(errorDetail(error, 'Could not send the request back for rework.'));
    } finally {
      setBusyId(null);
    }
  }, [companyId, feedback, refresh, selectedLeases, selectedRow]);

  return (
    <div className="off-board-stage">
      <header className="off-board-toolbar">
        <div className="off-board-segment" aria-label="Board lens">
          <button
            className={cn('off-focusable', lens === 'board' && 'is-active')}
            type="button"
            onClick={() => setLens('board')}
          >
            <Icon icon={Columns3} size="sm" />
            Board
          </button>
          <button
            className={cn('off-focusable', lens === 'timeline' && 'is-active')}
            type="button"
            onClick={() => setLens('timeline')}
          >
            <Icon icon={History} size="sm" />
            Timeline
          </button>
        </div>
        <span className="off-board-scope-note">
          {lens === 'timeline' ? 'Company-wide timeline' : `${scopedRows.length} requests`}
        </span>
      </header>

      {lens === 'timeline' ? (
        <BoardTimeline companyId={companyId} />
      ) : board.isError && scopedRows.length === 0 ? (
        <ErrorState
          title="Couldn't load the board"
          detail={errorDetail(board.error, 'Agent runs could not be read.')}
          onRetry={() => void refresh()}
        />
      ) : board.isLoading && scopedRows.length === 0 ? (
        <SkeletonRows rows={8} />
      ) : scopedRows.length === 0 ? (
        <EmptyState
          icon={Columns3}
          title="No requests yet"
          description="Requests for this project appear here as soon as work starts. Company-wide history lives in Timeline."
        />
      ) : (
        <div className={cn('off-board-body', selectedRow && 'is-drawer-open')}>
          <div className="off-board-columns">
            {BOARD_COLUMNS.map((column) => {
              const rows = scopedRows.filter((row) => column.statuses.includes(row.status));
              return (
                <section className={cn('off-board-column', `is-${column.id}`)} key={column.id}>
                  <header>
                    <span>{column.title}</span>
                    <b>{rows.length}</b>
                    <small>{column.detail}</small>
                  </header>
                  <div className="off-board-card-list">
                    {rows.map((row) => (
                      <BoardCard
                        key={row.runId}
                        row={row}
                        leases={leasesForRow(row, allLeases)}
                        employeeById={employeeById}
                        selected={selectedRunId === row.runId}
                        highlighted={highlightedRunId === row.runId}
                        busy={
                          busyId === row.runId || hasPendingDecision(leasesForRow(row, allLeases))
                        }
                        onSelect={() => setSelectedRunId(row.runId)}
                        onThread={() => {
                          if (!row.projectId) {
                            toast.error('The source conversation has no project binding.');
                            return;
                          }
                          requestThreadFocus({ projectId: row.projectId, threadId: row.threadId });
                        }}
                        onRetry={() => void retry(row)}
                        onDiscard={() => void discard(row)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          {selectedRow ? (
            <BoardDrawer
              row={selectedRow}
              leases={selectedLeases}
              employeeById={employeeById}
              busy={busyId === selectedRow.runId || hasPendingDecision(selectedLeases)}
              feedback={feedback}
              onFeedback={setFeedback}
              onClose={() => setSelectedRunId(null)}
              onOpenDiff={(lease, path) =>
                openStageView({
                  kind: 'changes',
                  leaseId: lease.leaseId,
                  path,
                  files: lease.files,
                  status: lease.status,
                })
              }
              onMerge={() => void decideLeases('merge')}
              onRequestChanges={() => void requestChanges()}
              onDiscard={() => void decideLeases('discard')}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

/** One-shot pending-review reveal. The first loaded snapshot seeds the seen set;
 * only a lease that subsequently enters pending_review can move passive Game View. */
export function BoardPendingReviewAutoOpen() {
  const projectId = useUiState((state) => state.projectId);
  const stagePrimaryTab = useUiState((state) => state.stagePrimaryTab);
  const setStagePrimaryTab = useUiState((state) => state.setStagePrimaryTab);
  const highlightBoardRun = useUiState((state) => state.highlightBoardRun);
  const reviews = useProjectWorkspaceLeaseReviews(projectId || null);
  const seen = useRef<{ projectId: string; leaseIds: Set<string> } | null>(null);

  useEffect(() => {
    if (!projectId || reviews.isLoading) return;
    const pending = reviews.rows.filter((lease) => lease.status === 'pending_review');
    if (seen.current?.projectId !== projectId) {
      seen.current = { projectId, leaseIds: new Set(pending.map((lease) => lease.leaseId)) };
      return;
    }
    const fresh = pending.find((lease) => !seen.current?.leaseIds.has(lease.leaseId));
    for (const lease of pending) seen.current.leaseIds.add(lease.leaseId);
    if (!fresh || stagePrimaryTab !== 'game') return;
    highlightBoardRun(fresh.rootRunId);
    setStagePrimaryTab('board');
  }, [
    highlightBoardRun,
    projectId,
    reviews.isLoading,
    reviews.rows,
    setStagePrimaryTab,
    stagePrimaryTab,
  ]);

  return null;
}

function BoardCard({
  row,
  leases,
  employeeById,
  selected,
  highlighted,
  busy,
  onSelect,
  onThread,
  onRetry,
  onDiscard,
}: {
  row: TaskBoardRow;
  leases: readonly WorkspaceLeaseReviewRow[];
  employeeById: Map<string, Employee>;
  selected: boolean;
  highlighted: boolean;
  busy: boolean;
  onSelect: () => void;
  onThread: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const employeeIds = [
    ...new Set(
      [...row.children.map((child) => child.employeeId), row.employeeId].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ].slice(0, 4);
  const isAttention = ['failed', 'cancelled', 'interrupted'].includes(row.status);
  const hasActiveLease = leases.some((lease) => lease.status === 'active');
  return (
    <article
      className={cn(
        'off-board-card',
        selected && 'is-selected',
        highlighted && 'is-highlighted',
        row.live && 'is-live',
      )}
    >
      <div className="off-board-card-main">
        <button type="button" className="off-board-card-open off-focusable" onClick={onSelect}>
          <span className="off-board-card-title">{taskTitle(row.objective)}</span>
        </button>
        <button type="button" className="off-board-card-source off-focusable" onClick={onThread}>
          <Icon icon={Link2} size="sm" />
          {row.threadId.slice(0, 12)} · {row.source ?? 'office'}
        </button>
        <span className="off-board-card-foot">
          <span className="off-board-avatars">
            {employeeIds.map((id) => {
              const employee = employeeById.get(id);
              return employee ? (
                <EmployeeAvatar
                  key={id}
                  seed={employee.id}
                  colorA={employee.avatarA}
                  colorB={employee.avatarB}
                  appearance={employee.appearance}
                  brand={employee.kind === 'external'}
                  size={24}
                />
              ) : (
                <span key={id} className="off-board-avatar-fallback">
                  {id.slice(0, 1).toUpperCase()}
                </span>
              );
            })}
          </span>
          <span>
            {completedChildren(row)}/{row.children.length} subtasks
          </span>
          <span>{formatUsageTokens(rowTokens(row))}</span>
          {row.live ? <span className="off-board-live">live</span> : null}
        </span>
      </div>
      {isAttention ? (
        <div className="off-board-card-actions">
          <button
            type="button"
            className="off-focusable"
            disabled={busy || !row.objective}
            onClick={onRetry}
          >
            <Icon icon={RotateCcw} size="sm" />
            Retry
          </button>
          <button
            type="button"
            className="off-focusable is-danger"
            disabled={busy || hasActiveLease}
            title={
              hasActiveLease ? 'Stop the active task before discarding this request.' : undefined
            }
            onClick={onDiscard}
          >
            <Icon icon={Trash2} size="sm" />
            Discard
          </button>
        </div>
      ) : null}
    </article>
  );
}

function BoardDrawer({
  row,
  leases,
  employeeById,
  busy,
  feedback,
  onFeedback,
  onClose,
  onOpenDiff,
  onMerge,
  onRequestChanges,
  onDiscard,
}: {
  row: TaskBoardRow;
  leases: readonly WorkspaceLeaseReviewRow[];
  employeeById: Map<string, Employee>;
  busy: boolean;
  feedback: string;
  onFeedback: (value: string) => void;
  onClose: () => void;
  onOpenDiff: (lease: WorkspaceLeaseReviewRow, path?: string) => void;
  onMerge: () => void;
  onRequestChanges: () => void;
  onDiscard: () => void;
}) {
  const pending = leases.filter((lease) => lease.status === 'pending_review');
  const files = leases.flatMap((lease) => lease.files);
  const stats = countDiffLines(files);
  const completedCount = leases.filter((lease) =>
    ['merged', 'discarded'].includes(lease.status),
  ).length;
  const failedCount = leases.filter((lease) => lease.status === 'failed').length;
  const isPartialDecision = completedCount > 0 && failedCount > 0;
  return (
    <aside className="off-board-drawer" aria-label="Request detail">
      <header>
        <div>
          <small>{row.status.replace('_', ' ')}</small>
          <h2>{taskTitle(row.objective)}</h2>
        </div>
        <button
          type="button"
          className="off-focusable"
          onClick={onClose}
          aria-label="Close request detail"
        >
          <Icon icon={X} size="sm" />
        </button>
      </header>
      <div className="off-board-drawer-scroll">
        {isPartialDecision ? (
          <section className="off-board-verification">
            <span className="off-board-verify-status is-failed">
              <AlertTriangle aria-hidden />
              Partially completed
            </span>
            <p>
              {completedCount} lease{completedCount === 1 ? '' : 's'} completed; {failedCount} need
              attention. Successful leases were not rolled back.
            </p>
          </section>
        ) : null}
        <section>
          <h3>Subtasks</h3>
          {row.children.length === 0 ? (
            <p className="off-board-muted">This request has no delegated subtasks.</p>
          ) : (
            <div className="off-board-subtasks">
              {row.children.map((child) => {
                const employee = child.employeeId ? employeeById.get(child.employeeId) : null;
                const lease = leases.find((candidate) =>
                  candidate.relatedRunIds.includes(child.runId),
                );
                return (
                  <div className="off-board-subtask" key={child.runId}>
                    {employee ? (
                      <EmployeeAvatar
                        seed={employee.id}
                        colorA={employee.avatarA}
                        colorB={employee.avatarB}
                        appearance={employee.appearance}
                        brand={employee.kind === 'external'}
                        size={26}
                      />
                    ) : null}
                    <span>
                      <b>{child.objective || 'Delegated task'}</b>
                      <small>
                        {employee?.name ?? child.employeeId ?? 'Unassigned'} · {child.status}
                      </small>
                    </span>
                    {lease?.files.length ? (
                      <button
                        type="button"
                        className="off-focusable"
                        onClick={() => onOpenDiff(lease, lease.files[0]?.path)}
                      >
                        <Icon icon={GitCompareArrows} size="sm" />
                        Diff
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <section>
          <h3>Verification</h3>
          {leases.length === 0 ? (
            <p className="off-board-muted">No delegated write-worktree verification recorded.</p>
          ) : (
            leases.map((lease) => (
              <article className="off-board-verification" key={lease.leaseId}>
                <span className={cn('off-board-verify-status', `is-${lease.status}`)}>
                  {lease.verificationPassed === true ? (
                    <CheckCircle2 aria-hidden />
                  ) : lease.status === 'failed' ? (
                    <AlertTriangle aria-hidden />
                  ) : (
                    <Play aria-hidden />
                  )}
                  {lease.status}
                </span>
                <b>{lease.branch ?? lease.runId}</b>
                <p>
                  {lease.verificationSummary ??
                    lease.terminationReason ??
                    lease.reason ??
                    'No verification summary recorded.'}
                </p>
                {lease.files.length ? (
                  <button
                    type="button"
                    className="off-focusable"
                    onClick={() => onOpenDiff(lease, lease.files[0]?.path)}
                  >
                    Open {lease.files.length} changed file{lease.files.length === 1 ? '' : 's'}
                    <ChevronRight aria-hidden />
                  </button>
                ) : null}
              </article>
            ))
          )}
        </section>
        <section>
          <h3>Changes</h3>
          <div className="off-board-change-stats">
            <span>
              <b>{files.length}</b> files
            </span>
            <span className="is-add">
              <b>+{stats.added}</b> added
            </span>
            <span className="is-remove">
              <b>-{stats.removed}</b> removed
            </span>
          </div>
        </section>
        {pending.length > 0 ? (
          <section>
            <h3>Review decision</h3>
            <textarea
              className="off-focusable"
              value={feedback}
              onChange={(event) => onFeedback(event.target.value)}
              placeholder="Required changes and acceptance notes…"
            />
          </section>
        ) : null}
      </div>
      {pending.length > 0 ? (
        <footer>
          <button
            type="button"
            className="off-focusable is-primary"
            disabled={busy}
            onClick={onMerge}
          >
            Merge
          </button>
          <button
            type="button"
            className="off-focusable"
            disabled={busy || !feedback.trim()}
            onClick={onRequestChanges}
          >
            Send back
          </button>
          <button
            type="button"
            className="off-focusable is-danger"
            disabled={busy}
            onClick={onDiscard}
          >
            Discard
          </button>
        </footer>
      ) : null}
    </aside>
  );
}

function BoardTimeline({ companyId }: { companyId: string }) {
  const records = useActivityRecords(companyId);
  const allRecords = useMemo<ActivityRecord[]>(
    () => records.data?.pages.flatMap((page) => page.records) ?? [],
    [records.data],
  );
  const groups = useMemo(() => groupByTime(allRecords), [allRecords]);
  if (records.isError && allRecords.length === 0)
    return (
      <ErrorState
        title="Couldn't load activity"
        detail={errorDetail(records.error, 'The company timeline could not be read.')}
        onRetry={() => void records.refetch()}
      />
    );
  if (records.isLoading && allRecords.length === 0) return <SkeletonRows rows={10} />;
  if (allRecords.length === 0)
    return (
      <EmptyState
        icon={History}
        title="No company activity yet"
        description="Runtime and workspace events appear here as work happens."
      />
    );
  return (
    <div className="off-board-timeline">
      {groups.map((group) => (
        <section key={group.key}>
          <header>
            <b>{group.label}</b>
            <span>{group.records.length}</span>
          </header>
          {collapseReroutes(group.records).map(({ record, collapsedCount }) => {
            const summary = getDisplaySummary(record);
            const { icon, color } = domainIcon(record.type);
            return (
              <div
                className={cn('off-board-event', `is-${getEventLevel(record.type)}`)}
                key={record.id}
              >
                <Icon icon={icon} size="sm" className={`is-${color}`} />
                <span>
                  {summary.actor ? <b>{summary.actor} · </b> : null}
                  {summary.label}
                  {collapsedCount ? <em> ×{collapsedCount}</em> : null}
                </span>
                <time>{formatRelativeTimestamp(record.at)}</time>
              </div>
            );
          })}
        </section>
      ))}
      {records.hasNextPage ? (
        <button
          type="button"
          className="off-board-load-more off-focusable"
          disabled={records.isFetchingNextPage}
          onClick={() => void records.fetchNextPage()}
        >
          {records.isFetchingNextPage ? 'Loading…' : 'Load older activity'}
        </button>
      ) : null}
    </div>
  );
}
