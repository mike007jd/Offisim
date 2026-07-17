import { useSyncExternalStore } from 'react';

export interface ReviewPrPrefill {
  id: string;
  projectId: string;
  leaseId: string;
  title: string;
  body: string;
}

interface ReviewPrPrefillStore {
  snapshot: ReviewPrPrefill | null;
  listeners: Set<() => void>;
}

const STORE_KEY = '__offisimReviewPrPrefillStore__' as const;
const rendererScope = globalThis as typeof globalThis & {
  [STORE_KEY]?: ReviewPrPrefillStore;
};
const existingStore = rendererScope[STORE_KEY];
const store = existingStore ?? {
  snapshot: null,
  listeners: new Set(),
};
if (!existingStore) rendererScope[STORE_KEY] = store;

function subscribe(listener: () => void) {
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

function getSnapshot() {
  return store.snapshot;
}

export function publishReviewPrPrefill(input: Omit<ReviewPrPrefill, 'id'>) {
  store.snapshot = { ...input, id: crypto.randomUUID() };
  for (const listener of store.listeners) listener();
}

export function useReviewPrPrefill(projectId: string): ReviewPrPrefill | null {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return current?.projectId === projectId ? current : null;
}
