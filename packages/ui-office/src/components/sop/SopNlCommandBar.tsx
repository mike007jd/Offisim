import { Send } from 'lucide-react';
import { useCallback } from 'react';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SopNlCommandBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void;
  disabled: boolean;
  placeholder?: string;
}

// ---------------------------------------------------------------------------
// SopNlCommandBar
// ---------------------------------------------------------------------------

export function SopNlCommandBar({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = 'Type a command…',
}: SopNlCommandBarProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed && !disabled) {
          onSubmit(trimmed);
        }
      }
    },
    [value, disabled, onSubmit],
  );

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed && !disabled) {
      onSubmit(trimmed);
    }
  }, [value, disabled, onSubmit]);

  return (
    <div className="flex h-16 shrink-0 items-center gap-2 border-t border-border-default bg-surface-elevated px-4">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className="h-10 flex-1 rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-disabled disabled:text-text-disabled"
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  );
}
