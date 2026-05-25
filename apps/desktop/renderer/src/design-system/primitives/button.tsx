import { cn } from '@/lib/utils.js';
import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import type * as React from 'react';

const buttonVariants = cva(
  'off-focusable inline-flex items-center justify-center gap-[var(--off-sp-2)] whitespace-nowrap font-medium transition-[background,color,border-color,transform] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--off-accent)] text-[var(--off-accent-fg)] hover:bg-[var(--off-accent-press)]',
        destructive: 'bg-[var(--off-danger)] text-[var(--off-surface-1)] hover:brightness-95',
        outline:
          'border border-[var(--off-line)] bg-[var(--off-surface-1)] text-[var(--off-ink-2)] hover:bg-[var(--off-surface-sunken)] hover:border-[var(--off-line-strong)] hover:text-[var(--off-ink-1)]',
        subtle:
          'border border-[var(--off-line)] bg-[var(--off-surface-2)] text-[var(--off-ink-2)] hover:bg-[var(--off-surface-sunken)] hover:text-[var(--off-ink-1)]',
        ghost:
          'bg-transparent text-[var(--off-ink-2)] hover:bg-[var(--off-surface-sunken)] hover:text-[var(--off-ink-1)]',
        accentSoft:
          'border border-[var(--off-accent-ring)] bg-[var(--off-accent-surface)] text-[var(--off-accent)] hover:brightness-[0.98]',
      },
      size: {
        sm: 'h-[28px] rounded-[var(--off-r-sm)] px-[var(--off-sp-3)] text-[var(--off-fs-sm)]',
        md: 'h-[30px] rounded-[var(--off-r-sm)] px-[var(--off-sp-4)] text-[var(--off-fs-sm)]',
        lg: 'h-[34px] rounded-[var(--off-r-md)] px-[var(--off-sp-5)] text-[var(--off-fs-base)]',
        icon: 'h-[30px] w-[30px] rounded-[var(--off-r-sm)]',
        iconSm: 'h-[28px] w-[28px] rounded-[var(--off-r-sm)]',
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
