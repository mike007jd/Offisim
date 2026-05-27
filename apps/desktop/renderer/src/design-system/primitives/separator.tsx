import { cn } from '@/lib/utils.js';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import type * as React from 'react';

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'off-separator',
        orientation === 'horizontal' ? 'off-separator-horizontal' : 'off-separator-vertical',
        className,
      )}
      {...props}
    />
  );
}
