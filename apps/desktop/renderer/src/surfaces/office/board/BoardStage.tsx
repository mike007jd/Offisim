import { useUiState } from '@/app/ui-state.js';
import { conversationRunController } from '@/assistant/runtime/conversation-run-controller.js';
import { useInterruptedRunRecovery } from '@/assistant/runtime/conversation-run-react.js';
import { useCompanyEmployees, useProjects } from '@/data/queries.js';
import { cn } from '@/lib/utils.js';
import { getRepos } from '@/runtime/repos.js';
import { useSetStageChrome } from '@/surfaces/office/stage-viewer/stage-chrome.js';
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  errorDetail,
} from '@/surfaces/shared/SurfaceStates.js';
import { useQuery } from '@tanstack/react-query';
import { Columns3 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  BoardCard,
  effectiveStatus,
  leasesForRow,
  taskTitle,
  toastLeaseOutcomes,
} from './BoardCard.js';
import { BoardDrawer } from './BoardDrawer.js';
import { BoardTimeline } from './BoardTimeline.js';
import { CompetitiveDraftDialog } from './CompetitiveDraftDialog.js';
import { startCompetitiveDraft } from './competitive-draft-actions.js';
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

export function BoardStage() {
  useWorkspaceLeaseDecisionVersion();
  const setStageChrome = useSetStageChrome();
  const companyId = useUiState((state) => state.companyId);
  const projectId = useUiState((state) => state.projectId);
  const requestThreadFocus = useUiState((state) => state.requestThreadFocus);
  const openStageView = useUiState((state) => state.openStageView);
  const highlightedRunId = useUiState((state) => state.boardHighlightedRunId);
  const highlightBoardRun = useUiState((state) => state.highlightBoardRun);
  const lens = useUiState((state) => state.boardLens);
  const openDraftThread = useUiState((state) => state.openDraftThread);
  const openBoard = useUiState((state) => state.openBoard);
  const setRightRailCollapsed = useUiState((state) => state.setOfficeRightRailCollapsed);
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
  const [draftRow, setDraftRow] = useState<TaskBoardRow | null>(null);
  const startRequest = useCallback(() => {
    openDraftThread();
    openBoard(lens);
    setRightRailCollapsed(false);
  }, [lens, openBoard, openDraftThread, setRightRailCollapsed]);

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
  useEffect(() => {
    setStageChrome({
      actions: (
        <span className="off-board-scope-note">
          {lens === 'timeline' ? 'Company-wide timeline' : `${scopedRows.length} requests`}
        </span>
      ),
    });
    return () => setStageChrome(null);
  }, [lens, scopedRows.length, setStageChrome]);
  const attentionRootRunIds = useMemo(
    () =>
      new Set(
        board.rows
          .map((row) => ({ row, status: effectiveStatus(row, allLeases) }))
          .filter(({ status }) => ['failed', 'cancelled', 'interrupted'].includes(status))
          .map(({ row }) => row.rootRunId),
      ),
    [allLeases, board.rows],
  );
  const selectedRow = scopedRows.find((row) => row.runId === selectedRunId) ?? null;
  const selectedLeases = selectedRow ? leasesForRow(selectedRow, allLeases) : [];
  const hasPendingDecision = (leases: readonly WorkspaceLeaseReviewRow[]) =>
    leases.some((lease) => workspaceLeaseDecisionAction(lease.leaseId) !== null);

  const refresh = useCallback(async () => {
    await Promise.all([board.refetch(), leaseQuery.refetch(), recovery.refetch()]);
  }, [board, leaseQuery, recovery]);

  const launchCompetitiveDraft = useCallback(
    async (employeeIds: string[]) => {
      if (!companyId || !draftRow?.projectId || !draftRow.objective) return;
      setBusyId(draftRow.runId);
      try {
        const result = await startCompetitiveDraft({
          companyId,
          projectId: draftRow.projectId,
          sourceRunId: draftRow.runId,
          objective: draftRow.objective,
          employeeIds,
        });
        setDraftRow(null);
        await refresh();
        openStageView({ kind: 'changes', comparisonGroupId: result.groupId });
        if (result.failedCount > 0) {
          toast.warning(
            `${result.launchedCount} drafts started; ${result.failedCount} could not start and are recorded in the comparison.`,
          );
        } else {
          toast.success(`${result.launchedCount} independent drafts started.`);
        }
      } catch (error) {
        toast.error(errorDetail(error, 'Could not start competitive drafting.'));
      } finally {
        setBusyId(null);
      }
    },
    [companyId, draftRow, openStageView, refresh],
  );

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
      {lens === 'timeline' ? (
        <BoardTimeline
          companyId={companyId}
          projectIds={projectIds}
          attentionRootRunIds={attentionRootRunIds}
          onStartRequest={startRequest}
        />
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
          description="Start a request in a conversation and its progress will appear here."
          action={{ label: 'Start a request', onClick: startRequest }}
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
                        onCompetitiveDraft={() => setDraftRow(row)}
                        onOpenComparison={(groupId) =>
                          openStageView({ kind: 'changes', comparisonGroupId: groupId })
                        }
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
              onOpenComparison={(groupId) =>
                openStageView({ kind: 'changes', comparisonGroupId: groupId })
              }
            />
          ) : null}
        </div>
      )}
      <CompetitiveDraftDialog
        open={draftRow !== null}
        employees={employees.data ?? []}
        objective={taskTitle(draftRow?.objective ?? null)}
        busy={Boolean(draftRow && busyId === draftRow.runId)}
        onOpenChange={(open) => {
          if (!open) setDraftRow(null);
        }}
        onSubmit={(employeeIds) => void launchCompetitiveDraft(employeeIds)}
      />
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
