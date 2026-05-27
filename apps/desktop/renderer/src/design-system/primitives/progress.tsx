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
      className={cn('off-progress', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="off-progress-indicator"
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
