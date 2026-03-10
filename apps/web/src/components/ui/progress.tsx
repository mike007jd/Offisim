import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';

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
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        tabIndex={0}
        className={cn(
          'relative h-2 w-full overflow-hidden rounded-full bg-surface-lighter',
          className,
        )}
        {...props}
      >
        <div
          className="h-full rounded-full bg-accent transition-all duration-300 ease-in-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = 'Progress';

export { Progress };
