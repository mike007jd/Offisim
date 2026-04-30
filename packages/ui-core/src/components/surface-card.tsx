import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/utils.js';

export type SurfaceCardTone = 'default' | 'muted' | 'raised' | 'ghost';

export interface SurfaceCardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: SurfaceCardTone;
  /** Remove the default border. */
  borderless?: boolean;
  /** Remove the default padding. */
  flush?: boolean;
}

const TONE_CLASS: Record<SurfaceCardTone, string> = {
  default: 'border border-border-default bg-surface-elevated',
  muted: 'border border-border-subtle bg-surface-muted',
  raised: 'border border-border-default bg-surface-elevated shadow-sm',
  ghost: 'border border-transparent bg-transparent',
};

/**
 * Shared surface primitive for workspace bands, sidebars, and embedded panels.
 * Thin wrapper on the ui-core `Card` visual language with tone presets; prefer
 * over raw ad hoc surface class soup.
 */
export const SurfaceCard = forwardRef<HTMLDivElement, SurfaceCardProps>(
  ({ className, tone = 'default', borderless = false, flush = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-xl text-text-primary',
        borderless ? 'border-0 bg-transparent' : TONE_CLASS[tone],
        !flush && 'p-4',
        className,
      )}
      {...props}
    />
  ),
);
SurfaceCard.displayName = 'SurfaceCard';
