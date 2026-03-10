import { ChevronDown, ChevronUp } from 'lucide-react';
import { type ReactNode, useState } from 'react';

interface ChatDrawerProps {
  children: ReactNode;
}

export function ChatDrawer({ children }: ChatDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t-2 border-ocean-light bg-ocean-deep">
      {/* Toggle bar — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-1 py-1.5 font-pixel-mono text-[10px] text-shell hover:bg-ocean-mid hover:text-sand transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        <span>{open ? 'HIDE CHAT' : 'SHOW CHAT'}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </button>

      {/* Collapsible content area */}
      <div
        className="transition-[max-height] duration-300 ease-in-out overflow-hidden"
        style={{ maxHeight: open ? '50vh' : '0px' }}
      >
        {open && <div className="h-[50vh] overflow-hidden">{children}</div>}
      </div>
    </div>
  );
}
