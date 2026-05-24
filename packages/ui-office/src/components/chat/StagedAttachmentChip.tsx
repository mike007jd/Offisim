import type { StagedAttachment } from '@offisim/shared-types';
import { Button } from '@offisim/ui-core';
import { Paperclip, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ATTACHMENT_KIND_ICONS, formatAttachmentBytes } from './attachment-chip-display.js';

function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

export interface StagedAttachmentChipProps {
  attachment: StagedAttachment;
  onRemove: (attachmentId: string) => void;
}

/**
 * Composer-side chip for a staged-but-not-sent attachment. Shows filename +
 * mime icon + byte size + parser summary preview (or "Parsing…" until the
 * background parse settles) + a remove (×) affordance. Image kind renders an
 * inline thumbnail via `URL.createObjectURL`; the URL is revoked on unmount.
 */
export function StagedAttachmentChip({ attachment, onRemove }: StagedAttachmentChipProps) {
  const Icon = ATTACHMENT_KIND_ICONS[attachment.kind] ?? Paperclip;
  const isImage = attachment.kind === 'image';
  const file = isImage ? (attachment.file as unknown as File) : null;
  const objectUrl = useObjectUrl(file);
  const summary = useMemo(() => {
    if (attachment.error) return `Parse error · ${attachment.error.reason}`;
    return attachment.summary ?? 'Parsing…';
  }, [attachment.error, attachment.summary]);

  return (
    <div className="staged-attachment-chip">
      {isImage && objectUrl ? (
        <img src={objectUrl} alt={attachment.filename} className="staged-attachment-thumbnail" />
      ) : (
        <Icon data-icon="attachment-kind" />
      )}
      <div className="staged-attachment-body">
        <span className="staged-attachment-name">{attachment.filename}</span>
        <div className="staged-attachment-meta">
          {formatAttachmentBytes(attachment.byteLength)} · {summary}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => onRemove(attachment.attachmentId)}
        aria-label={`Remove ${attachment.filename}`}
        className="staged-attachment-remove"
      >
        <X data-icon="remove" />
      </Button>
    </div>
  );
}
