import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/utils.js';
import { Button, type ButtonProps } from './button.js';

const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-r-md border border-line bg-surface-1 text-ink-1 shadow-elev-1',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-sp-1 p-sp-4', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('font-semibold leading-none tracking-normal', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-fs-sm text-ink-3', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-sp-4 pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-end gap-sp-2 border-t border-line-soft p-sp-4 pt-0',
        className,
      )}
      {...props}
    />
  ),
);
CardFooter.displayName = 'CardFooter';

export interface CardButtonProps extends Omit<ButtonProps, 'variant' | 'size'> {
  selected?: boolean;
}

const CardButton = forwardRef<HTMLButtonElement, CardButtonProps>(
  ({ className, selected = false, ...props }, ref) => (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      className={cn(
        'absolute inset-0 z-elevated h-full w-full rounded-r-md border-0 bg-transparent p-0 text-transparent hover:bg-transparent focus-visible:ring-inset',
        selected && 'ring-2 ring-inset ring-border-focus',
        className,
      )}
      {...props}
    />
  ),
);
CardButton.displayName = 'CardButton';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardButton };
