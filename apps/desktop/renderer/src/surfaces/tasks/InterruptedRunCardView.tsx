import type { InterruptedRunCard } from '@/runtime/recovery/reconcile-interrupted-runs.js';
import { AlertTriangle, Eye, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface InterruptedRunCardViewProps {
  card: InterruptedRunCard;
  selected: boolean;
  busy: boolean;
  onResume: () => void;
  onDiscard: () => void;
  onViewPartial: () => void;
}

export function InterruptedRunCardView({
  card,
  selected,
  busy,
  onResume,
  onDiscard,
  onViewPartial,
}: InterruptedRunCardViewProps) {
  const [confirmingResume, setConfirmingResume] = useState(false);
  const resumeDisabled = busy || card.classification === 'incompatible';
  const handleResume = () => {
    if (card.classification === 'needs_user_confirm' && !confirmingResume) {
      setConfirmingResume(true);
      return;
    }
    setConfirmingResume(false);
    onResume();
  };

  return (
    <div className="off-task-recovery" data-selected={selected ? '' : undefined}>
      <div className="off-task-recovery-main">
        <AlertTriangle aria-hidden className="off-task-recovery-ico" />
        <div className="off-task-recovery-copy">
          <div className="off-task-recovery-title">Interrupted run</div>
          <div className="off-task-recovery-desc">
            {card.objective || card.whatResumeWillDo}
          </div>
          {card.workspaceRoot ? (
            <div className="off-task-recovery-desc">{card.workspaceRoot}</div>
          ) : null}
        </div>
      </div>
      <div className="off-task-recovery-actions">
        <button
          type="button"
          className="off-task-action off-focusable"
          disabled={busy}
          onClick={onViewPartial}
          title="View partial run evidence"
        >
          <Eye aria-hidden />
          View
        </button>
        <button
          type="button"
          className="off-task-action is-primary off-focusable"
          disabled={resumeDisabled}
          onClick={handleResume}
          title="Resume this interrupted run"
        >
          <Play aria-hidden />
          {card.classification === 'needs_user_confirm' && confirmingResume
            ? 'Confirm resume'
            : 'Resume'}
        </button>
        <button
          type="button"
          className="off-task-action is-danger off-focusable"
          disabled={busy}
          onClick={onDiscard}
          title="Discard this interrupted run"
        >
          <Trash2 aria-hidden />
          Discard
        </button>
      </div>
    </div>
  );
}
