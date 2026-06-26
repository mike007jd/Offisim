import { create } from 'zustand';

/**
 * Open/close state for the `/loop` searchable Loop picker (PR-10). The slash
 * command sets `open=true`; the picker dialog (LoopPicker) subscribes and renders.
 * Kept tiny + separate so `composer-triggers.ts` (pure-ish wiring) can trigger the
 * picker without importing the React dialog (no cycle).
 */
interface LoopPickerStore {
  open: boolean;
  openPicker: () => void;
  closePicker: () => void;
}

export const useLoopPickerStore = create<LoopPickerStore>((set) => ({
  open: false,
  openPicker: () => set({ open: true }),
  closePicker: () => set({ open: false }),
}));

/** Imperative open used by the `/loop` slash command's `execute`. */
export function openLoopPicker(): void {
  useLoopPickerStore.getState().openPicker();
}
