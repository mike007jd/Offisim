import { cn } from '@/lib/utils.js';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import type * as React from 'react';

export function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      className={cn(
        'relative h-[4px] w-full overflow-hidden rounded-[var(--off-r-pill)] bg-[var(--off-line-strong)]',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full bg-[var(--off-accent)] transition-transform"
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
