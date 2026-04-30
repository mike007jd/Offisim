import * as SwitchPrimitive from '@radix-ui/react-switch';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';
import { cn } from '../lib/utils.js';

export interface SwitchProps extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  size?: 'sm' | 'md';
}

const Switch = forwardRef<React.ComponentRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  ({ className, size = 'md', ...props }, ref) => {
    const isSm = size === 'sm';
    return (
      <SwitchPrimitive.Root
        ref={ref}
        className={cn(
          'peer inline-flex shrink-0 cursor-pointer items-center rounded-full border border-white/10 bg-white/10 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-cyan-500/40',
          isSm ? 'h-4 w-7' : 'h-5 w-9',
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            'pointer-events-none block rounded-full bg-white shadow-lg ring-0 transition-transform duration-150 ease-standard',
            isSm
              ? 'h-3 w-3 translate-x-0.5 data-[state=checked]:translate-x-3.5'
              : 'h-4 w-4 translate-x-0.5 data-[state=checked]:translate-x-[1.125rem]',
          )}
        />
      </SwitchPrimitive.Root>
    );
  },
);
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
