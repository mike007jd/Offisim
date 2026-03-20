import { ChevronUp, MessageSquare } from 'lucide-react';
import { type ReactNode, useState } from 'react';

interface ChatDrawerProps {
  children: ReactNode;
}

export function ChatDrawer({ children }: ChatDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="bg-black/40 backdrop-blur-3xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300"
      style={{ height: open ? '32vh' : '40px' }}
    >
      {/* Toggle bar */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-10 px-4 flex items-center justify-between text-slate-400 hover:text-white transition-colors"
      >
        <div className="flex items-center space-x-2">
          <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-xs font-medium text-slate-300">Chat</span>
        </div>
        <div
          className="transition-transform duration-300"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </div>
      </button>

      {/* Content area — always rendered to preserve state */}
      <div
        className="overflow-hidden transition-opacity duration-300"
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }}
      >
        <div className="h-[calc(32vh-40px)] overflow-y-auto custom-scrollbar">{children}</div>
      </div>
    </div>
  );
}
