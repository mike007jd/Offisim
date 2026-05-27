import { cn } from '@/lib/utils.js';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import type * as React from 'react';

export function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      className={cn('off-avatar-root', className)}
      {...props}
    />
  );
}

export function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return <AvatarPrimitive.Image className={cn('off-avatar-image', className)} {...props} />;
}

export function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        'off-avatar-fallback',
        className,
      )}
      {...props}
    />
  );
}
