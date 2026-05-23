import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/utils.js';
import { Button, type ButtonProps } from './button.js';

export type ToolbarDensity = 'default' | 'compact';

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  density?: ToolbarDensity;
  /** Apply a translucent surface background. */
  surface?: boolean;
}

/**
 * Horizontal toolbar with stable height; use for Header tool rows, Studio
 * toolbar, and workspace action bars. Stable height avoids layout shift when
 * groups toggle.
 */
export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(
  ({ className, density = 'default', surface = false, ...props }, ref) => (
    <div
      ref={ref}
      role="toolbar"
      className={cn(
        'flex items-center gap-1',
        density === 'default' ? 'h-11 px-2' : 'h-9 px-1.5',
        surface && 'rounded-xl border border-border-default bg-surface-muted',
        className,
      )}
      {...props}
    />
  ),
);
Toolbar.displayName = 'Toolbar';

export const ToolbarGroup = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-1', className)} {...props} />
  ),
);
ToolbarGroup.displayName = 'ToolbarGroup';

export const ToolbarSeparator = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden
      className={cn('mx-1 h-5 w-px bg-border-subtle', className)}
      {...props}
    />
  ),
);
ToolbarSeparator.displayName = 'ToolbarSeparator';

export const ToolbarSpacer = () => <div className="flex-1" aria-hidden />;

export interface ToolbarButtonProps extends Omit<ButtonProps, 'variant' | 'size'> {
  shape?: 'default' | 'compact';
}

export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ className, shape = 'default', ...props }, ref) => (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        'gap-sp-1 rounded-r-md border-line bg-surface-2 text-fs-meta font-semibold text-ink-1 shadow-elev-1 hover:bg-surface-sunken hover:text-ink-1',
        shape === 'compact' && 'rounded-r-sm',
        className,
      )}
      {...props}
    />
  ),
);
ToolbarButton.displayName = 'ToolbarButton';

export interface ToolbarIconButtonProps extends Omit<ButtonProps, 'variant' | 'size'> {
  shape?: 'default' | 'compact';
}

export const ToolbarIconButton = forwardRef<HTMLButtonElement, ToolbarIconButtonProps>(
  ({ className, shape = 'default', ...props }, ref) => (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      size="icon"
      className={cn(
        'size-8 shrink-0 rounded-r-md border-line bg-surface-2 text-ink-3 shadow-elev-1 hover:bg-surface-sunken hover:text-ink-1',
        shape === 'compact' && 'rounded-r-sm',
        className,
      )}
      {...props}
    />
  ),
);
ToolbarIconButton.displayName = 'ToolbarIconButton';
