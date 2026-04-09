import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/utils.js';

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  /** Value between 0 and 100 */
  value?: number;
  /** Maximum value (default 100) */
  max?: number;
}

const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, max = 100, ...props }, ref) => {
    const pct = Math.min(100, Math.max(0, (value / max) * 100));

    return (
      // biome-ignore lint/a11y/useFocusableInteractive: progressbar is a status role, not interactive — focus is not required
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className={cn(
          'relative h-2 w-full overflow-hidden rounded-full bg-white/10 border border-white/5',
          className,
        )}
        {...props}
      >
        <div
          className="h-full rounded-full bg-cyan-400 transition-all duration-300 ease-in-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = 'Progress';

export { Progress };
