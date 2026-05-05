/**
 * ToastBanner — a lightweight, self-dismissing notification banner.
 *
 * Renders at the top of the viewport with a fixed position.
 * Auto-dismisses after `durationMs` (default 5 seconds).
 * Supports info / success / error variants using the existing design tokens.
 *
 * No external dependencies — just React + Tailwind classes.
 */

import { useCallback, useEffect, useState } from 'react';
import { cn } from '../lib/utils.js';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onAction: () => void;
  tone?: 'primary' | 'secondary' | 'danger';
}

export interface ToastItem {
  id: string;
  title?: string;
  message: string;
  variant: ToastVariant;
  actions?: ToastAction[];
  /** Optional action button label */
  actionLabel?: string;
  /** Callback when action button is clicked */
  onAction?: () => void;
  /** Override auto-dismiss duration in ms (uses component default if omitted) */
  durationMs?: number | null;
}

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  info: 'border-info bg-surface-elevated text-text-primary',
  success: 'border-success bg-success-muted text-success',
  warning: 'border-warning bg-warning-muted text-warning',
  error: 'border-error bg-error-muted text-error',
};

const ACTION_CLASSES: Record<NonNullable<ToastAction['tone']>, string> = {
  primary: 'border-accent bg-accent-muted text-accent-text hover:bg-surface-hover',
  secondary: 'border-border-default bg-surface-muted text-text-secondary hover:bg-surface-hover',
  danger: 'border-error bg-error-muted text-error hover:bg-surface-hover',
};

const DEFAULT_DURATION_MS = 5_000;

interface ToastBannerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  durationMs?: number;
}

function ToastEntry({
  toast,
  onDismiss,
  durationMs,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  durationMs: number;
}) {
  const effectiveDuration = toast.durationMs ?? durationMs;
  useEffect(() => {
    if (effectiveDuration === null || effectiveDuration === Number.POSITIVE_INFINITY) return;
    const timer = setTimeout(() => onDismiss(toast.id), effectiveDuration);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss, effectiveDuration]);

  const actions =
    toast.actions ??
    (toast.actionLabel && toast.onAction
      ? [{ label: toast.actionLabel, onAction: toast.onAction, tone: 'secondary' as const }]
      : []);

  return (
    // biome-ignore lint/a11y/useSemanticElements: role=status on div is the standard ARIA live region pattern; <output> is form-associated and not applicable here
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-auto flex max-w-[min(92vw,560px)] items-start justify-between gap-3 rounded-lg border px-4 py-2 text-xs shadow-lg backdrop-blur-sm',
        'animate-[offisim-toast-slide-in_180ms_ease-out]',
        VARIANT_CLASSES[toast.variant],
      )}
    >
      <div className="min-w-0">
        {toast.title && <p className="font-semibold">{toast.title}</p>}
        <p className={cn('leading-relaxed', toast.title && 'mt-0.5 opacity-85')}>{toast.message}</p>
      </div>
      <div className="ml-2 flex shrink-0 items-center gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => {
              action.onAction();
              onDismiss(toast.id);
            }}
            className={cn(
              'rounded-md border px-2 py-1 font-semibold transition-colors',
              ACTION_CLASSES[action.tone ?? 'secondary'],
            )}
          >
            {action.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="opacity-60 hover:opacity-100"
          aria-label="Dismiss"
        >
          x
        </button>
      </div>
    </div>
  );
}

export function ToastBanner({
  toasts,
  onDismiss,
  durationMs = DEFAULT_DURATION_MS,
}: ToastBannerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-top flex flex-col items-center gap-2 p-4">
      {toasts.map((t) => (
        <ToastEntry key={t.id} toast={t} onDismiss={onDismiss} durationMs={durationMs} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// useToasts — simple state manager for toast items
// ---------------------------------------------------------------------------

let toastCounter = 0;

export interface AddToastOptions {
  title?: string;
  actions?: ToastAction[];
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number | null;
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback(
    (message: string, variant: ToastVariant = 'info', options?: AddToastOptions) => {
      const id = `toast-${++toastCounter}-${Date.now()}`;
      setToasts((prev) => [...prev, { id, message, variant, ...options }]);
    },
    [],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, dismissToast };
}
