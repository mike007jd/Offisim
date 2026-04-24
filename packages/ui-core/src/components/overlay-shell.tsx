import { X } from 'lucide-react';
import { type CSSProperties, type ReactNode, forwardRef, useCallback, useId, useRef } from 'react';
import { useFocusTrap } from '../hooks/use-focus-trap.js';
import { useTopmostEscape } from '../hooks/use-topmost-escape.js';
import { useRegisterModal } from '../lib/modal-stack.js';
import { cn } from '../lib/utils.js';

export interface OverlayShellProps {
  /** Controls whether the overlay renders. */
  open: boolean;
  /** Unique id registered in the modal stack for Escape/shortcut gating. */
  stackId?: string;
  /** Primary close request from Escape / close button / backdrop / Cancel. */
  onRequestClose: () => void;
  /** Whether backdrop click requests close. Defaults to false for dirty/wizard surfaces. */
  closeOnBackdrop?: boolean;
  /** Render the built-in top-right close button. */
  showCloseButton?: boolean;
  /** Custom a11y label for the built-in close button. */
  closeLabel?: string;
  /** Class applied to the backdrop wrapper. */
  backdropClassName?: string;
  /** Class applied to the content surface. */
  className?: string;
  /** Inline style override for the content surface (e.g. explicit width). */
  style?: CSSProperties;
  /** Accessible name for the dialog region. */
  ariaLabel?: string;
  /** Element id that labels the dialog region. */
  ariaLabelledBy?: string;
  children: ReactNode;
}

/**
 * Full-screen overlay with shared close/focus/stack behavior. Use for
 * Office-scale overlays that need a non-Radix surface (Dashboard, Kanban,
 * Employee Creator, Company Editor, Studio). Integrates with the modal stack
 * so shortcuts and underlying overlays behave correctly.
 */
export const OverlayShell = forwardRef<HTMLDivElement, OverlayShellProps>(
  (
    {
      open,
      stackId,
      onRequestClose,
      closeOnBackdrop = false,
      showCloseButton = true,
      closeLabel = 'Close',
      backdropClassName,
      className,
      style,
      ariaLabel,
      ariaLabelledBy,
      children,
    },
    ref,
  ) => {
    const generatedId = useId();
    const id = stackId ?? generatedId;
    const activeId = open ? id : null;
    useRegisterModal(activeId, 'overlay');
    useTopmostEscape(activeId, onRequestClose, { enabled: open });

    const innerRef = useRef<HTMLDivElement | null>(null);
    const setRef = useCallback(
      (node: HTMLDivElement | null) => {
        innerRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );
    useFocusTrap(innerRef, open);

    if (!open) return null;

    const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (!closeOnBackdrop) return;
      onRequestClose();
    };

    return (
      // biome-ignore lint/a11y/useKeyWithClickEvents: Backdrop dismissal is a mouse affordance only; Escape is owned by useTopmostEscape
      <div
        className={cn(
          'fixed inset-0 z-50 flex items-stretch justify-stretch bg-slate-950/70 backdrop-blur-sm',
          backdropClassName,
        )}
        onClick={handleBackdropClick}
      >
        <div
          ref={setRef}
          // biome-ignore lint/a11y/useSemanticElements: native <dialog> can't host the fixed full-screen overlay layout we need
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          tabIndex={-1}
          className={cn('relative flex min-h-0 min-w-0 flex-1 flex-col outline-none', className)}
          style={style}
        >
          {showCloseButton && (
            <button
              type="button"
              onClick={onRequestClose}
              aria-label={closeLabel}
              className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {children}
        </div>
      </div>
    );
  },
);
OverlayShell.displayName = 'OverlayShell';
