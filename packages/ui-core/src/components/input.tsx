import { type InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/utils.js';

const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full border-2 border-t-abyss border-l-abyss border-b-ocean-light border-r-ocean-light bg-ocean-deep px-3 py-1 text-sm text-sand placeholder:text-shell focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lobster-red disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
