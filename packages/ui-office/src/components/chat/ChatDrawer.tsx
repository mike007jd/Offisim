import { ChevronUp, MessageSquare } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'offisim-chat-open';
const STORAGE_KEY_HEIGHT = 'offisim-chat-height';
const MIN_HEIGHT = 160;
const DEFAULT_HEIGHT = 240;
const TOGGLE_BAR_HEIGHT = 40;
const DESKTOP_MAX_HEIGHT_RATIO = 0.45;
const MOBILE_MAX_HEIGHT_RATIO = 0.35;
const MOBILE_BREAKPOINT = '(max-width: 768px)';

interface ChatDrawerProps {
  children: ReactNode;
  /** Increment to auto-expand the drawer (e.g. when a direct chat is requested). */
  requestOpen?: number;
}

function isNarrowScreen(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_BREAKPOINT).matches;
}

function getMaxHeight(): number {
  const ratio = isNarrowScreen() ? MOBILE_MAX_HEIGHT_RATIO : DESKTOP_MAX_HEIGHT_RATIO;
  return Math.max(MIN_HEIGHT, Math.floor(window.innerHeight * ratio));
}

function clampHeight(height: number): number {
  if (typeof window === 'undefined') return Math.max(MIN_HEIGHT, height);
  return Math.min(Math.max(height, MIN_HEIGHT), getMaxHeight());
}

function readStoredHeight(): number {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY_HEIGHT));
    return Number.isFinite(saved) && saved > 0 ? clampHeight(saved) : clampHeight(DEFAULT_HEIGHT);
  } catch {
    return clampHeight(DEFAULT_HEIGHT);
  }
}

export function ChatDrawer({ children, requestOpen }: ChatDrawerProps) {
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved !== null ? saved === 'true' : !isNarrowScreen();
    } catch {
      return !isNarrowScreen();
    }
  });
  const [heightPx, setHeightPx] = useState(() => readStoredHeight());
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);

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

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT);
    const syncLayout = (matches: boolean) => {
      setHeightPx((prev) => clampHeight(prev));
      setOpen((prev) => {
        try {
          const saved = localStorage.getItem(STORAGE_KEY);
          if (saved !== null) return saved === 'true';
        } catch {
          // Ignore storage errors and fall through to responsive default.
        }
        return matches ? false : prev;
      });
    };

    syncLayout(mediaQuery.matches);
    const handleChange = (event: MediaQueryListEvent) => syncLayout(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY_HEIGHT, String(heightPx));
      } catch {
        // localStorage unavailable — silently ignore
      }
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [heightPx]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      dragStateRef.current = { startY: event.clientY, startHeight: heightPx };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.userSelect = 'none';
    },
    [heightPx],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    setHeightPx(clampHeight(dragState.startHeight + (dragState.startY - event.clientY)));
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.style.userSelect = '';
  }, []);

  return (
    <div
      className="bg-black/40 backdrop-blur-3xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300"
      style={{ height: open ? `${heightPx}px` : '40px' }}
    >
      {open && (
        <div
          data-testid="chat-resize-handle"
          className="h-1.5 cursor-ns-resize flex items-center justify-center"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <div className="h-1 w-8 rounded-full bg-white/20" />
        </div>
      )}

      {/* Toggle bar */}
      <button
        type="button"
        onClick={toggle}
        className="w-full h-10 flex items-center justify-between text-slate-400 hover:text-white transition-colors"
        style={{ paddingInline: 'var(--sp-lg)' }}
      >
        <div className="flex items-center" style={{ columnGap: 'var(--sp-sm)' }}>
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
        <div
          className="overflow-y-auto custom-scrollbar"
          style={{ height: Math.max(heightPx - TOGGLE_BAR_HEIGHT, 0) }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
