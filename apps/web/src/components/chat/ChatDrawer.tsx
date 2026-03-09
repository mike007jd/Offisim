import { useState, type ReactNode } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface ChatDrawerProps {
  children: ReactNode;
}

export function ChatDrawer({ children }: ChatDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="border-t border-border bg-background transition-[max-height] duration-300 ease-in-out"
      style={{ maxHeight: open ? '50vh' : '0px' }}
    >
      {/* Toggle bar — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        <span>{open ? 'Hide Chat' : 'Show Chat'}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </button>

      {/* Chat content — only rendered when open to avoid hidden scroll issues */}
      {open && (
        <div className="h-[calc(50vh-32px)] overflow-hidden">
          {children}
        </div>
      )}
    </div>
  );
}
