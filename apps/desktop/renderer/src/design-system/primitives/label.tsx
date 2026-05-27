import { cn } from '@/lib/utils.js';
import * as LabelPrimitive from '@radix-ui/react-label';
import type * as React from 'react';

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn('off-label', className)}
      {...props}
    />
  );
}
