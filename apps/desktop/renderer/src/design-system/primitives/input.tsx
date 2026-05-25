import { cn } from '@/lib/utils.js';
import type * as React from 'react';

export function Input({ className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type ?? 'text'}
      data-slot="input"
      className={cn(
        'off-input h-[32px] w-full rounded-[var(--off-r-sm)] border border-[var(--off-line)] bg-[var(--off-surface-1)] px-[var(--off-sp-4)] text-[var(--off-fs-sm)] text-[var(--off-ink-1)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--off-ink-4)] hover:border-[var(--off-line-strong)] focus-visible:border-[var(--off-accent)] focus-visible:shadow-[0_0_0_3px_var(--off-accent-ring)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
