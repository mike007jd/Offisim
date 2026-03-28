import { ChevronUp, MessageSquare } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'offisim-chat-open';

interface ChatDrawerProps {
  children: ReactNode;
  /** Increment to auto-expand the drawer (e.g. when a direct chat is requested). */
  requestOpen?: number;
}

export function ChatDrawer({ children, requestOpen }: ChatDrawerProps) {
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved !== null ? saved === 'true' : true; // default open on first visit
    } catch {
      return true;
    }
  });

  // Auto-expand when parent signals a chat request
  useEffect(() => {
    if (requestOpen) setOpen(true);
  }, [requestOpen]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // localStorage unavailable — silently ignore
      }
      return next;
    });
  }, []);

  return (
    <div
      className="bg-black/40 backdrop-blur-3xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300"
      style={{ height: open ? '38vh' : '40px' }}
    >
      {/* Toggle bar */}
      <button
        type="button"
        onClick={toggle}
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
        <div className="h-[calc(38vh-40px)] overflow-y-auto custom-scrollbar">{children}</div>
      </div>
    </div>
  );
}
