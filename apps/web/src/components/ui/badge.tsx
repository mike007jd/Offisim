import { type VariantProps, cva } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center border-2 px-2 py-0.5 text-xs font-semibold font-pixel-mono transition-colors',
  {
    variants: {
      variant: {
        default: 'border-lobster-red bg-lobster-red/20 text-lobster-red',
        secondary: 'border-ocean-light bg-ocean-mid text-shell',
        success: 'border-kelp-green bg-kelp-green/20 text-kelp-green',
        warning: 'border-coral-orange bg-coral-orange/20 text-coral-orange',
        error: 'border-lobster-red bg-lobster-red/20 text-lobster-red',
        info: 'border-sea-blue bg-sea-blue/20 text-sea-blue',
        outline: 'border-ocean-light text-shell',
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
