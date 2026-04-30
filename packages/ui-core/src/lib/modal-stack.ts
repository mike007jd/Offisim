import { useEffect, useState } from 'react';

type Listener = () => void;
type StackEntry = { id: string; kind: 'dialog' | 'overlay' | 'popover' };

const stack: StackEntry[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function pushEntry(entry: StackEntry): void {
  const existing = stack.findIndex((e) => e.id === entry.id);
  if (existing >= 0) stack.splice(existing, 1);
  stack.push(entry);
  emit();
}

function removeEntry(id: string): void {
  const existing = stack.findIndex((e) => e.id === id);
  if (existing < 0) return;
  stack.splice(existing, 1);
  emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getModalStackDepth(): number {
  return stack.length;
}

export function getTopmostModalId(): string | null {
  return stack.length > 0 ? (stack[stack.length - 1]?.id ?? null) : null;
}

export function isAnyModalOpen(): boolean {
  return stack.length > 0;
}

/**
 * Register an open modal (dialog or overlay) in the global stack so Office
 * shortcuts can gate on it and Escape ordering stays topmost-only.
 */
export function useRegisterModal(id: string | null, kind: StackEntry['kind'] = 'dialog'): void {
  useEffect(() => {
    if (!id) return;
    pushEntry({ id, kind });
    return () => removeEntry(id);
  }, [id, kind]);
}

/** Subscribe to stack depth changes; returns current depth. */
export function useModalStackDepth(): number {
  const [depth, setDepth] = useState<number>(() => stack.length);
  useEffect(() => {
    const unsub = subscribe(() => setDepth(stack.length));
    setDepth(stack.length);
    return unsub;
  }, []);
  return depth;
}

/** Returns `true` when the given id currently owns the topmost slot. */
export function useIsTopmostModal(id: string | null): boolean {
  const [topmost, setTopmost] = useState<boolean>(() => getTopmostModalId() === id);
  useEffect(() => {
    if (!id) {
      setTopmost(false);
      return;
    }
    const update = () => setTopmost(getTopmostModalId() === id);
    update();
    const unsub = subscribe(update);
    return unsub;
  }, [id]);
  return topmost;
}

/** Subscribe to the global "any modal open" flag for shortcut gating. */
export function useAnyModalOpen(): boolean {
  const depth = useModalStackDepth();
  return depth > 0;
}
