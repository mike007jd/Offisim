import { type TextareaHTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/utils.js';

const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[60px] w-full border-2 border-t-abyss border-l-abyss border-b-ocean-light border-r-ocean-light bg-ocean-deep px-3 py-2 text-sm text-sand placeholder:text-shell focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lobster-red disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
