import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
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

const SelectOpenContext = createContext(false);

type SelectRootProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Root>;

function Select({ open, defaultOpen, onOpenChange, children, ...props }: SelectRootProps) {
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
    <SelectOpenContext.Provider value={currentOpen}>
      <SelectPrimitive.Root
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={handleOpenChange}
        {...props}
      >
        {children}
      </SelectPrimitive.Root>
    </SelectOpenContext.Provider>
  );
}

const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

export interface SelectTriggerProps
  extends ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> {
  error?: boolean;
  helperText?: string;
}

const SelectTrigger = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(
  (
    { className, children, id, error, helperText, 'aria-describedby': ariaDescribedBy, ...props },
    ref,
  ) => {
    const generatedId = useId();
    const triggerId = id ?? (helperText ? generatedId : undefined);
    const helperId = helperText ? `${triggerId ?? generatedId}-helper` : undefined;
    const mergedDescribedBy = [ariaDescribedBy, helperId].filter(Boolean).join(' ') || undefined;
    return (
      <>
        <SelectPrimitive.Trigger
          ref={ref}
          id={triggerId}
          aria-invalid={error || undefined}
          aria-describedby={mergedDescribedBy}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-lg border bg-surface px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted disabled:opacity-70',
            error ? 'border-error' : 'border-border-default',
            className,
          )}
          {...props}
        >
          {children}
          <SelectPrimitive.Icon asChild>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        {helperText ? (
          <p
            id={helperId}
            className={cn('mt-1 text-xs', error ? 'text-error' : 'text-text-muted')}
          >
            {helperText}
          </p>
        ) : null}
      </>
    );
  },
);
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => {
  const open = useContext(SelectOpenContext);
  const id = useId();
  useRegisterModal(open ? id : null, 'popover');
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          'relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-lg border border-border-default bg-surface-elevated text-text-primary shadow-xl',
          position === 'popper' && 'translate-y-1',
          className,
        )}
        position={position}
        {...props}
      >
        <SelectPrimitive.Viewport
          className={cn(
            'p-1',
            position === 'popper' &&
              'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-md py-1.5 pl-2 pr-8 text-sm text-text-primary outline-none focus:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      'focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-inset',
      className,
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem };
