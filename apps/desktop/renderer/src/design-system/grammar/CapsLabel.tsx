import { cn } from '@/lib/utils.js';
import type { HTMLAttributes } from 'react';

export function CapsLabel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('off-caps-label', className)} {...props} />;
}
