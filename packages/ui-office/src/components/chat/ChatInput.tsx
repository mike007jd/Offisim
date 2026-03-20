import { ArrowUp } from 'lucide-react';
import { type KeyboardEvent, useRef, useState } from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const canSend = !!text.trim() && !disabled;

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-white/8">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message your team..."
        disabled={disabled}
        className="flex-1 h-8 bg-white/5 border border-white/10 rounded-lg px-3 text-sm text-white focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-slate-600 disabled:opacity-40"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={!canSend}
        aria-label="Send message"
        className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all disabled:opacity-30 disabled:bg-slate-700"
      >
        <ArrowUp className="w-3.5 h-3.5 text-white" />
      </button>
    </div>
  );
}
