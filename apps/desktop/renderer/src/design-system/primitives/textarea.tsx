import { cn } from '@/lib/utils.js';
import type * as React from 'react';

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea data-slot="textarea" className={cn('off-input off-textarea', className)} {...props} />
  );
}
