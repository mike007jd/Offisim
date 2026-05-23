import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/utils.js';

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  /** Value between 0 and 100 */
  value?: number;
  /** Maximum value (default 100) */
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'default' | 'success' | 'warning' | 'error';
}

const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, max = 100, size = 'md', tone = 'default', ...props }, ref) => {
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    const heightClass = size === 'sm' ? 'h-1' : size === 'lg' ? 'h-3' : 'h-2';
    const toneClass =
      tone === 'success'
        ? 'bg-success'
        : tone === 'warning'
          ? 'bg-warning'
          : tone === 'error'
            ? 'bg-error'
            : 'bg-accent';

    return (
      // biome-ignore lint/a11y/useFocusableInteractive: progressbar is a status role, not interactive — focus is not required
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className={cn(
          'relative w-full overflow-hidden rounded-full border border-border-subtle bg-surface-muted',
          heightClass,
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-normal ease-standard',
            toneClass,
          )}
          style={{ width: `${pct}%` }} // ui-hardcode-allowed: progress width is runtime data, not visual styling.
        />
      </div>
    );
  },
);
Progress.displayName = 'Progress';

export { Progress };
