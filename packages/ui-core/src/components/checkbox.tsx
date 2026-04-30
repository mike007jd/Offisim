import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { cn } from '../lib/utils.js';

export type CheckboxProps = ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;

const Checkbox = forwardRef<React.ComponentRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  ({ className, checked, ...props }, ref) => (
    <CheckboxPrimitive.Root
      ref={ref}
      checked={checked}
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border-default bg-surface text-accent shadow-sm transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent-muted data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent-muted',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center" forceMount>
        {checked === 'indeterminate' ? (
          <Minus className="h-3 w-3" aria-hidden="true" />
        ) : (
          <Check className="h-3 w-3" aria-hidden="true" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  ),
);
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

interface CheckboxFieldProps extends CheckboxProps {
  label: React.ReactNode;
  description?: React.ReactNode;
}

const CheckboxField = forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  CheckboxFieldProps
>(({ label, description, id, className, ...props }, ref) => (
  <label className="flex items-start gap-2 text-sm text-text-primary" htmlFor={id}>
    <Checkbox ref={ref} id={id} className={className} {...props} />
    <span className="grid gap-0.5">
      <span>{label}</span>
      {description ? <span className="text-xs text-text-secondary">{description}</span> : null}
    </span>
  </label>
));
CheckboxField.displayName = 'CheckboxField';

export { Checkbox, CheckboxField };
