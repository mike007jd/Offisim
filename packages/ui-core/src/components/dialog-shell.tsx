import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  forwardRef,
  useCallback,
  useId,
} from 'react';
import { useRegisterModal } from '../lib/modal-stack.js';
import { cn } from '../lib/utils.js';
import { Button } from './button.js';

type DialogSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full';

const SIZE_CLASS: Record<DialogSize, string> = {
  xs: 'max-w-sm',
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-5xl',
};

const BOTTOM_SHEET_CONTENT_CLASS =
  'fixed inset-x-0 bottom-0 z-modal flex flex-col rounded-t-r-lg border border-line bg-surface-1 text-ink-1 shadow-elev-3 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom-2 data-[state=open]:slide-in-from-bottom-2 data-[state=open]:duration-150 data-[state=closed]:duration-250';
const BOTTOM_SHEET_CLOSE_ICON_CLASS = 'size-sp-4';

/**
 * Canonical sizing for modal dialogs. Apply to the inner flex column so the
 * dialog's outer height never collapses below a readable floor and never
 * exceeds the viewport. Pair with `DIALOG_TABS_ROOT_CLASS` +
 * `DIALOG_TABS_CONTENT_CLASS` when the dialog body holds Radix Tabs.
 */
export const DIALOG_SIZING_CLASS = 'min-h-96 max-h-[min(720px,92vh)]'; // ui-hardcode-allowed: viewport cap for modal body, centralized primitive.

/** Tabs.Root inside a sized dialog: flex column, fills, allows children to shrink. */
export const DIALOG_TABS_ROOT_CLASS = 'flex flex-col flex-1 min-h-0';

/**
 * Tabs.Content inside a sized dialog: own internal scroll, never the dialog.
 * The 320px floor prevents empty/async tab bodies from collapsing the dialog.
 * Use with `DIALOG_TABS_ROOT_CLASS`; pair `forceMount` +
 * `TABS_RETAIN_STATE_CLASS` when the tab content must preserve state or avoid
 * layout shifts (see the layout-shift-stability capability).
 */
export const DIALOG_TABS_CONTENT_CLASS = 'flex-1 min-h-80 overflow-y-auto';

/**
 * Radix Tabs retain-state class for layout-stable tabs. Use with `forceMount`
 * so inactive panels stay mounted and are hidden instead of unmounted.
 */
export const TABS_RETAIN_STATE_CLASS = 'data-[state=inactive]:hidden';

export interface DialogShellProps {
  /** Controlled open state. */
  open: boolean;
  /** Called when the user invokes any close action (Escape, backdrop, close button). */
  onOpenChange: (open: boolean) => void;
  /** Stack id used for Escape/shortcut gating. */
  stackId?: string;
  /** Size preset. */
  size?: DialogSize;
  /** Disable backdrop click-to-close (dirty / wizard surfaces). */
  closeOnBackdrop?: boolean;
  /** Disable Escape-to-close (use `onRequestClose` style flow instead). */
  closeOnEscape?: boolean;
  /** Called before close; return `false` to block (e.g. dirty guard). */
  onRequestClose?: () => boolean | undefined;
  /** Title text or rendered element. */
  title?: ReactNode;
  /** Optional description below title. */
  description?: ReactNode;
  /** Accessible title used when a description is visible but no title is rendered. */
  visuallyHiddenLabel?: string;
  /** Footer slot rendered inside content (typically action buttons). */
  footer?: ReactNode;
  /** Show the built-in close button. Defaults to true. */
  showCloseButton?: boolean;
  /** Class applied to the content surface. */
  className?: string;
  /** Body content. */
  children?: ReactNode;
}

export interface BottomSheetShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stackId?: string;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  onRequestClose?: () => boolean | undefined;
  showCloseButton?: boolean;
  backdropClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Shared dialog shell built on Radix. Handles open/close through a single path
 * (Escape, backdrop, Cancel, close button, completion). Caller owns dirty
 * checks via `onRequestClose`.
 */
