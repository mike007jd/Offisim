import { cn } from '@/lib/utils.js';
import { forwardRef } from 'react';
import type * as React from 'react';

/**
 * The shared in-shell chat composer textarea (used by Connect and any chat
 * surface that drives its own controlled composer rather than the assistant-ui
 * `ComposerPrimitive.Input`). It is a thin, flush textarea — no border / no
 * background of its own — meant to sit inside an `.off-ws-composer-shell` that
 * owns the focus ring. The shared chrome lives in `.off-ws-composer-input`.
 *
 * Keeping the raw `<textarea>` element here (a design-system primitive) is
 * deliberate: the UI-framework-hygiene gate forbids raw chat-composer textareas
 * in surface code so every composer goes through a reviewed primitive instead of
 * re-hand-rolling input behavior.
 */
export const ChatComposerInput = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function ChatComposerInput({ className, rows = 1, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn('off-ws-composer-input', className)}
      {...props}
    />
  );
});
