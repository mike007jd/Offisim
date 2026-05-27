import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { AlertCircle, FileText, X } from 'lucide-react';
import { useRunStore } from '../run-store.js';

/** Staged attachment chips shown between the composer input and its tool row.
 *  Each chip reflects truthful staging state; failed chips carry the canonical
 *  error string so size/dedupe/type rejection is never a silent no-op. */
export function StagedAttachments() {
  const staged = useRunStore((s) => s.staged);
  const removeStaged = useRunStore((s) => s.removeStaged);

  if (staged.length === 0) return null;

  return (
    <div className="off-staged" aria-label="Staged attachments">
      {staged.map((att) => (
        <div key={att.id} className={cn('off-staged-chip', `is-${att.status}`)}>
          <span className="off-staged-icon">
            {att.status === 'error' ? (
              <Icon icon={AlertCircle} size="sm" />
            ) : (
              <Icon icon={FileText} size="sm" />
            )}
          </span>
          <span className="off-staged-text">
            <span className="off-staged-name">{att.name}</span>
            <span className="off-staged-meta">{att.sizeLabel}</span>
          </span>
          <button
            type="button"
            className="off-staged-x off-focusable"
            aria-label={`Remove ${att.name}`}
            onClick={() => removeStaged(att.id)}
          >
            <Icon icon={X} size="sm" />
          </button>
        </div>
      ))}
    </div>
  );
}
