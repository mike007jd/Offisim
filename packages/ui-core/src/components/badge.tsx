import { type VariantProps, cva } from 'class-variance-authority';
import { X } from 'lucide-react';
import type { HTMLAttributes } from 'react';
import { cn } from '../lib/utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200',
        secondary: 'border-white/15 bg-white/8 text-slate-300',
        success: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
        warning: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
        error: 'border-red-400/40 bg-red-400/10 text-red-300',
        info: 'border-blue-400/40 bg-blue-400/10 text-blue-300',
        outline: 'border-white/15 text-slate-300',
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
          className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-current opacity-80 transition hover:bg-white/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export { Badge, badgeVariants };
