import { ChevronLeft, ChevronRight, LayoutDashboard, type LucideIcon, Users } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLayoutTier } from '../../hooks/use-layout-tier.js';
import { useSidebarCollapse } from '../../lib/sidebar-collapse-store.js';

interface AppLayoutProps {
  header: ReactNode;
  agentPanel: ReactNode;
  sceneCanvas: ReactNode;
  chatDrawer: ReactNode;
  eventLog: ReactNode;
  statusBar: ReactNode;
  /**
   * When provided, replaces the scene canvas in the center surface.
   * Used by WorkspaceRouter to render non-office workspace pages.
   * When `null` / `undefined`, the scene canvas is shown (Office mode).
   */
  centerContent?: ReactNode;
  /** Office-scoped tray mounted below the shell header (for boards/status). */
  taskTray?: ReactNode;
  chatDrawerMode?: 'always' | 'mobile-only';
  /** Bump to request right rail expansion (only on desktop/tablet). */
  requestRightExpandToken?: number;
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
      className={`absolute top-1/2 -translate-y-1/2 z-30 w-6 h-14 flex items-center justify-center bg-surface-elevated/95 border border-border-default hover:bg-accent-muted hover:border-border-focus transition-all shadow-lg backdrop-blur-sm group ${
        side === 'left' ? '-right-3 rounded-r-lg border-l-0' : '-left-3 rounded-l-lg border-r-0'
      }`}
    >
      <Chevron className="w-3.5 h-3.5 text-text-secondary group-hover:text-accent transition-colors" />
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
      className="flex-1 flex flex-col items-center justify-center gap-3 relative z-10 hover:bg-surface-hover transition-colors border-t-2 border-border-focus"
    >
      <Icon className="w-4 h-4 text-accent" />
      <span
        className="text-[11px] font-semibold uppercase tracking-wide text-text-muted"
        style={{
          writingMode: 'vertical-rl',
          ...(side === 'right' ? { transform: 'rotate(180deg)' } : {}),
        }}
      >
        {label}
      </span>
      <Chevron className="w-3.5 h-3.5 text-text-muted" />
    </button>
  );
}

const PANEL_SHADOW = 'shadow-overlay';
const PANEL_SHADOW_GLOW = 'shadow-overlay';
const LEFT_PANEL_WIDTH = 280;
const RIGHT_PANEL_WIDTH = 440;
const COLLAPSED_PANEL_WIDTH = 44;
const RIGHT_RAIL_STORAGE_KEY = 'offisim-rightrail-open';

