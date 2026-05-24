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
    <div className="sop-command-bar">
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className="sop-command-input"
      />
      <Button
        type="button"
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        size="icon"
        className="sop-command-send"
      >
        <Send data-icon="command-send" />
      </Button>
    </div>
  );
}
