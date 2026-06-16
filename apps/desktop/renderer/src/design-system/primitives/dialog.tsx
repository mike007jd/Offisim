import { cn } from '@/lib/utils.js';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { X } from 'lucide-react';
import type * as React from 'react';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn('off-motion-dialog-overlay off-dialog-overlay', className)}
      {...props}
    />
  );
}

export function DialogContent({
  className,
  children,
  showClose = true,
  title,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showClose?: boolean;
  /**
   * Accessible title fallback. When the children do not render a visible
   * DialogTitle, pass `title` so the primitive emits a visually-hidden title
   * and satisfies the Radix accessible-name requirement by default.
   */
  title?: string;
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn('off-motion-dialog-content off-dialog-content', className)}
        {...props}
      >
        {title ? (
          <VisuallyHidden asChild>
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
          </VisuallyHidden>
        ) : null}
        {children}
        {showClose && (
          <DialogPrimitive.Close aria-label="Close" className="off-focusable off-dialog-close">
            <X className="off-dialog-close-icon" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('off-dialog-header', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('off-dialog-footer', className)} {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('off-dialog-title', className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn('off-dialog-description', className)} {...props} />
  );
}
