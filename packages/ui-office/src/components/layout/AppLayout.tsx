import { Button, cn } from '@offisim/ui-core';
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

/* ── Collapsed rail bar (solid column, not a floating card) ── */

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
    <Button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      variant="ghost"
      className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-none transition-colors hover:bg-surface-sunken"
    >
      <Chevron className="size-3.5 text-ink-3" />
      <Icon className="size-4 text-ink-3" />
      <span
        className={cn(
          'writing-vertical-rl text-fs-micro font-semibold uppercase tracking-ls-caps text-ink-3',
          side === 'right' && 'rotate-180',
        )}
      >
        {label}
      </span>
    </Button>
  );
}

const LEFT_PANEL_WIDTH = 288;
const RIGHT_PANEL_WIDTH = 448;
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

/* ── Main layout — solid 3-column grid (V3 shell, no floating panels) ── */

export function AppLayout({
  header,
  agentPanel,
  sceneCanvas,
  chatDrawer,
  eventLog,
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
      setRightOpenInternal(false);
    } else {
      setRightOpenInternal(readStoredRightOpen() ?? true);
    }
    prevTierRef.current = layoutTier.tier;
  }, [layoutTier.tier]);

  // Auto-expand right rail when a chat/collaboration action requests it.
  useEffect(() => {
    if (requestRightExpandToken && !isNarrow && !rightOpen) {
      commitRightOpen(true);
    }
  }, [requestRightExpandToken, isNarrow, rightOpen, commitRightOpen]);

  const leftWidth = leftOpen ? LEFT_PANEL_WIDTH : COLLAPSED_PANEL_WIDTH;
  const rightWidth = rightOpen ? RIGHT_PANEL_WIDTH : COLLAPSED_PANEL_WIDTH;

  const layoutMetrics = useMemo(
    () => ({ isNarrow, leftOpen, rightOpen, leftPanelWidth: leftWidth, rightPanelWidth: rightWidth }),
    [isNarrow, leftOpen, rightOpen, leftWidth, rightWidth],
  );

  useEffect(() => {
    onLayoutMetricsChange?.(layoutMetrics);
  }, [layoutMetrics, onLayoutMetricsChange]);

  const showLeft = !isNarrow && agentPanel != null;
  const showRight = !isNarrow && eventLog != null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-ink-1">
      <div className="flex h-10 shrink-0 items-center border-b border-line bg-surface-2 px-sp-5">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="size-3 rounded-full bg-danger" />
          <span aria-hidden="true" className="size-3 rounded-full bg-warn" />
          <span aria-hidden="true" className="size-3 rounded-full bg-ok" />
        </div>
        <div className="ml-4 font-mono text-fs-meta font-semibold text-ink-3">Offisim v0.8.0</div>
      </div>

      <div className="relative z-30 shrink-0 border-b border-line bg-surface-1">
        {header}
        {taskTray ? (
          <div className="pointer-events-none absolute left-0 right-0 top-full z-40 flex justify-center">
            <div className="pointer-events-auto">{taskTray}</div>
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1">
        {showLeft && (
          <aside
            className={cn(
              'flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-line bg-surface-1',
              leftOpen ? 'w-72' : 'w-11',
            )}
          >
            {leftOpen ? (
              <div className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
                {agentPanel}
              </div>
            ) : (
              <CollapsedBar
                side="left"
                icon={Users}
                label="Files"
                ariaLabel="Expand left rail"
                onClick={() => setLeftOpen(true)}
              />
            )}
          </aside>
        )}

        <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {centerContent ?? sceneCanvas}
        </main>

        {showRight && (
          <aside
            className={cn(
              'flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-line bg-surface-1',
              rightOpen ? 'w-112' : 'w-11',
            )}
          >
            {rightOpen ? (
              <div className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
                {eventLog}
              </div>
            ) : (
              <CollapsedBar
                side="right"
                icon={LayoutDashboard}
                label="Chat"
                ariaLabel="Expand right rail"
                onClick={() => commitRightOpen(true)}
              />
            )}
          </aside>
        )}
      </div>

      {/* Narrow tier: chat as a bottom drawer (no room for a solid right column) */}
      {chatDrawer && (chatDrawerMode === 'always' || isNarrow) && isNarrow ? (
        <div className="pointer-events-auto absolute bottom-4 left-4 right-4 z-30">{chatDrawer}</div>
      ) : null}
    </div>
  );
}
