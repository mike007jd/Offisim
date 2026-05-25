import { cn } from '@/lib/utils.js';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import type * as React from 'react';

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'off-focusable peer inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer items-center rounded-[var(--off-r-pill)] border border-transparent transition-colors data-[state=checked]:bg-[var(--off-accent)] data-[state=unchecked]:bg-[var(--off-line-strong)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-[14px] rounded-full bg-[var(--off-surface-1)] shadow-[var(--off-elev-1)] transition-transform data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-[1px]" />
    </SwitchPrimitive.Root>
  );
}