export const DialogShell = forwardRef<HTMLDivElement, DialogShellProps>(
  (
    {
      open,
      onOpenChange,
      stackId,
      size = 'md',
      closeOnBackdrop = true,
      closeOnEscape = true,
      onRequestClose,
      title,
      description,
      visuallyHiddenLabel,
      footer,
      showCloseButton = true,
      className,
      children,
    },
    ref,
  ) => {
    const generatedId = useId();
    const id = stackId ?? generatedId;
    useRegisterModal(open ? id : null, 'dialog');

    const requestClose = useCallback(() => {
      if (!onRequestClose) {
        onOpenChange(false);
        return;
      }
      const result = onRequestClose();
      if (result !== false) onOpenChange(false);
    }, [onRequestClose, onOpenChange]);

    const handleOpenChange = useCallback(
      (nextOpen: boolean) => {
        if (nextOpen) {
          onOpenChange(true);
          return;
        }
        requestClose();
      },
      [onOpenChange, requestClose],
    );

    return (
      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-modal bg-glass-bg backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:duration-150 data-[state=closed]:duration-250" />
          {/* Radix Dialog.Content sets role="dialog" and aria-modal="true". */}
          <DialogPrimitive.Content
            ref={ref}
            onEscapeKeyDown={(event) => {
              if (!closeOnEscape) {
                event.preventDefault();
                return;
              }
              event.preventDefault();
              requestClose();
            }}
            onPointerDownOutside={(event) => {
              if (!closeOnBackdrop) {
                event.preventDefault();
                return;
              }
            }}
            onInteractOutside={(event) => {
              if (!closeOnBackdrop) event.preventDefault();
            }}
            className={cn(
              'fixed inset-x-2 top-1/2 z-modal mx-auto w-auto -translate-y-1/2 overflow-hidden rounded-lg border border-line bg-surface-1 text-ink-1 shadow-elev-3 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=open]:duration-150 data-[state=closed]:duration-250 sm:inset-x-4',
              SIZE_CLASS[size],
              className,
            )}
          >
            <div className={cn('flex flex-col', DIALOG_SIZING_CLASS)}>
              {!title && (
                <DialogPrimitive.Title className="sr-only">
                  {visuallyHiddenLabel ?? 'Dialog'}
                </DialogPrimitive.Title>
              )}
              {(title || description || showCloseButton) && (
                <div className="flex items-start justify-between gap-4 border-b border-line-soft px-sp-7 pb-sp-4 pt-sp-5">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    {title && (
                      <DialogPrimitive.Title className="text-fs-xl font-semibold leading-tight text-ink-1">
                        {title}
                      </DialogPrimitive.Title>
                    )}
                    {description && (
                      <DialogPrimitive.Description className="text-fs-sm text-ink-3">
                        {description}
                      </DialogPrimitive.Description>
                    )}
                  </div>
                  {showCloseButton && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={requestClose}
                      aria-label="Close"
                      // 6px hit-area padding around the icon, mobile only — keeps the
                      // visible target compact while honoring touch-target minimums.
                      className="relative h-8 w-8 shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto px-sp-7 py-sp-5">{children}</div>
              {footer && (
                <div className="flex flex-wrap items-center justify-end gap-sp-3 border-t border-line-soft bg-surface-2 px-sp-7 py-sp-4">
                  {footer}
                </div>
              )}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  },
);
DialogShell.displayName = 'DialogShell';

export const BottomSheetShell = forwardRef<HTMLDivElement, BottomSheetShellProps>(
  (
    {
      open,
      onOpenChange,
      stackId,
      title,
      description,
      footer,
      closeLabel = 'Close',
      closeOnBackdrop = true,
      closeOnEscape = true,
      onRequestClose,
      showCloseButton = true,
      backdropClassName,
      headerClassName,
      bodyClassName,
      children,
      className,
    },
    ref,
  ) => {
    const generatedId = useId();
    const id = stackId ?? generatedId;
    useRegisterModal(open ? id : null, 'dialog');

    const requestClose = useCallback(() => {
      if (!onRequestClose) {
        onOpenChange(false);
        return;
      }
      const result = onRequestClose();
      if (result !== false) onOpenChange(false);
    }, [onRequestClose, onOpenChange]);

    const handleOpenChange = useCallback(
      (nextOpen: boolean) => {
        if (nextOpen) {
          onOpenChange(true);
          return;
        }
        requestClose();
      },
      [onOpenChange, requestClose],
    );

    return (
      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              'fixed inset-0 z-modal bg-glass-bg backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:duration-150 data-[state=closed]:duration-250',
              backdropClassName,
            )}
          />
          <DialogPrimitive.Content
            ref={ref}
            onEscapeKeyDown={(event) => {
              if (!closeOnEscape) {
                event.preventDefault();
                return;
              }
              event.preventDefault();
              requestClose();
            }}
            onPointerDownOutside={(event) => {
              if (!closeOnBackdrop) {
                event.preventDefault();
                return;
              }
            }}
            onInteractOutside={(event) => {
              if (!closeOnBackdrop) event.preventDefault();
            }}
            className={cn(
              BOTTOM_SHEET_CONTENT_CLASS,
              // ui-hardcode-allowed: bottom sheet viewport cap uses ui-core token emitted into generated theme CSS.
              'max-h-[var(--bottom-sheet-shell-max-height)]',
              className,
            )}
          >
            <div
              className={cn(
                'flex items-start justify-between gap-sp-4 border-b border-line-soft px-sp-4 py-sp-3',
                headerClassName,
              )}
            >
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className="text-fs-sm font-semibold text-ink-1">
                  {title}
                </DialogPrimitive.Title>
                {description && (
                  <DialogPrimitive.Description className="mt-sp-1 text-caption text-ink-3">
                    {description}
                  </DialogPrimitive.Description>
                )}
              </div>
              {showCloseButton && (
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={requestClose}
                  aria-label={closeLabel}
                >
                  <X className={BOTTOM_SHEET_CLOSE_ICON_CLASS} />
                </Button>
              )}
            </div>
            <div className={cn('min-h-0 flex-1 overflow-y-auto p-sp-4', bodyClassName)}>
              {children}
            </div>
            {footer && (
              <div className="flex flex-wrap items-center justify-end gap-sp-3 border-t border-line-soft bg-surface-2 px-sp-4 py-sp-3">
                {footer}
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  },
);
BottomSheetShell.displayName = 'BottomSheetShell';

export type DialogShellCloseProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Close>;
export const DialogShellClose = DialogPrimitive.Close;
