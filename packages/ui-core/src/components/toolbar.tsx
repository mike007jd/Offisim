import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/utils.js';

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
        surface && 'rounded-xl border border-white/10 bg-white/5',
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
    <div ref={ref} aria-hidden className={cn('mx-1 h-5 w-px bg-white/10', className)} {...props} />
  ),
);
ToolbarSeparator.displayName = 'ToolbarSeparator';

export const ToolbarSpacer = () => <div className="flex-1" aria-hidden />;
