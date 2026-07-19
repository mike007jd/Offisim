import type { TaskBoardRow, WorkspaceLeaseReviewRow } from '@/data/board/task-board-data.js';
import type { Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import type { CompetitiveDraftGroupRow } from '@offisim/core/browser';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  GitCompareArrows,
  Play,
  Swords,
  Trophy,
  X,
} from 'lucide-react';
import { taskTitle } from './BoardCard.js';

function competitiveHistoryStatus(status: CompetitiveDraftGroupRow['status']): string {
  if (status === 'drafting') return 'Drafting in parallel';
  if (status === 'reviewing') return 'Ready to compare';
  if (status === 'merging') return 'Merging winner and cleaning up';
  if (status === 'merged') return 'Winner merged · losing drafts retained in history';
  if (status === 'failed') return 'Needs attention · open comparison for details';
  return 'Cancelled';
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

export function BoardDrawer({
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
  onOpenComparison,
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
  onOpenComparison: (groupId: string) => void;
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
        {row.competitiveDrafts.length > 0 ? (
          <section>
            <h3>Competitive draft history</h3>
            <div className="off-board-draft-history">
              {row.competitiveDrafts.map((group) => (
                <button
                  type="button"
                  className="off-focusable"
                  key={group.group_id}
                  onClick={() => onOpenComparison(group.group_id)}
                >
                  <Icon icon={group.winner_attempt_id ? Trophy : Swords} size="sm" />
                  <span>
                    <b>{group.attempts.length} employees participated</b>
                    <small>
                      {group.attempts
                        .map((attempt) => employeeById.get(attempt.employee_id)?.name)
                        .filter(Boolean)
                        .join(' · ') || 'Participant roster retained'}
                    </small>
                    <small>{competitiveHistoryStatus(group.status)}</small>
                  </span>
                  <ChevronRight aria-hidden />
                </button>
              ))}
            </div>
          </section>
        ) : null}
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
      {pending.length > 0 && row.competitiveDrafts.length === 0 ? (
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
