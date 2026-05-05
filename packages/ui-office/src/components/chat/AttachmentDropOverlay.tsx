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
      className={`pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-surface-elevated/85 transition-opacity ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <span className="text-xs font-medium text-text-primary">{message ?? 'Drop to attach'}</span>
    </div>
  );
}
