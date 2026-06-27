import type { LoopRevision } from '@offisim/shared-types';
import { Check } from 'lucide-react';

/**
 * The version list (PR-08) — every immutable revision newest-first, with its
 * compile status, created time, and a "set as current" affordance (a NEW pointer;
 * the old row is never mutated). Use defaults to the current revision; this panel
 * lets the user point the loop at an older one. Rendered inside the editor's
 * version dropdown.
 */

interface LoopVersionPanelProps {
  revisions: LoopRevision[];
  currentRevisionId: string | null;
  onSetCurrent: (revisionId: string) => void;
}

const STATUS_LABEL: Record<LoopRevision['compileStatus'], string> = {
  ready: 'Ready',
  needs_input: 'Needs input',
  invalid: 'Invalid',
};

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LoopVersionPanel({
  revisions,
  currentRevisionId,
  onSetCurrent,
}: LoopVersionPanelProps) {
  if (revisions.length === 0) {
    return <p className="off-loop-versions-empty">No revisions yet. Compile to create v1.</p>;
  }

  return (
    <ul className="off-loop-versions">
      {revisions.map((rev) => {
        const isCurrent = rev.revisionId === currentRevisionId;
        return (
          <li key={rev.revisionId} className="off-loop-version">
            <button
              type="button"
              className="off-loop-version-btn off-focusable"
              disabled={isCurrent}
              onClick={() => onSetCurrent(rev.revisionId)}
              title={isCurrent ? 'Current revision' : 'Set as current revision'}
            >
              <span className="off-loop-version-num">v{rev.revisionNumber}</span>
              <span className="off-loop-version-info">
                <span className={`off-loop-version-status is-${rev.compileStatus}`}>
                  {STATUS_LABEL[rev.compileStatus]}
                </span>
                <span className="off-loop-version-time">{shortTime(rev.createdAt)}</span>
              </span>
              {isCurrent ? <Check className="off-loop-version-check" aria-label="Current" /> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
