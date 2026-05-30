import { cn } from '@/lib/utils.js';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import type * as React from 'react';

export function Progress({
  className,
  value,
  max,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const ratio = ((value ?? 0) / (max ?? 100)) * 100;
  return (
    <ProgressPrimitive.Root
      className={cn('off-progress', className)}
      value={value}
      max={max}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="off-progress-indicator"
        style={{ transform: `translateX(-${100 - ratio}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
