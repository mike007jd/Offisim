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
        'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-white/20 bg-white/5 text-cyan-100 shadow-sm transition-colors hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-cyan-400/60 data-[state=checked]:bg-cyan-500/20 data-[state=indeterminate]:border-cyan-400/60 data-[state=indeterminate]:bg-cyan-500/20',
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
  <label className="flex items-start gap-2 text-sm text-slate-200" htmlFor={id}>
    <Checkbox ref={ref} id={id} className={className} {...props} />
    <span className="grid gap-0.5">
      <span>{label}</span>
      {description ? <span className="text-xs text-slate-400">{description}</span> : null}
    </span>
  </label>
));
CheckboxField.displayName = 'CheckboxField';

export { Checkbox, CheckboxField };
