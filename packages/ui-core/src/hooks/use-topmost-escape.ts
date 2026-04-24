import { useEffect, useRef } from 'react';
import { getTopmostModalId } from '../lib/modal-stack.js';

/**
 * Installs a window-level Escape handler that only fires when the given id is
 * the topmost entry in the modal stack. Descendant controls get first pass at
 * Escape so nested popovers/selects can close themselves without dismissing the
 * parent surface.
 *
 * `onEscape` is held in a ref so callers don't need `useCallback` to avoid
 * reattaching the listener on every render.
 */
export function useTopmostEscape(
  id: string | null,
  onEscape: () => void,
  options: { enabled?: boolean } = {},
): void {
  const { enabled = true } = options;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  useEffect(() => {
    if (!enabled || !id) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (event.defaultPrevented) return;
      if (getTopmostModalId() !== id) return;
      event.stopPropagation();
      onEscapeRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [id, enabled]);
}
