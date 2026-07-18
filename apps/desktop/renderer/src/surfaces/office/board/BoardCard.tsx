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
import { GitCompareArrows, Link2, RotateCcw, Swords, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { TaskBoardRow, TaskBoardStatus, WorkspaceLeaseReviewRow } from './task-board-data.js';
import type { WorkspaceLeaseReviewOutcome } from './workspace-lease-actions.js';

const TITLE_MAX = 88;

export function taskTitle(objective: string | null): string {
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

export function leasesForRow(row: TaskBoardRow, leases: readonly WorkspaceLeaseReviewRow[]) {
  return leases.filter((lease) => lease.relatedRootRunIds.includes(row.rootRunId));
}

export function effectiveStatus(
  row: TaskBoardRow,
  leases: readonly WorkspaceLeaseReviewRow[],
): TaskBoardStatus {
  const competitive = row.competitiveDrafts.at(-1);
  if (competitive?.status === 'drafting' || competitive?.status === 'merging') return 'running';
  if (competitive?.status === 'reviewing') return 'pending_review';
  if (competitive?.status === 'failed') return 'failed';
  if (competitive?.status === 'merged') return 'merged';
  const related = leasesForRow(row, leases);
  if (related.some((lease) => lease.status === 'pending_review')) return 'pending_review';
  if (related.some((lease) => lease.status === 'failed')) return 'failed';
  if (row.status === 'running' || related.some((lease) => lease.status === 'active'))
    return 'running';
  if (related.length > 0 && related.every((lease) => lease.status === 'merged')) return 'merged';
  return row.status;
}

export function toastLeaseOutcomes(
  outcomes: readonly WorkspaceLeaseReviewOutcome[],
  failedCount = 0,
): void {
  const merged = outcomes.filter((outcome) => outcome === 'merged').length;
  const discarded = outcomes.filter((outcome) => outcome === 'discarded').length;
  const hostResolved = outcomes.filter((outcome) => outcome === 'host_resolved').length;
  const parts = [
    merged ? `${merged} merged` : '',
    discarded ? `${discarded} discarded` : '',
    hostResolved ? `${hostResolved} already resolved` : '',
    failedCount ? `${failedCount} failed` : '',
  ].filter(Boolean);
  const message = `Lease decision: ${parts.join(', ')}.`;
  if (failedCount > 0 || parts.length > 1) toast.warning(message);
  else toast.success(message);
}

export function BoardCard({
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
  onCompetitiveDraft,
  onOpenComparison,
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
  onCompetitiveDraft: () => void;
  onOpenComparison: (groupId: string) => void;
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
  const latestDraft = row.competitiveDrafts.at(-1);
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
          Open conversation · {row.source === 'workspace' ? 'Workspace' : 'Office'}
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
      <div className="off-board-card-actions is-competitive">
        {latestDraft ? (
          <button
            type="button"
            className="off-focusable"
            onClick={() => onOpenComparison(latestDraft.group_id)}
          >
            <Icon icon={GitCompareArrows} size="sm" />
            Compare {latestDraft.attempts.length}
          </button>
        ) : (
          <button
            type="button"
            className="off-focusable"
            disabled={busy || row.live || !row.projectId || !row.objective}
            onClick={onCompetitiveDraft}
          >
            <Icon icon={Swords} size="sm" />
            Competitive draft
          </button>
        )}
      </div>
    </article>
  );
}
