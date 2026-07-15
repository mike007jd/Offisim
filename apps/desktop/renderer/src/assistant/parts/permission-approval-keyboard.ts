export interface PermissionInputKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly nativeEvent: { readonly isComposing?: boolean };
  preventDefault(): void;
  stopPropagation(): void;
}

/** Submit a single-line Pi input request without stealing IME/editor Enter keys. */
export function submitPermissionInputOnEnter(
  event: PermissionInputKeyEvent,
  deciding: boolean,
  submit: () => void,
): boolean {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return false;
  event.preventDefault();
  event.stopPropagation();
  if (deciding) return false;
  submit();
  return true;
}
