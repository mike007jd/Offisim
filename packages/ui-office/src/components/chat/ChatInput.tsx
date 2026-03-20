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

  return (
    <div className="flex space-x-3 p-4">
      <div className="flex-1 relative">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="ENTER COMMAND..."
          disabled={disabled}
          className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-3.5 text-sm font-mono text-white focus:outline-none focus:border-blue-500/50 transition-all placeholder:text-slate-700 uppercase tracking-widest"
        />
        {!text && (
          <div className="absolute right-5 top-1/2 -translate-y-1/2 flex items-center space-x-2 pointer-events-none">
            <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse" />
            <span className="text-[8px] font-black text-blue-500/40 uppercase tracking-widest">Awaiting Input</span>
          </div>
        )}
      </div>
      <button
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        className="bg-blue-600 text-white px-8 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] hover:bg-blue-500 transition-all shadow-[0_0_30px_rgba(37,99,235,0.4)] active:scale-95 disabled:opacity-30 disabled:shadow-none"
      >
        Execute
      </button>
    </div>
  );
}
