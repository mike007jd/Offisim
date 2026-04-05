import { ChevronLeft, ChevronRight, LayoutDashboard, type LucideIcon, Users } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

interface AppLayoutProps {
  header: ReactNode;
  agentPanel: ReactNode;
  sceneCanvas: ReactNode;
  chatDrawer: ReactNode;
  eventLog: ReactNode;
  statusBar: ReactNode;
  onLayoutMetricsChange?: (metrics: {
    isNarrow: boolean;
    leftOpen: boolean;
    rightOpen: boolean;
    leftPanelWidth: number;
    rightPanelWidth: number;
  }) => void;
}

/* ── Shared collapse handle ── */

function PanelCollapseHandle({
  side,
  onClick,
  label,
}: { side: 'left' | 'right'; onClick: () => void; label: string }) {
  const Chevron = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 z-30 w-6 h-14 flex items-center justify-center bg-black/80 border border-white/15 hover:bg-blue-500/25 hover:border-blue-500/40 transition-all shadow-lg backdrop-blur-sm group ${
        side === 'left' ? '-right-3 rounded-r-lg border-l-0' : '-left-3 rounded-l-lg border-r-0'
      }`}
    >
      <Chevron className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-400 transition-colors" />
    </button>
  );
}

/* ── Shared collapsed bar ── */

function CollapsedBar({
  side,
  icon: Icon,
  label,
  onClick,
  ariaLabel,
}: {
  side: 'left' | 'right';
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  ariaLabel: string;
}) {
  const Chevron = side === 'left' ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="flex-1 flex flex-col items-center justify-center gap-3 relative z-10 hover:bg-white/5 transition-colors border-t-2 border-blue-500/20"
    >
      <Icon className="w-4 h-4 text-blue-400" />
      <span
        className="text-[11px] font-semibold uppercase tracking-wide text-slate-500"
        style={{
          writingMode: 'vertical-rl',
          ...(side === 'right' ? { transform: 'rotate(180deg)' } : {}),
        }}
      >
        {label}
      </span>
      <Chevron className="w-3.5 h-3.5 text-slate-500" />
    </button>
  );
}

const PANEL_SHADOW = 'shadow-[0_0_40px_rgba(0,0,0,0.8)]';
const PANEL_SHADOW_GLOW = 'shadow-[0_0_40px_rgba(0,0,0,0.8),0_0_15px_rgba(59,130,246,0.06)]';

/* ── Main layout ── */

export function AppLayout({
  header,
  agentPanel,
  sceneCanvas,
  chatDrawer,
  eventLog,
  statusBar,
  onLayoutMetricsChange,
}: AppLayoutProps) {
  const initNarrow =
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false;

  const readPanel = (key: string): boolean => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  };

  const [isNarrow, setIsNarrow] = useState(initNarrow);
  const [leftOpen, setLeftOpen] = useState(() =>
    initNarrow ? false : readPanel('offisim.panel.left'),
  );
  const [rightOpen, setRightOpen] = useState(() =>
    initNarrow ? false : readPanel('offisim.panel.right'),
  );

  // Persist only on explicit user toggle — not on auto-collapse
  const persistLeft = (open: boolean) => {
    setLeftOpen(open);
    try {
      localStorage.setItem('offisim.panel.left', String(open));
    } catch {}
  };
  const persistRight = (open: boolean) => {
    setRightOpen(open);
    try {
      localStorage.setItem('offisim.panel.right', String(open));
    } catch {}
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const sync = (matches: boolean) => setIsNarrow(matches);
    sync(mediaQuery.matches);
    const handleChange = (event: MediaQueryListEvent) => sync(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Auto-collapse on narrow transition; restore preference on wide transition
  const prevNarrowRef = useRef(initNarrow);
  useEffect(() => {
    if (isNarrow && !prevNarrowRef.current) {
      setLeftOpen(false);
      setRightOpen(false);
    } else if (!isNarrow && prevNarrowRef.current) {
      setLeftOpen(readPanel('offisim.panel.left'));
      setRightOpen(readPanel('offisim.panel.right'));
    }
    prevNarrowRef.current = isNarrow;
  }, [isNarrow]);

  const layoutMetrics = useMemo(
    () => ({
      isNarrow,
      leftOpen,
      rightOpen,
      leftPanelWidth: leftOpen ? 280 : 44,
      rightPanelWidth: rightOpen ? 280 : 44,
    }),
    [isNarrow, leftOpen, rightOpen],
  );

  useEffect(() => {
    onLayoutMetricsChange?.(layoutMetrics);
  }, [layoutMetrics, onLayoutMetricsChange]);

  return (
    <div className="h-screen bg-surface text-slate-300 flex flex-col overflow-hidden relative">
      <div className="noise" />
      <div className="scanline" />

      <div className="absolute inset-0 z-0">{sceneCanvas}</div>

      <div
        className="relative z-50"
        style={{ marginInline: 'var(--sp-lg)', marginTop: 'var(--sp-lg)' }}
      >
        {header}
      </div>

      <div
        className="flex flex-1 overflow-hidden relative z-10 pointer-events-none"
        style={{ paddingInline: 'var(--sp-lg)' }}
      >
        {/* ══════ LEFT PANEL ══════ */}
        <div
          className="relative shrink-0 pointer-events-auto transition-all duration-300 ease-out"
          style={{ width: leftOpen ? '280px' : '44px', marginBlock: 'var(--sp-lg)' }}
        >
          <div
            className={`h-full border border-white/10 bg-black/50 backdrop-blur-xl rounded-2xl overflow-hidden flex flex-col relative ${leftOpen ? PANEL_SHADOW_GLOW : PANEL_SHADOW}`}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />
            {leftOpen ? (
              <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10">
                {agentPanel}
              </div>
            ) : (
              <CollapsedBar
                side="left"
                icon={Users}
                label="Personnel"
                ariaLabel="Expand personnel panel"
                onClick={() => persistLeft(true)}
              />
            )}
          </div>
          {leftOpen && (
            <PanelCollapseHandle
              side="left"
              label="Collapse personnel panel"
              onClick={() => persistLeft(false)}
            />
          )}
        </div>

        <main className="flex-1 min-w-0 pointer-events-none" />

        {/* ══════ RIGHT PANEL ══════ */}
        <div
          className="relative shrink-0 pointer-events-auto transition-all duration-300 ease-out"
          style={{ width: rightOpen ? '280px' : '44px', marginBlock: 'var(--sp-lg)' }}
        >
          <div
            className={`h-full border border-white/10 bg-black/50 backdrop-blur-xl rounded-2xl overflow-hidden flex flex-col relative ${rightOpen ? PANEL_SHADOW_GLOW : PANEL_SHADOW}`}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />
            <div
              aria-hidden={!rightOpen}
              className={`custom-scrollbar relative z-10 transition-opacity duration-200 ${
                rightOpen
                  ? 'flex-1 overflow-y-auto opacity-100 pointer-events-auto'
                  : 'h-0 overflow-hidden opacity-0 pointer-events-none'
              }`}
            >
              {eventLog}
            </div>
            {!rightOpen && (
              <CollapsedBar
                side="right"
                icon={LayoutDashboard}
                label="Operations"
                ariaLabel="Expand operations panel"
                onClick={() => persistRight(true)}
              />
            )}
          </div>
          {rightOpen && (
            <PanelCollapseHandle
              side="right"
              label="Collapse operations panel"
              onClick={() => persistRight(false)}
            />
          )}
        </div>
      </div>

      {/* Chat drawer */}
      <div
        className="absolute bottom-9 z-30 pointer-events-auto transition-all duration-300 ease-out"
        style={{
          left: isNarrow ? '16px' : leftOpen ? '296px' : '60px',
          right: isNarrow ? '16px' : rightOpen ? '296px' : '60px',
        }}
      >
        {chatDrawer}
      </div>
      <div className="relative z-30 shrink-0">{statusBar}</div>
    </div>
  );
}
