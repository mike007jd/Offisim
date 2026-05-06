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
            'flex min-h-[60px] w-full rounded-lg border bg-surface px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted disabled:opacity-70',
            error ? 'border-error' : 'border-border-default',
            className,
          )}
          ref={ref}
          {...props}
        />
        {helperText ? (
          <p id={helperId} className={cn('mt-1 text-xs', error ? 'text-error' : 'text-text-muted')}>
            {helperText}
          </p>
        ) : null}
      </>
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
