import type { ChatAttachmentRef } from '@offisim/shared-types';
import { Button } from '@offisim/ui-core';
import { Download, Paperclip } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { AttachmentStore } from '../../lib/attachment-store.js';
import { ATTACHMENT_KIND_ICONS, formatAttachmentBytes } from './attachment-chip-display.js';

type AttachmentLiveStatus =
  | { kind: 'pending' }
  | { kind: 'ready'; objectUrl: string | null }
  | { kind: 'evicted' };

function useAttachmentBlob(
  ref: ChatAttachmentRef,
  attachmentStore: AttachmentStore | null,
): AttachmentLiveStatus {
  const [status, setStatus] = useState<AttachmentLiveStatus>({ kind: 'pending' });
  useEffect(() => {
    if (!attachmentStore) {
      setStatus({ kind: 'ready', objectUrl: null });
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      const result = await attachmentStore.read(ref.vaultRef);
      if (cancelled) return;
      if (result.kind === 'attachment-not-found' || result.kind === 'attachment-corrupted') {
        setStatus({ kind: 'evicted' });
        return;
      }
      const buf = result.bytes.slice().buffer as ArrayBuffer;
      const blob = new Blob([buf], { type: ref.mimeType || 'application/octet-stream' });
      createdUrl = URL.createObjectURL(blob);
      setStatus({ kind: 'ready', objectUrl: createdUrl });
    })().catch(() => {
      if (!cancelled) setStatus({ kind: 'evicted' });
    });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [ref.vaultRef, ref.mimeType, attachmentStore]);
  return status;
}

export interface SentAttachmentChipProps {
  attachment: ChatAttachmentRef;
  attachmentStore: AttachmentStore | null;
}

function SentAttachmentImageFrame({
  children,
}: {
  children: ReactNode;
}) {
  return <span className="sent-attachment-image-frame">{children}</span>;
}

/**
 * Bubble-side chip for an already-persisted user attachment. No remove
 * affordance (delete-message semantics only). Renders three variants:
 * - **Default**: filename + mime icon + size + parser summary; image kind
 *   adds a 240×180 (CSS-clamped) inline thumbnail.
 * - **`[evicted]`**: store returned `attachment-not-found` — disabled style
 *   with re-attach hint tooltip.
 * - **`[parse error]`**: ref summary signals parser failure; chip stays
 *   clickable for raw download.
 */
export function SentAttachmentChip({ attachment, attachmentStore }: SentAttachmentChipProps) {
  const Icon = ATTACHMENT_KIND_ICONS[attachment.kind] ?? Paperclip;
  const status = useAttachmentBlob(attachment, attachmentStore);
  const isParseError = (attachment.summary ?? '').startsWith('Unsupported');
  const isEvicted = status.kind === 'evicted';
  const summary = isEvicted
    ? 'No longer available locally — re-attach to recover.'
    : (attachment.summary ?? '');
  const state = isEvicted ? 'evicted' : isParseError ? 'parseError' : 'default';

  return (
    <div
      data-slot="sent-attachment-chip"
      data-state={state}
      className="sent-attachment-chip"
      title={
        isEvicted
          ? 'No longer available locally. Re-attach to recover.'
          : isParseError
            ? `Parse error: ${attachment.summary}`
            : undefined
      }
    >
      {attachment.kind === 'image' ? (
        <SentAttachmentImageFrame>
          {status.kind === 'ready' && status.objectUrl ? (
            <img
              src={status.objectUrl}
              alt={attachment.filename}
              className="sent-attachment-image"
            />
          ) : (
            <Icon data-icon="attachment-kind" />
          )}
        </SentAttachmentImageFrame>
      ) : (
        <Icon data-icon="attachment-kind" />
      )}
      <div className="sent-attachment-body">
        <div className="sent-attachment-name">{attachment.filename}</div>
        <div className="sent-attachment-meta">
          {formatAttachmentBytes(attachment.byteLength)}
          {summary ? ` · ${summary}` : ''}
        </div>
      </div>
      {status.kind === 'ready' && status.objectUrl ? (
        <Button asChild variant="ghost" size="iconSm" className="sent-attachment-download">
          <a
            href={status.objectUrl}
            download={attachment.filename}
            aria-label={`Download ${attachment.filename}`}
            title={`Download ${attachment.filename}`}
          >
            <Download data-icon="download" />
          </a>
        </Button>
      ) : null}
    </div>
  );
}
