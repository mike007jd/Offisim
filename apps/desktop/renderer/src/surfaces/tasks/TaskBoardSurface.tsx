import { conversationRunController } from '@/assistant/runtime/conversation-run-controller.js';
import { useInterruptedRunRecovery } from '@/assistant/runtime/conversation-run-react.js';
import { useUiState } from '@/app/ui-state.js';
import { Select, type SelectOption } from '@/design-system/grammar/Select.js';
import { useCompanyEmployees } from '@/data/queries.js';
import { cn } from '@/lib/utils.js';
import { getRepos } from '@/runtime/repos.js';
import { EmptyState, ErrorState, SkeletonRows, errorDetail } from '@/surfaces/shared/SurfaceStates.js';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CheckCircle2, CircleStop, Clock3, Eye, ListChecks, Pause, Search, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { InterruptedRunCardView } from './InterruptedRunCardView.js';
import {
  type TaskBoardRow,
  type TaskBoardStatus,
  filterTaskRows,
  useTaskBoard,
} from './task-board-data.js';

const ROW_HEIGHT = 54;
const STATUS_OPTIONS: ReadonlyArray<SelectOption> = [
  { value: 'all', label: 'All statuses' },
  { value: 'running', label: 'Running' },
  { value: 'interrupted', label: 'Interrupted' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

function statusLabel(status: TaskBoardStatus): string {
  switch (status) {
    case 'running':
      return 'Running';
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
      value.totalTokens ?? value.total_tokens ?? value.tokens ?? value.outputTokens ?? value.output_tokens;
    return typeof total === 'number' ? `${total.toLocaleString()} tokens` : 'Usage recorded';
  } catch {
    return 'Usage recorded';
  }
}

function employeeName(row: TaskBoardRow, employeeNames: Map<string, string>): string {
  if (!row.employeeId) return 'Team run';
  return employeeNames.get(row.employeeId) ?? row.employeeId;
}

function StatusIcon({ status }: { status: TaskBoardStatus }) {
  if (status === 'running') return <Clock3 aria-hidden />;
  if (status === 'completed') return <CheckCircle2 aria-hidden />;
  if (status === 'interrupted') return <Pause aria-hidden />;
  return <XCircle aria-hidden />;
}

export function TaskBoardSurface() {
  const companyId = useUiState((s) => s.companyId);
  const setSurface = useUiState((s) => s.setSurface);
  const board = useTaskBoard(companyId || null);
  const employees = useCompanyEmployees(companyId || null);
  const recovery = useInterruptedRunRecovery(companyId || null, {
    skipReconcile: true,
  });
  const [status, setStatus] = useState<TaskBoardStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void recovery.refetch();
  }, [recovery.refetch]);

  const employeeNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const employee of employees.data ?? []) map.set(employee.id, employee.name);
    return map;
  }, [employees.data]);

  const filteredRows = useMemo(
    () => filterTaskRows(board.rows, { status, search }),
    [board.rows, search, status],
  );

  const selectedRow = useMemo(
    () => board.rows.find((row) => row.runId === selectedRunId) ?? null,
    [board.rows, selectedRunId],
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
    count: filteredRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const refetchBoard = useCallback(async () => {
    await Promise.all([board.refetch(), recovery.refetch()]);
  }, [board, recovery]);

  const cancelRun = useCallback(
    async (row: TaskBoardRow) => {
      if (!companyId) return;
      setBusyRunId(row.runId);
      try {
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

  const resetFilters = useCallback(() => {
    setSearch('');
    setStatus('all');
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
          <span className="off-task-stat-l">Total roots</span>
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
      ) : filteredRows.length === 0 ? (
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
                const row = filteredRows[vi.index];
                if (!row) return null;
                const selected = row.runId === selectedRunId;
                const card = recoveryByRunId.get(row.runId);
                return (
                  <div
                    key={row.runId}
                    className={cn('off-task-row', selected && 'is-selected')}
                    style={{
                      position: 'absolute',
                      top: 0,
                      transform: `translateY(${vi.start}px)`,
                      width: '100%',
                    }}
                  >
                    <button
                      type="button"
                      className="off-task-row-main off-focusable"
                      onClick={() => setSelectedRunId(selected ? null : row.runId)}
                    >
                      <span className={cn('off-task-badge', `is-${row.status}`)}>
                        <StatusIcon status={row.status} />
                        {statusLabel(row.status)}
                      </span>
                      <span className="off-task-title">
                        {row.objective || `${employeeName(row, employeeNames)} run`}
                      </span>
                      <span className="off-task-meta">
                        {employeeName(row, employeeNames)} · {formatWhen(row.startedAt)}
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
                          Cancel
                        </button>
                      ) : row.status === 'interrupted' && card ? (
                        <button
                          type="button"
                          className="off-task-action is-primary off-focusable"
                          disabled={busyRunId === row.runId}
                          onClick={() => void resumeRun(row.runId)}
                        >
                          Resume
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
                  <h2>{selectedRow.objective || 'Agent run'}</h2>
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
                  <dt>Session file</dt>
                  <dd>{selectedRow.sessionFile || 'Not recorded'}</dd>
                </div>
              </dl>
              {recoveryByRunId.has(selectedRow.runId) ? (
                <p className="off-task-detail-note">
                  {recoveryByRunId.get(selectedRow.runId)?.whatResumeWillDo}
                </p>
              ) : null}
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}