function readStoredRightOpen(): boolean | null {
  try {
    const saved = localStorage.getItem(RIGHT_RAIL_STORAGE_KEY);
    if (saved === 'true') return true;
    if (saved === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

function writeStoredRightOpen(next: boolean): void {
  try {
    localStorage.setItem(RIGHT_RAIL_STORAGE_KEY, String(next));
  } catch {
    // ignore storage errors (private mode, sandboxed webview, disabled storage)
  }
}

/* ── Main layout ── */

export function AppLayout({
  header,
  agentPanel,
  sceneCanvas,
  chatDrawer,
  eventLog,
  statusBar,
  centerContent,
  taskTray,
  chatDrawerMode = 'always',
  requestRightExpandToken,
  onLayoutMetricsChange,
}: AppLayoutProps) {
  const layoutTier = useLayoutTier();
  const isNarrow = layoutTier.tier === 'narrow';
  const [leftRailPreference, setLeftRailPreference] = useSidebarCollapse('office');
  const leftOpen = !isNarrow && leftRailPreference === 'expanded';
  const setLeftOpen = useCallback(
    (nextOpen: boolean) => setLeftRailPreference(nextOpen ? 'expanded' : 'collapsed'),
    [setLeftRailPreference],
  );
  const [rightOpen, setRightOpenInternal] = useState(() => {
    const stored = readStoredRightOpen();
    if (stored !== null) return stored;
    return layoutTier.rightRailDefault === 'visible';
  });

  const commitRightOpen = useCallback((next: boolean) => {
    setRightOpenInternal(next);
    writeStoredRightOpen(next);
  }, []);

  // Reset to the intended default layout whenever the viewport tier changes.
  const prevTierRef = useRef(layoutTier.tier);
  useEffect(() => {
    if (layoutTier.tier === prevTierRef.current) return;
    if (layoutTier.tier === 'narrow') {
      // Narrow tier collapses regardless of stored preference — no horizontal room.
      setRightOpenInternal(false);
    } else {
      setRightOpenInternal(readStoredRightOpen() ?? true);
    }
    prevTierRef.current = layoutTier.tier;
  }, [layoutTier.tier]);

  // Auto-expand right rail when a chat/collaboration action requests it,
  // but only if the responsive tier permits (not narrow/mobile).
  useEffect(() => {
    if (requestRightExpandToken && !isNarrow && !rightOpen) {
      commitRightOpen(true);
    }
  }, [requestRightExpandToken, isNarrow, rightOpen, commitRightOpen]);

  const layoutMetrics = useMemo(
    () => ({
      isNarrow,
      leftOpen,
      rightOpen,
      leftPanelWidth: leftOpen ? LEFT_PANEL_WIDTH : COLLAPSED_PANEL_WIDTH,
      rightPanelWidth: rightOpen ? RIGHT_PANEL_WIDTH : COLLAPSED_PANEL_WIDTH,
    }),
    [isNarrow, leftOpen, rightOpen],
  );

  useEffect(() => {
    onLayoutMetricsChange?.(layoutMetrics);
  }, [layoutMetrics, onLayoutMetricsChange]);

  const layoutMetricVars = {
    '--app-left-rail-width': `${layoutMetrics.leftPanelWidth}px`,
    '--app-right-rail-width': `${layoutMetrics.rightPanelWidth}px`,
  } as React.CSSProperties;

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden bg-surface text-text-primary"
      style={layoutMetricVars}
    >
      <div className="absolute inset-0 z-0">{!centerContent && sceneCanvas}</div>

      <div
        className="relative z-50"
        style={{ marginInline: 'var(--sp-lg)', marginTop: 'var(--sp-lg)' }}
      >
        {header}
        {taskTray ? (
          <div
            className="absolute left-0 right-0 top-full z-40 pointer-events-auto"
            style={{ marginTop: 'var(--sp-sm)' }}
          >
            {taskTray}
          </div>
        ) : null}
      </div>

      <div
        className="flex flex-1 overflow-hidden relative z-10 pointer-events-none"
        style={{ paddingInline: 'var(--sp-lg)' }}
      >
        {/* ══════ LEFT PANEL ══════ */}
        {agentPanel != null && (
          <div
            className="relative shrink-0 pointer-events-auto transition-all duration-300 ease-out"
            style={{
              width: leftOpen ? `${LEFT_PANEL_WIDTH}px` : `${COLLAPSED_PANEL_WIDTH}px`,
              marginBlock: 'var(--sp-lg)',
            }}
          >
            <div
              className={`h-full border border-border-default bg-surface-elevated/78 backdrop-blur-xl rounded-2xl overflow-hidden flex flex-col relative ${leftOpen ? PANEL_SHADOW_GLOW : PANEL_SHADOW}`}
            >
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
                  onClick={() => setLeftOpen(true)}
                />
              )}
            </div>
            {leftOpen && (
              <PanelCollapseHandle
                side="left"
                label="Collapse personnel panel"
                onClick={() => setLeftOpen(false)}
              />
            )}
          </div>
        )}

        <main className="flex-1 min-w-0 pointer-events-none">
          {centerContent ? <div className="pointer-events-auto h-full">{centerContent}</div> : null}
        </main>

        {/* ══════ RIGHT PANEL ══════ */}
        {eventLog != null && (
          <div
            className="relative shrink-0 pointer-events-auto transition-all duration-300 ease-out"
            style={{
              width: rightOpen ? `${RIGHT_PANEL_WIDTH}px` : `${COLLAPSED_PANEL_WIDTH}px`,
              marginBlock: 'var(--sp-lg)',
            }}
          >
            <div
              className={`h-full border border-border-default bg-surface-elevated/78 backdrop-blur-xl rounded-2xl overflow-hidden flex flex-col relative ${rightOpen ? PANEL_SHADOW_GLOW : PANEL_SHADOW}`}
            >
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
                  label="Collaboration"
                  ariaLabel="Expand collaboration panel"
                  onClick={() => commitRightOpen(true)}
                />
              )}
            </div>
            {rightOpen && (
              <PanelCollapseHandle
                side="right"
                label="Collapse collaboration panel"
                onClick={() => commitRightOpen(false)}
              />
            )}
          </div>
        )}
      </div>

      {chatDrawer && (chatDrawerMode === 'always' || isNarrow) ? (
        <div
          className="pointer-events-auto absolute bottom-9 z-30 transition-all duration-300 ease-out"
          style={{
            left: isNarrow
              ? '16px'
              : 'calc(var(--app-left-rail-width) + var(--sp-lg) + var(--sp-md))',
            right: isNarrow
              ? '16px'
              : 'calc(var(--app-right-rail-width) + var(--sp-lg) + var(--sp-md))',
          }}
        >
          {chatDrawer}
        </div>
      ) : null}
      <div className="relative z-30 shrink-0">{statusBar}</div>
    </div>
  );
}
