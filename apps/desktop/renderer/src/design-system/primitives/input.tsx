import { cn } from '@/lib/utils.js';
import type * as React from 'react';

export function Input({ className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type ?? 'text'}
      data-slot="input"
      className={cn('off-input', className)}
      {...props}
    />
  );
}
