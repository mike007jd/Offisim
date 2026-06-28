import { useUiState } from '@/app/ui-state.js';
import { useInterruptedRunRecovery } from '@/assistant/runtime/conversation-run-react.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { AlertTriangle, FileText, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

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
    // Fall through to a bounded raw preview.
  }
  return partialUsageJson.length > 140
    ? `${partialUsageJson.slice(0, 140).trimEnd()}...`
    : partialUsageJson;
}

export function RecoveryPanel() {
  const companyId = useUiState((s) => s.companyId);
  const { cards, resume, discard } = useInterruptedRunRecovery(companyId || null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [busyRunId, setBusyRunId] = useState<string | null>(null);

  const visibleCards = useMemo(() => cards.slice(0, 4), [cards]);
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

  const runAction = async (runId: string, action: () => Promise<void>) => {
    setBusyRunId(runId);
    try {
      await action();
    } finally {
      setBusyRunId(null);
    }
  };

  return (
    <aside className="off-recovery" aria-label="Interrupted runs">
      <div className="off-recovery-head">
        <Icon icon={AlertTriangle} size="sm" />
        <span>Interrupted work</span>
        {cards.length > visibleCards.length ? (
          <span className="off-recovery-count">+{cards.length - visibleCards.length}</span>
        ) : null}
      </div>
      <div className="off-recovery-list">
        {visibleCards.map((card) => {
          const isExpanded = expanded.has(card.runId);
          const busy = busyRunId === card.runId;
          return (
            <article key={card.runId} className="off-recovery-card">
              <div className="off-recovery-main">
                <span className="off-recovery-title">{card.objective || 'Untitled run'}</span>
                <span className="off-recovery-meta">
                  {relativeTime(card.startedAt)} - {card.threadId.slice(0, 8)}
                </span>
              </div>
              <span className={cn('off-recovery-badge', `is-${card.classification}`)}>
                {card.classification === 'resumable' ? 'Resumable' : 'Confirm'}
              </span>
              <p className="off-recovery-copy">{card.whatResumeWillDo}</p>
              {card.classificationReasons.length > 0 ? (
                <p className="off-recovery-reason">{card.classificationReasons.join(' ')}</p>
              ) : null}
              <div className="off-recovery-actions">
                <button
                  type="button"
                  className="off-recovery-btn off-focusable"
                  disabled={busy}
                  onClick={() => void runAction(card.runId, () => resume(card.runId))}
                >
                  <Icon icon={RotateCcw} size="sm" />
                  Resume
                </button>
                <button
                  type="button"
                  className="off-recovery-btn off-focusable"
                  disabled={busy}
                  onClick={() => void runAction(card.runId, () => discard(card.runId))}
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
                  View partial
                </button>
              </div>
              {isExpanded ? (
                <div className="off-recovery-partial">
                  <span>{summarizeUsage(card.partialUsageJson)}</span>
                  <span>{card.cancelledChildRunIds.length} child runs parked</span>
                  {card.sessionFile ? <span>{card.sessionFile}</span> : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </aside>
  );
}
