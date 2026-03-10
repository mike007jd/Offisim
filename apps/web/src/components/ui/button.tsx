import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors pixel-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border-2 border-lobster-red bg-lobster-red text-pearl shadow-[2px_2px_0px_0px] shadow-abyss hover:bg-coral-orange hover:border-coral-orange',
        destructive:
          'border-2 border-error bg-error text-pearl shadow-[2px_2px_0px_0px] shadow-abyss hover:bg-error/80',
        outline:
          'border-2 border-ocean-light bg-transparent text-sand shadow-[2px_2px_0px_0px] shadow-abyss hover:bg-ocean-mid',
        secondary:
          'border-2 border-ocean-light bg-ocean-mid text-sand shadow-[2px_2px_0px_0px] shadow-abyss hover:bg-surface-lighter',
        ghost:
          'border-2 border-transparent hover:bg-ocean-mid hover:border-ocean-light',
        link:
          'text-sea-blue underline-offset-4 hover:underline border-0',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-10 px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
