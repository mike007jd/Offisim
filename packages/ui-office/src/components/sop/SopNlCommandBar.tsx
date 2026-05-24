import { Button, Input } from '@offisim/ui-core';
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
    <div className="flex h-16 shrink-0 items-center gap-2 border-t border-line bg-surface-2 px-sp-5">
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className="h-10 flex-1 rounded-r-md border-line bg-surface-1 text-fs-sm text-ink-1 placeholder:text-ink-4 focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
      />
      <Button
        type="button"
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        size="icon"
        className="size-10 rounded-r-md text-accent-fg disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-4"
      >
        <Send className="size-4" />
      </Button>
    </div>
  );
}
