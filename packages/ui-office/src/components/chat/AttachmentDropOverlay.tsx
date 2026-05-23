import { cn } from '@offisim/ui-core';
import type { ReactNode } from 'react';

export interface AttachmentDropOverlayProps {
  visible: boolean;
  message?: string;
  children?: ReactNode;
}

/**
 * Full-cover absolute overlay rendered on top of the chat composer when the
 * user drags a file over it. Pointer-events go to the textarea while idle so
 * existing interactions work; the overlay only intercepts during a drag and
 * presents a typed message ("Drop to attach" / "Storage unavailable" when IDB
 * is crippled in private browsing).
 */
export function AttachmentDropOverlay({ visible, message }: AttachmentDropOverlayProps) {
  return (
    <div
      aria-hidden={!visible}
      data-slot="attachment-drop-overlay"
      data-state={visible ? 'open' : 'closed'}
      className={cn(
        'attachment-drop-overlay',
        visible ? 'attachment-drop-overlay-open' : 'attachment-drop-overlay-closed',
      )}
    >
      <span className="attachment-drop-overlay-label">{message ?? 'Drop to attach'}</span>
    </div>
  );
}
