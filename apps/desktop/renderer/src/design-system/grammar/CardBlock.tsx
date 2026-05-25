import { cn } from '@/lib/utils.js';
import type { HTMLAttributes } from 'react';

export function CardBlock({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={cn('off-card-block', className)} {...props} />;
}
