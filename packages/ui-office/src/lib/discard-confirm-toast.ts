import type { AddToastOptions, ToastVariant } from '@offisim/ui-core';

export type AddToast = (message: string, variant?: ToastVariant, options?: AddToastOptions) => void;

export interface ShowDiscardConfirmOptions {
  onDiscard: () => void;
  onKeep?: () => void;
  message?: string;
}

export function showDiscardConfirm(
  addToast: AddToast,
  { onDiscard, onKeep, message = 'Your unsaved edits will be lost.' }: ShowDiscardConfirmOptions,
): void {
  addToast(message, 'warning', {
    title: 'Discard changes?',
    durationMs: null,
    actions: [
      {
        label: 'Keep editing',
        tone: 'primary',
        onAction: () => onKeep?.(),
      },
      {
        label: 'Discard',
        tone: 'danger',
        onAction: onDiscard,
      },
    ],
  });
}
