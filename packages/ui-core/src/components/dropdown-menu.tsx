import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import {
  type ComponentPropsWithoutRef,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useState,
} from 'react';
import { useRegisterModal } from '../lib/modal-stack.js';
import { cn } from '../lib/utils.js';

const DropdownOpenContext = createContext(false);

type DropdownRootProps = ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>;

function DropdownMenu({ open, defaultOpen, onOpenChange, children, ...props }: DropdownRootProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
  const isControlled = open !== undefined;
  const currentOpen = isControlled ? open : uncontrolledOpen;
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );
  return (
    <DropdownOpenContext.Provider value={currentOpen}>
      <DropdownMenuPrimitive.Root
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={handleOpenChange}
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.Root>
    </DropdownOpenContext.Provider>
  );
}

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuContent = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => {
  const open = useContext(DropdownOpenContext);
  const id = useId();
  useRegisterModal(open ? id : null, 'popover');
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[8rem] overflow-hidden rounded-lg border border-border-default bg-surface-elevated p-1 text-text-primary shadow-xl',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    variant?: 'default' | 'destructive';
  }
>(({ className, variant = 'default', ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-secondary outline-none transition-colors',
      variant === 'destructive'
        ? 'text-error focus:bg-error-muted focus:text-error hover:text-error focus-visible:bg-error-muted'
        : 'focus:bg-surface-hover focus:text-text-primary',
      'focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-inset',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem };
