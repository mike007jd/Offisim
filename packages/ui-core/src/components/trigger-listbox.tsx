import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/utils.js';

export type TriggerListboxSurfaceProps = HTMLAttributes<HTMLDivElement>;

const TriggerListboxSurface = forwardRef<HTMLDivElement, TriggerListboxSurfaceProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        // ui-hardcode-allowed: tokenized geometry is owned by the reusable trigger listbox primitive.
        'absolute left-0 z-top w-[min(calc(var(--sp-8)*20),100%)] max-w-[calc(100vw-var(--sp-8))] rounded-r-md border border-border-default bg-surface-elevated text-text-primary shadow-elev-2 outline-none bottom-[calc(100%+var(--sp-1))]',
        className,
      )}
      {...props}
    />
  ),
);
TriggerListboxSurface.displayName = 'TriggerListboxSurface';

export { TriggerListboxSurface };
