import type { ChatAttachmentRef } from '@offisim/shared-types';
import { Download, Paperclip } from 'lucide-react';
import { useEffect, useState } from 'react';
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

  const baseClass =
    'flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md border px-2 py-1 text-xs';
  const variantClass = isEvicted
    ? 'border-border-default bg-surface-muted text-text-muted'
    : isParseError
      ? 'border-warning/60 bg-warning-muted text-text-primary'
      : 'border-border-default bg-surface text-text-primary';

  return (
    <div
      className={`${baseClass} ${variantClass} ${isEvicted ? 'cursor-default' : ''}`}
      title={
        isEvicted
          ? 'No longer available locally. Re-attach to recover.'
          : isParseError
            ? `Parse error: ${attachment.summary}`
            : undefined
      }
    >
      {attachment.kind === 'image' && status.kind === 'ready' && status.objectUrl ? (
        <img
          src={status.objectUrl}
          alt={attachment.filename}
          className="max-h-[180px] max-w-[min(240px,55%)] min-w-0 shrink rounded object-contain"
        />
      ) : (
        <Icon className="h-4 w-4 shrink-0 text-text-secondary" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{attachment.filename}</div>
        <div className="truncate text-[10px] text-text-muted">
          {formatAttachmentBytes(attachment.byteLength)}
          {summary ? ` · ${summary}` : ''}
        </div>
      </div>
      {status.kind === 'ready' && status.objectUrl ? (
        <a
          href={status.objectUrl}
          download={attachment.filename}
          aria-label={`Download ${attachment.filename}`}
          title={`Download ${attachment.filename}`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted transition hover:bg-surface-hover hover:text-text-primary"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </div>
  );
}
