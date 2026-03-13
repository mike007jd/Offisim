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

export type ToastVariant = 'info' | 'success' | 'error';

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  info: 'border-ocean-light bg-ocean-mid text-sand',
  success: 'border-kelp-green bg-kelp-green/10 text-kelp-green',
  error: 'border-lobster-red bg-lobster-red/10 text-lobster-red',
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
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), durationMs);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss, durationMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-auto flex items-center justify-between gap-3 border-2 px-4 py-2 font-pixel-mono text-xs shadow-md',
        VARIANT_CLASSES[toast.variant],
      )}
    >
      <span>{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="ml-2 shrink-0 opacity-60 hover:opacity-100"
        aria-label="Dismiss"
      >
        x
      </button>
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
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 p-4">
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

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = `toast-${++toastCounter}-${Date.now()}`;
    setToasts((prev) => [...prev, { id, message, variant }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, dismissToast };
}
