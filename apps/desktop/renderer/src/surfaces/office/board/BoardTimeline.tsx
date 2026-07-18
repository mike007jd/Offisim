import { Icon } from '@/design-system/icons/Icon.js';
import type { WorkspaceCheckpointRow } from '@/lib/tauri-commands.js';
import { cn } from '@/lib/utils.js';
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  errorDetail,
} from '@/surfaces/shared/SurfaceStates.js';
import { History } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  type ActivityRecord,
  checkpointPathForDisplay,
  collapseReroutes,
  domainIcon,
  formatRelativeTimestamp,
  getDisplaySummary,
  getEventLevel,
  groupByTime,
  useActivityRecords,
} from './activity-data.js';
import { rewindWorkspaceCheckpoint } from './workspace-checkpoint-actions.js';

export function BoardTimeline({
  companyId,
  projectIds,
  attentionRootRunIds,
  onStartRequest,
}: {
  companyId: string;
  projectIds: readonly string[];
  attentionRootRunIds: ReadonlySet<string>;
  onStartRequest: () => void;
}) {
  const records = useActivityRecords(companyId, projectIds);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{
    anchorId: string;
    target: WorkspaceCheckpointRow;
  } | null>(null);
  const [rewindingId, setRewindingId] = useState<string | null>(null);
  const allRecords = useMemo<ActivityRecord[]>(
    () => records.data?.pages.flatMap((page) => page.records) ?? [],
    [records.data],
  );
  const baselineByRootRun = useMemo(() => {
    const baselines = new Map<string, WorkspaceCheckpointRow>();
    for (const record of allRecords) {
      if (record.checkpoint?.step === 0) {
        baselines.set(record.checkpoint.rootRunId, record.checkpoint);
      }
    }
    return baselines;
  }, [allRecords]);
  const groups = useMemo(() => groupByTime(allRecords), [allRecords]);
  const rewind = useCallback(
    async (checkpoint: WorkspaceCheckpointRow) => {
      setRewindingId(checkpoint.checkpointId);
      try {
        await rewindWorkspaceCheckpoint(checkpoint, companyId);
        setConfirmState(null);
        toast.success(`Workspace rewound to Step ${checkpoint.step}.`);
        await records.refetch();
      } catch (error) {
        toast.error(errorDetail(error, 'Could not rewind this workspace.'));
      } finally {
        setRewindingId(null);
      }
    },
    [companyId, records],
  );
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
        description="Start a request to build a company-wide history of work and reviews."
        action={{ label: 'Start a request', onClick: onStartRequest }}
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
            const checkpoint = record.checkpoint;
            const expanded = expandedId === record.id;
            const baseline = checkpoint ? baselineByRootRun.get(checkpoint.rootRunId) : undefined;
            const showRunStart = Boolean(
              checkpoint &&
                checkpoint.step !== 0 &&
                baseline &&
                attentionRootRunIds.has(checkpoint.rootRunId),
            );
            const confirmTarget = confirmState?.anchorId === record.id ? confirmState.target : null;
            return (
              <div
                className={cn(
                  'off-board-event',
                  `is-${getEventLevel(record.type)}`,
                  checkpoint && 'is-checkpoint',
                )}
                key={record.id}
              >
                <Icon icon={icon} size="sm" className={`is-${color}`} />
                <span>
                  {summary.actor ? <b>{summary.actor} · </b> : null}
                  {summary.label}
                  {collapsedCount ? <em> ×{collapsedCount}</em> : null}
                </span>
                <time>{formatRelativeTimestamp(record.at)}</time>
                {checkpoint ? (
                  <div className="off-board-checkpoint-actions">
                    <button
                      type="button"
                      className="off-focusable"
                      onClick={() => setExpandedId(expanded ? null : record.id)}
                    >
                      {expanded
                        ? 'Hide changed files'
                        : `Show ${checkpoint.changedPaths.length} changed ${checkpoint.changedPaths.length === 1 ? 'file' : 'files'}`}
                    </button>
                    <button
                      type="button"
                      className="off-focusable"
                      disabled={rewindingId !== null}
                      onClick={() => setConfirmState({ anchorId: record.id, target: checkpoint })}
                    >
                      Rewind to Step {checkpoint.step}
                    </button>
                    {showRunStart ? (
                      <button
                        type="button"
                        className="off-focusable is-run-start"
                        disabled={rewindingId !== null}
                        onClick={() =>
                          baseline && setConfirmState({ anchorId: record.id, target: baseline })
                        }
                      >
                        Rewind to before this run
                      </button>
                    ) : null}
                    {expanded ? (
                      <ul>
                        {checkpoint.changedPaths.length > 0 ? (
                          checkpoint.changedPaths.map((path) => (
                            <li key={path}>
                              {checkpointPathForDisplay(path, checkpoint.workspaceRoot)}
                            </li>
                          ))
                        ) : (
                          <li>No files changed — this is the run starting point.</li>
                        )}
                      </ul>
                    ) : null}
                    {confirmTarget ? (
                      <div className="off-board-checkpoint-confirm" role="alert">
                        <span>
                          Rewind this isolated workspace to Step {confirmTarget.step}? Your Project
                          files stay untouched.
                        </span>
                        <button
                          type="button"
                          className="off-focusable is-danger"
                          disabled={rewindingId !== null}
                          onClick={() => void rewind(confirmTarget)}
                        >
                          {rewindingId ? 'Rewinding…' : `Rewind to Step ${confirmTarget.step}`}
                        </button>
                        <button
                          type="button"
                          className="off-focusable"
                          disabled={rewindingId !== null}
                          onClick={() => setConfirmState(null)}
                        >
                          Keep current work
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
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
