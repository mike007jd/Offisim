export interface MergeClipboardTextInput {
  currentText: string;
  selectionStart: number;
  selectionEnd: number;
  pastedText: string;
}

export interface MergeClipboardTextResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export function mergeClipboardTextIntoComposer(
  input: MergeClipboardTextInput,
): MergeClipboardTextResult {
  if (!input.pastedText) {
    return {
      text: input.currentText,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
    };
  }
  const start = Math.max(0, Math.min(input.selectionStart, input.currentText.length));
  const end = Math.max(start, Math.min(input.selectionEnd, input.currentText.length));
  const nextText = `${input.currentText.slice(0, start)}${input.pastedText}${input.currentText.slice(end)}`;
  const nextSelection = start + input.pastedText.length;
  return {
    text: nextText,
    selectionStart: nextSelection,
    selectionEnd: nextSelection,
  };
}
