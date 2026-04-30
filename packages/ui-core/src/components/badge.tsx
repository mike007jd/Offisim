import { type VariantProps, cva } from 'class-variance-authority';
import { X } from 'lucide-react';
import type { HTMLAttributes } from 'react';
import { cn } from '../lib/utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-accent bg-accent-muted text-accent-text',
        secondary: 'border-border-default bg-surface-muted text-text-secondary',
        success: 'border-success bg-success-muted text-success',
        warning: 'border-warning bg-warning-muted text-warning',
        error: 'border-error bg-error-muted text-error',
        info: 'border-info bg-info-muted text-info',
        outline: 'border-border-default text-text-secondary',
      },
      size: {
        xs: 'px-1.5 py-0.5 text-[10px]',
        sm: 'px-2.5 py-0.5 text-xs',
        md: 'px-3 py-1 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'sm',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  dismissible?: boolean;
  onDismiss?: () => void;
}

function Badge({
  className,
  variant,
  size,
  dismissible,
  onDismiss,
  children,
  ...props
}: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {children}
      {dismissible ? (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-current opacity-80 transition hover:bg-surface-hover hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export { Badge, badgeVariants };
