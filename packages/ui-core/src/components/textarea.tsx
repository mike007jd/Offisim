import { type TextareaHTMLAttributes, forwardRef, useId } from 'react';
import { cn } from '../lib/utils.js';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
  helperText?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, id, error, helperText, 'aria-describedby': ariaDescribedBy, ...props }, ref) => {
    const generatedId = useId();
    const textareaId = id ?? (helperText ? generatedId : undefined);
    const helperId = helperText ? `${textareaId ?? generatedId}-helper` : undefined;
    const mergedDescribedBy = [ariaDescribedBy, helperId].filter(Boolean).join(' ') || undefined;
    return (
      <>
        <textarea
          id={textareaId}
          aria-invalid={error || undefined}
          aria-describedby={mergedDescribedBy}
          className={cn(
            'flex min-h-[60px] w-full rounded-lg border bg-white/5 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-50',
            error ? 'border-red-400/60' : 'border-white/15',
            className,
          )}
          ref={ref}
          {...props}
        />
        {helperText ? (
          <p
            id={helperId}
            className={cn('mt-1 text-xs', error ? 'text-red-300' : 'text-slate-400')}
          >
            {helperText}
          </p>
        ) : null}
      </>
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
