import { type VariantProps, cva } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../lib/utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
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
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
