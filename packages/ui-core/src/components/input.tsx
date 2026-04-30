import { type InputHTMLAttributes, forwardRef, useId } from 'react';
import { cn } from '../lib/utils.js';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  helperText?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    { className, type, id, error, helperText, 'aria-describedby': ariaDescribedBy, ...props },
    ref,
  ) => {
    const generatedId = useId();
    const inputId = id ?? (helperText ? generatedId : undefined);
    const helperId = helperText ? `${inputId ?? generatedId}-helper` : undefined;
    const mergedDescribedBy = [ariaDescribedBy, helperId].filter(Boolean).join(' ') || undefined;
    return (
      <>
        <input
          id={inputId}
          type={type}
          aria-invalid={error || undefined}
          aria-describedby={mergedDescribedBy}
          className={cn(
            'flex h-9 w-full rounded-lg border bg-surface px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted disabled:opacity-70',
            error ? 'border-error' : 'border-border-default',
            className,
          )}
          ref={ref}
          {...props}
        />
        {helperText ? (
          <p
            id={helperId}
            className={cn('mt-1 text-xs', error ? 'text-error' : 'text-text-muted')}
          >
            {helperText}
          </p>
        ) : null}
      </>
    );
  },
);
Input.displayName = 'Input';

export { Input };
