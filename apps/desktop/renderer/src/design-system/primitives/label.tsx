import { cn } from '@/lib/utils.js';
import * as LabelPrimitive from '@radix-ui/react-label';
import type * as React from 'react';

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        'text-[var(--off-fs-meta)] font-[560] text-[var(--off-ink-2)] peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
