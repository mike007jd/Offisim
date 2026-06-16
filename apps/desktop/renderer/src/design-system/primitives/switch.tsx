import { cn } from '@/lib/utils.js';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import type * as React from 'react';

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root className={cn('off-focusable off-switch', className)} {...props}>
      <SwitchPrimitive.Thumb className="off-switch-thumb" />
    </SwitchPrimitive.Root>
  );
}
