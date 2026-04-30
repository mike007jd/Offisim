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
            'flex h-9 w-full rounded-lg border bg-white/5 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-50',
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
Input.displayName = 'Input';

export { Input };
