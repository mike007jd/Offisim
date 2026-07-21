import { cn } from '@/lib/utils.js';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { X } from 'lucide-react';
import type * as React from 'react';

/**
 * In-layout side drawer grammar. Reuses Radix Dialog for focus/Escape without
 * a portal overlay so surfaces can keep absolute positioning inside a panel.
 */
export const Drawer = DialogPrimitive.Root;
export const DrawerClose = DialogPrimitive.Close;

export function DrawerContent({
  className,
  children,
  showClose = true,
  title,
  side = 'right',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showClose?: boolean;
  /** Accessible name when no visible DrawerTitle is rendered. */
  title?: string;
  side?: 'left' | 'right';
}) {
  return (
    <DialogPrimitive.Content
      className={cn(
        'off-drawer',
        side === 'left' ? 'off-drawer-left' : 'off-drawer-right',
        className,
      )}
      {...props}
    >
      {title ? (
        <VisuallyHidden asChild>
          <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
        </VisuallyHidden>
      ) : null}
      {children}
      {showClose ? (
        <DialogPrimitive.Close aria-label="Close" className="off-focusable off-drawer-close">
          <X className="off-drawer-close-icon" />
        </DialogPrimitive.Close>
      ) : null}
    </DialogPrimitive.Content>
  );
}

export function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <header className={cn('off-drawer-header', className)} {...props} />;
}

export function DrawerBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('off-drawer-body', className)} {...props} />;
}

export function DrawerFooter({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <footer className={cn('off-drawer-footer', className)} {...props} />;
}

export function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('off-drawer-title', className)} {...props} />;
}

export function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn('off-drawer-description', className)} {...props} />
  );
}
