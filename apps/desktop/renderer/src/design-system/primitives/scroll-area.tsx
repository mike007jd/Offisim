import { cn } from '@/lib/utils.js';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import type * as React from 'react';

export function ScrollArea({
  className,
  children,
  viewportRef,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport ref={viewportRef} className="off-scroll-viewport">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      orientation={orientation}
      className={cn(
        'off-scrollbar',
        orientation === 'vertical' && 'off-scrollbar-vertical',
        orientation === 'horizontal' && 'off-scrollbar-horizontal',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="off-scroll-thumb" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}
