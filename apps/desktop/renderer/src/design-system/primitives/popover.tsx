import { cn } from '@/lib/utils.js';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import type * as React from 'react';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  align = 'center',
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn('off-motion-popover off-popover-content', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
