import { cn } from '@/lib/utils.js';
import type * as React from 'react';

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'off-input min-h-[64px] w-full resize-y rounded-[var(--off-r-sm)] border border-[var(--off-line)] bg-[var(--off-surface-1)] px-[var(--off-sp-4)] py-[var(--off-sp-3)] text-[var(--off-fs-sm)] leading-relaxed text-[var(--off-ink-1)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--off-ink-4)] hover:border-[var(--off-line-strong)] focus-visible:border-[var(--off-accent)] focus-visible:shadow-[0_0_0_3px_var(--off-accent-ring)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
