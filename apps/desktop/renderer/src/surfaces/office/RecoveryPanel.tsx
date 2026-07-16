import { useUiState } from '@/app/ui-state.js';
import {
  useActiveConversationRuns,
  useInterruptedRunRecovery,
} from '@/assistant/runtime/conversation-run-react.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import type { InterruptedRunCard } from '@/runtime/recovery/reconcile-interrupted-runs.js';
import { AlertTriangle, FileText, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

function relativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return 'unknown start';
  const deltaMs = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function summarizeUsage(partialUsageJson: string | null): string {
  if (!partialUsageJson) return 'No partial usage recorded';
  try {
    const parsed = JSON.parse(partialUsageJson) as Record<string, unknown>;
    const total = parsed.totalTokens ?? parsed.total_tokens ?? parsed.tokens;
    if (typeof total === 'number') return `${total.toLocaleString()} tokens recorded`;
  } catch {
    return 'Partial usage details unavailable';
  }
  return 'Partial usage recorded';
}

export function RecoveryPanel() {
  const companyId = useUiState((s) => s.companyId);
  const activeRuns = useActiveConversationRuns();
  const hasLiveActiveRun =
    Boolean(companyId) &&
    activeRuns.activeRuns.some((run) => run.companyId === companyId && run.attemptId);
  const { cards, resume, discard } = useInterruptedRunRecovery(companyId || null, {
    skipReconcile: hasLiveActiveRun,
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);

  const visibleCards = useMemo(() => (showAll ? cards : cards.slice(0, 4)), [cards, showAll]);
  if (visibleCards.length === 0) return null;

  const toggleExpanded = (runId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };

  const runAction = async (
    runId: string,
    failureTitle: string,
    failureDescription: string,
    action: () => Promise<void>,
  ) => {
    setBusyRunId(runId);
    try {
      await action();
    } catch {
      toast.error(failureTitle, { description: failureDescription });
    } finally {
      setBusyRunId(null);
    }
  };

  const requestResume = (card: InterruptedRunCard) => {
    void runAction(
      card.runId,
      'Could not resume interrupted work',
      'Resume did not finish. Review the Conversation and Project before trying again.',
      () => resume(card.runId),
    );
  };

  return (
    <aside className="off-recovery" aria-label="Interrupted runs">
      <div className="off-recovery-head">
        <Icon icon={AlertTriangle} size="sm" />
        <span>Interrupted work</span>
        {cards.length > 4 ? (
          <button
            type="button"
            className="off-recovery-btn off-recovery-count off-focusable"
            aria-expanded={showAll}
            aria-controls="off-interrupted-run-list"
            onClick={() => setShowAll((current) => !current)}
          >
            {showAll ? 'Show fewer' : `+${cards.length - 4} more`}
          </button>
        ) : null}
      </div>
      <div id="off-interrupted-run-list" className="off-recovery-list">
        {visibleCards.map((card) => {
          const isExpanded = expanded.has(card.runId);
          const busy = busyRunId !== null;
          return (
            <article key={card.runId} className="off-recovery-card">
              <div className="off-recovery-main">
                <span className="off-recovery-title">{card.objective || 'Untitled run'}</span>
                <span className="off-recovery-meta">Started {relativeTime(card.startedAt)}</span>
              </div>
              <span className={cn('off-recovery-badge', `is-${card.classification}`)}>
                {card.classification === 'resumable' ? 'Can resume' : "Can't resume"}
              </span>
              <p className="off-recovery-copy">{card.whatResumeWillDo}</p>
              {card.classificationReasons.length > 0 ? (
                <p className="off-recovery-reason">{card.classificationReasons.join(' ')}</p>
              ) : null}
              <div className="off-recovery-actions">
                <button
                  type="button"
                  className="off-recovery-btn off-recovery-resume off-focusable"
                  disabled={busy || card.classification !== 'resumable'}
                  onClick={() => requestResume(card)}
                >
                  <Icon icon={RotateCcw} size="sm" />
                  Resume
                </button>
                <button
                  type="button"
                  className="off-recovery-btn off-focusable"
                  disabled={busy}
                  onClick={() =>
                    void runAction(
                      card.runId,
                      'Could not discard interrupted work',
                      'The interrupted work is still available. Try again.',
                      () => discard(card.runId),
                    )
                  }
                >
                  <Icon icon={Trash2} size="sm" />
                  Discard
                </button>
                <button
                  type="button"
                  className="off-recovery-btn off-focusable"
                  onClick={() => toggleExpanded(card.runId)}
                >
                  <Icon icon={FileText} size="sm" />
                  Details
                </button>
              </div>
              {isExpanded ? (
                <div className="off-recovery-partial">
                  <span>Usage: {summarizeUsage(card.partialUsageJson)}</span>
                  <span>
                    {card.cancelledChildRunIds.length === 0
                      ? 'No active child runs were found'
                      : `${card.cancelledChildRunIds.length} child ${
                          card.cancelledChildRunIds.length === 1 ? 'run was' : 'runs were'
                        } safely stopped`}
                  </span>
                  {card.workspaceBinding?.displayPath ? (
                    <span>Workspace: {card.workspaceBinding.displayPath}</span>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </aside>
  );
}
