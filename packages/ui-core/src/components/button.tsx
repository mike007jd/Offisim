import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import {
  type ButtonHTMLAttributes,
  Children,
  type ReactNode,
  forwardRef,
  isValidElement,
  useEffect,
} from 'react';
import { cn } from '../lib/utils.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border border-border-focus bg-accent-muted text-accent-text hover:border-accent hover:bg-surface-hover',
        accent:
          'border border-accent bg-accent text-text-inverse hover:border-accent-hover hover:bg-accent-hover active:scale-95 disabled:hover:bg-accent',
        destructive:
          'border border-error bg-error-muted text-error hover:border-error hover:bg-surface-hover',
        outline:
          'border border-border-default bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary',
        secondary:
          'border border-border-default bg-surface-muted text-text-secondary hover:bg-surface-hover hover:text-text-primary',
        ghost:
          'border border-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary',
        link: 'border-0 text-accent underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-10 px-8',
        icon: 'h-9 w-9',
        iconSm: 'size-7',
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

function hasTextChildren(children: ReactNode): boolean {
  return Children.toArray(children).some((child) => {
    if (typeof child === 'string') return child.trim().length > 0;
    if (typeof child === 'number') return true;
    if (!isValidElement(child)) return false;
    return hasTextChildren((child.props as { children?: ReactNode }).children);
  });
}

function isDevBuild(): boolean {
  return Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
}

function isIconButtonSize(size: ButtonProps['size']): boolean {
  return size === 'icon' || size === 'iconSm';
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      disabled,
      children,
      'aria-label': ariaLabel,
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    useEffect(() => {
      if (
        isDevBuild() &&
        isIconButtonSize(size) &&
        !ariaLabel &&
        !ariaDescribedBy &&
        !hasTextChildren(children)
      ) {
        console.warn('[ui-core] Button size="icon" requires aria-label or aria-describedby');
      }
    }, [ariaDescribedBy, ariaLabel, children, size]);
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        {...props}
      >
        {children}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
