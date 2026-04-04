import { ChevronUp, MessageSquare, Minimize2 } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'offisim-chat-open';
const STORAGE_KEY_HEIGHT = 'offisim-chat-height';
const STORAGE_KEY_COMPACT = 'offisim-chat-compact';
const MIN_HEIGHT = 120;
const TOGGLE_BAR_HEIGHT = 40;
const COMPACT_HEIGHT = 88;
const DESKTOP_MAX_HEIGHT_RATIO = 0.6;
const MOBILE_MAX_HEIGHT_RATIO = 0.45;
const MOBILE_BREAKPOINT = '(max-width: 768px)';
const SHORT_VIEWPORT_BREAKPOINT = 700;

export interface ChatDrawerRenderState {
  compact: boolean;
}

interface ChatDrawerProps {
  children: ReactNode | ((state: ChatDrawerRenderState) => ReactNode);
  /** Increment to auto-expand the drawer (e.g. when a direct chat is requested). */
  requestOpen?: number;
}

function isNarrowScreen(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_BREAKPOINT).matches;
}

function isShortViewport(): boolean {
  return typeof window !== 'undefined' && window.innerHeight <= SHORT_VIEWPORT_BREAKPOINT;
}

function getDensity(): 'compact' | 'normal' | 'spacious' {
  if (typeof document === 'undefined') return 'normal';
  const density = document.documentElement.getAttribute('data-density');
  if (density === 'compact' || density === 'spacious') return density;
  return 'normal';
}

function getDefaultHeight(): number {
  if (typeof window === 'undefined') return 280;
  const heightByDensity = {
    compact: Math.round(window.innerHeight * 0.22),
    normal: Math.round(window.innerHeight * 0.35),
    spacious: Math.round(window.innerHeight * 0.35),
  };
  return heightByDensity[getDensity()];
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
    return Number.isFinite(saved) && saved > 0
      ? clampHeight(saved)
      : clampHeight(getDefaultHeight());
  } catch {
    return clampHeight(getDefaultHeight());
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
  const [compact, setCompact] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_COMPACT);
      if (saved !== null) return saved === 'true';
    } catch {
      // Ignore storage errors and fall back to responsive default.
    }
    return isShortViewport();
  });
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // Auto-expand when parent signals a chat request
  useEffect(() => {
    if (requestOpen) {
      setOpen(true);
      setCompact(false);
    }
  }, [requestOpen]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const toggleCompact = useCallback(() => {
    setCompact((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_COMPACT, String(next));
      } catch {
        // ignore
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
      setCompact((prev) => {
        try {
          const saved = localStorage.getItem(STORAGE_KEY_COMPACT);
          if (saved !== null) return saved === 'true';
        } catch {
          // Ignore storage errors and fall through to responsive default.
        }
        return matches || isShortViewport() ? true : prev;
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
        // ignore
      }
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [heightPx]);

  // compact 持久化已在 toggleCompact() 和 syncLayout() 中处理，不需要额外 effect

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (compact) {
        setCompact(false);
      }
      dragStateRef.current = { startY: event.clientY, startHeight: heightPx };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.userSelect = 'none';
    },
    [compact, heightPx],
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
      style={{ height: open ? `${compact ? COMPACT_HEIGHT : heightPx}px` : '40px' }}
    >
      {open && (
        <div
          data-testid="chat-resize-handle"
          className="h-1.5 cursor-ns-resize flex items-center justify-center"
          onDoubleClick={toggleCompact}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          title="Drag to resize. Double-click to toggle compact mode."
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
          {compact && <Minimize2 className="h-3 w-3 text-slate-500" />}
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
          style={{ height: Math.max((compact ? COMPACT_HEIGHT : heightPx) - TOGGLE_BAR_HEIGHT, 0) }}
        >
          {typeof children === 'function' ? children({ compact }) : children}
        </div>
      </div>
    </div>
  );
}
