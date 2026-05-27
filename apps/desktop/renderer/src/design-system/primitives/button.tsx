import { cn } from '@/lib/utils.js';
import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import type * as React from 'react';

const buttonVariants = cva(
  'off-focusable off-button',
  {
    variants: {
      variant: {
        default: 'off-button-default',
        destructive: 'off-button-destructive',
        outline: 'off-button-outline',
        subtle: 'off-button-subtle',
        ghost: 'off-button-ghost',
        accentSoft: 'off-button-accent-soft',
      },
      size: {
        sm: 'off-button-sm',
        md: 'off-button-md',
        lg: 'off-button-lg',
        icon: 'off-button-icon',
        iconSm: 'off-button-icon-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...props}
    />
  );
}

export { buttonVariants };
