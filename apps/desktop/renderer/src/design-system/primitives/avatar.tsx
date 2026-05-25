import { cn } from '@/lib/utils.js';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import type * as React from 'react';

export function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      className={cn('relative flex size-[30px] shrink-0 overflow-hidden rounded-[26%]', className)}
      {...props}
    />
  );
}

export function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return <AvatarPrimitive.Image className={cn('aspect-square size-full', className)} {...props} />;
}

export function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        'flex size-full items-center justify-center bg-[var(--off-surface-sunken)] text-[var(--off-fs-meta)] font-[720] text-[var(--off-ink-2)]',
        className,
      )}
      {...props}
    />
  );
}
