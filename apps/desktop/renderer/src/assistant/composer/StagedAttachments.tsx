import type { StagedAttachment } from '@/data/types.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { AlertCircle, FileText, Image as ImageIcon, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type ComposerAttachmentScope,
  composerAttachmentScopeKey,
  useComposerAttachmentStore,
} from './composer-attachment-store.js';

const EMPTY_STAGED_ATTACHMENTS: StagedAttachment[] = [];

function StagedAttachmentVisual({ attachment }: { attachment: StagedAttachment }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (attachment.kind !== 'image' || !attachment.bytes || !attachment.mimeType) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([attachment.bytes.slice().buffer as ArrayBuffer], { type: attachment.mimeType }),
    );
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment.bytes, attachment.kind, attachment.mimeType]);

  if (previewUrl) {
    return <img className="off-staged-thumb" src={previewUrl} alt="" />;
  }
  return <Icon icon={attachment.kind === 'image' ? ImageIcon : FileText} size="sm" />;
}

/** Staged attachment chips shown between the composer input and its tool row.
 *  Each chip reflects truthful staging state; failed chips carry the canonical
 *  error string so size/dedupe/type rejection is never a silent no-op. */
export function StagedAttachments({ scope }: { scope: ComposerAttachmentScope }) {
  const scopeKey = composerAttachmentScopeKey(scope);
  const staged = useComposerAttachmentStore(
    (state) => state.stagedByScope[scopeKey] ?? EMPTY_STAGED_ATTACHMENTS,
  );
  const removeStaged = useComposerAttachmentStore((s) => s.removeStaged);

  if (staged.length === 0) return null;

  return (
    <div className="off-staged" aria-label="Staged attachments">
      {staged.map((att) => (
        <div key={att.id} className={cn('off-staged-chip', `is-${att.status}`)}>
          <span className="off-staged-icon">
            {att.status === 'error' ? (
              <Icon icon={AlertCircle} size="sm" />
            ) : (
              <StagedAttachmentVisual attachment={att} />
            )}
          </span>
          <span className="off-staged-text">
            <span className="off-staged-name">{att.name}</span>
            <span className="off-staged-meta">
              {[att.sizeLabel, att.summary].filter(Boolean).join(' · ')}
            </span>
          </span>
          <button
            type="button"
            className="off-staged-x off-focusable"
            aria-label={`Remove ${att.name}`}
            onClick={() => removeStaged(scope, att.id)}
          >
            <Icon icon={X} size="sm" />
          </button>
        </div>
      ))}
    </div>
  );
}
