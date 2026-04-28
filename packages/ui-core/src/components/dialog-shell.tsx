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

type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const SIZE_CLASS: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[min(960px,calc(100vw-2rem))]',
};

/**
 * Canonical sizing for modal dialogs. Apply to the inner flex column so the
 * dialog's outer height never collapses below a readable floor and never
 * exceeds the viewport. Pair with `DIALOG_TABS_ROOT_CLASS` +
 * `DIALOG_TABS_CONTENT_CLASS` when the dialog body holds Radix Tabs.
 */
export const DIALOG_SIZING_CLASS = 'min-h-[clamp(360px,60vh,720px)] max-h-[min(720px,92vh)]';

/** Tabs.Root inside a sized dialog: flex column, fills, allows children to shrink. */
export const DIALOG_TABS_ROOT_CLASS = 'flex flex-col flex-1 min-h-0';

/** Tabs.Content inside a sized dialog: own internal scroll, never the dialog. */
export const DIALOG_TABS_CONTENT_CLASS = 'flex-1 min-h-0 overflow-y-auto';

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
  /** Footer slot rendered inside content (typically action buttons). */
  footer?: ReactNode;
  /** Show the built-in close button. Defaults to true. */
  showCloseButton?: boolean;
  /** Class applied to the content surface. */
  className?: string;
  /** Body content. */
  children?: ReactNode;
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
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
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
              'fixed left-[50%] top-[50%] z-50 w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
              SIZE_CLASS[size],
              className,
            )}
          >
            <div className={cn('flex flex-col', DIALOG_SIZING_CLASS)}>
              {(title || description || showCloseButton) && (
                <div className="flex items-start justify-between gap-4 border-b border-white/5 px-5 pb-3 pt-5">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    {title && (
                      <DialogPrimitive.Title className="text-base font-semibold leading-tight text-slate-100">
                        {title}
                      </DialogPrimitive.Title>
                    )}
                    {description && (
                      <DialogPrimitive.Description className="text-sm text-slate-400">
                        {description}
                      </DialogPrimitive.Description>
                    )}
                  </div>
                  {showCloseButton && (
                    <button
                      type="button"
                      onClick={requestClose}
                      aria-label="Close"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
              {footer && (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/5 bg-slate-950/40 px-5 py-3">
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

export type DialogShellCloseProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Close>;
export const DialogShellClose = DialogPrimitive.Close;
