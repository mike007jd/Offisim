import * as PopoverPrimitive from '@radix-ui/react-popover';
import {
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactNode,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useState,
} from 'react';
import { useRegisterModal } from '../lib/modal-stack.js';
import { cn } from '../lib/utils.js';

const PopoverOpenContext = createContext(false);

interface PopoverProps extends ComponentPropsWithoutRef<typeof PopoverPrimitive.Root> {
  children?: ReactNode;
}

function Popover({ open, defaultOpen, onOpenChange, children, ...props }: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
  const isControlled = open !== undefined;
  const currentOpen = isControlled ? open : uncontrolledOpen;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) setUncontrolledOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );

  return (
    <PopoverOpenContext.Provider value={currentOpen}>
      <PopoverPrimitive.Root
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={handleOpenChange}
        {...props}
      >
        {children}
      </PopoverPrimitive.Root>
    </PopoverOpenContext.Provider>
  );
}

const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;
const PopoverClose = PopoverPrimitive.Close;
const PopoverArrow = PopoverPrimitive.Arrow;

/**
 * V3 popover-card skin, derived from the lifecycle prototype `.toast` grammar:
 * a `--surface-1` base (`bg-surface-elevated`), a hairline `--line` border, and
 * the `--elev-2` shadow. Shared by `PopoverContent`, `ToastBanner`, and the
 * `SkillInstallConfirmBubble` `Card` so the toast / confirm / installable
 * surfaces all read as the same V3 status-neutral card.
 */
export const POPOVER_CARD_SKIN_CLASS =
  'rounded-md border border-line bg-surface-elevated text-text-primary shadow-elev-2';

interface PopoverContentProps extends ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> {
  container?: ComponentPropsWithoutRef<typeof PopoverPrimitive.Portal>['container'];
  /** Stable id used by modal-stack so Escape and global shortcuts respect open popovers. */
  stackId?: string;
}

const PopoverContent = forwardRef<
  ComponentRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(
  (
    {
      className,
      align = 'start',
      sideOffset = 6,
      collisionPadding = 8,
      container,
      forceMount,
      stackId,
      ...props
    },
    ref,
  ) => {
    const open = useContext(PopoverOpenContext);
    const generatedId = useId();
    const id = stackId ?? generatedId;
    useRegisterModal(open ? id : null, 'popover');

    return (
      <PopoverPrimitive.Portal container={container} forceMount={forceMount}>
        <PopoverPrimitive.Content
          ref={ref}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          role="dialog"
          aria-modal="false"
          className={cn(
            POPOVER_CARD_SKIN_CLASS,
            'z-top w-72 p-3 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[state=open]:duration-150 data-[state=closed]:duration-250 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Portal>
    );
  },
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverClose, PopoverArrow };
