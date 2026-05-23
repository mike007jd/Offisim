import { Button, cn } from '@offisim/ui-core';
import { type VariantProps, cva } from 'class-variance-authority';
import type { CSSProperties, ComponentProps, HTMLAttributes, ReactNode } from 'react';

const drawerSurfaceVariants = cva('chat-drawer-surface', {
  variants: {
    state: {
      open: 'chat-drawer-surface-open',
      closed: 'chat-drawer-surface-closed',
    },
  },
  defaultVariants: { state: 'open' },
});

const drawerContentVariants = cva('chat-drawer-content', {
  variants: {
    state: {
      open: 'chat-drawer-content-open',
      closed: 'chat-drawer-content-closed',
    },
  },
  defaultVariants: { state: 'open' },
});

export function ChatDrawerSurface({
  className,
  state,
  heightPx,
  closedHeightPx,
  toggleHeightPx,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'style'> &
  VariantProps<typeof drawerSurfaceVariants> & {
    heightPx: number;
    closedHeightPx: number;
    toggleHeightPx: number;
  }) {
  const resolvedState = state ?? 'open';
  const surfaceStyle = {
    '--chat-drawer-height': `${heightPx}px`,
    '--chat-drawer-closed-height': `${closedHeightPx}px`,
    '--chat-drawer-toggle-height': `${toggleHeightPx}px`,
    '--chat-drawer-resize-height': resolvedState === 'open' ? 'var(--sp-2)' : '0px',
  } as CSSProperties;

  return (
    <div
      data-slot="chat-drawer-surface"
      data-state={resolvedState}
      className={cn(drawerSurfaceVariants({ state: resolvedState }), className)}
      // ui-hardcode-allowed: drawer primitive owns runtime resize geometry as CSS variables.
      style={surfaceStyle}
      {...props}
    />
  );
}

export function ChatDrawerResizeHandle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-drawer-resize-handle"
      className={cn('chat-drawer-resize-handle', className)}
      {...props}
    >
      <div className="chat-drawer-resize-thumb" />
    </div>
  );
}

export function ChatDrawerToggle({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="chat-drawer-toggle"
      variant="ghost"
      className={cn('chat-drawer-toggle', className)}
      {...props}
    />
  );
}

export function ChatDrawerToggleLabel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="chat-drawer-toggle-label"
      className={cn('chat-drawer-toggle-label', className)}
      {...props}
    />
  );
}

export function ChatDrawerToggleChevron({
  className,
  open,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  open: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="chat-drawer-toggle-chevron"
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'chat-drawer-toggle-chevron',
        open && 'chat-drawer-toggle-chevron-open',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function ChatDrawerContent({
  className,
  state,
  inert,
  ...props
}: HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof drawerContentVariants> & {
    inert?: boolean;
  }) {
  return (
    <div
      data-slot="chat-drawer-content"
      data-state={state ?? 'open'}
      className={cn(drawerContentVariants({ state }), className)}
      inert={inert || undefined}
      {...props}
    />
  );
}
