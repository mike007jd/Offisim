import { Button, cn } from '@offisim/ui-core';
import { SHELL_LAYOUT } from '@offisim/ui-core/tokens';
import { ChevronLeft, ChevronRight, type LucideIcon, MessageSquare, Users } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLayoutTier } from '../../hooks/use-layout-tier.js';
import { useSidebarCollapse } from '../../lib/sidebar-collapse-store.js';

const SHELL_RAIL_WIDTHS = {
  collapsed: SHELL_LAYOUT.officeRailCollapsed,
  left: SHELL_LAYOUT.officeLeftRail,
  right: SHELL_LAYOUT.officeRightRail,
} as const;

interface AppLayoutProps {
  header: ReactNode;
  agentPanel: ReactNode;
  sceneCanvas: ReactNode;
  runRailStart?: ReactNode;
  runRailCenter?: ReactNode;
  runRailEnd?: ReactNode;
  teamDock?: ReactNode;
  chatDrawer: ReactNode;
  eventLog: ReactNode;
  /**
   * When provided, replaces the scene canvas in the center surface.
   * Used by WorkspaceRouter to render non-office workspace pages.
   * When `null` / `undefined`, the scene canvas is shown (Office mode).
   */
  centerContent?: ReactNode;
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
      className="app-collapsed-bar"
    >
      <Chevron data-icon="inline-start" aria-hidden="true" />
      <Icon data-icon="inline-start" aria-hidden="true" />
      <span data-side={side}>{label}</span>
    </Button>
  );
}

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
  runRailStart,
  runRailCenter,
  runRailEnd,
  teamDock,
  chatDrawer,
  eventLog,
  centerContent,
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

  const leftWidth = leftOpen ? SHELL_RAIL_WIDTHS.left : SHELL_RAIL_WIDTHS.collapsed;
  const rightWidth = rightOpen ? SHELL_RAIL_WIDTHS.right : SHELL_RAIL_WIDTHS.collapsed;

  const layoutMetrics = useMemo(
    () => ({
      isNarrow,
      leftOpen,
      rightOpen,
      leftPanelWidth: leftWidth,
      rightPanelWidth: rightWidth,
    }),
    [isNarrow, leftOpen, rightOpen, leftWidth, rightWidth],
  );

  useEffect(() => {
    onLayoutMetricsChange?.(layoutMetrics);
  }, [layoutMetrics, onLayoutMetricsChange]);

  const showLeft = !isNarrow && agentPanel != null;
  const showRight = !isNarrow && eventLog != null;
  const showRunRail = !centerContent && (runRailStart || runRailCenter || runRailEnd);
  return (
    <div className="app-layout-shell">
      <div className="app-layout-header">{header}</div>
      <div
        className={cn(
          'app-layout-grid',
          !showLeft
            ? 'app-layout-grid-left-hidden'
            : leftOpen
              ? 'app-layout-grid-left-expanded'
              : 'app-layout-grid-left-collapsed',
          !showRight
            ? 'app-layout-grid-right-hidden'
            : rightOpen
              ? 'app-layout-grid-right-expanded'
              : 'app-layout-grid-right-collapsed',
        )}
      >
        {showLeft && (
          <aside className="app-layout-left-rail">
            {leftOpen ? (
              <div className="app-layout-rail-content">{agentPanel}</div>
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

        <main className="app-layout-center">
          {centerContent ?? sceneCanvas}
          {showRunRail ? (
            <div className="app-layout-run-rail">
              <div data-slot="start">{runRailStart}</div>
              <div data-slot="center">{runRailCenter}</div>
              <div data-slot="end">{runRailEnd}</div>
            </div>
          ) : null}
        </main>

        {teamDock && !centerContent ? <div className="app-layout-team-dock">{teamDock}</div> : null}

        {showRight && (
          <aside className="app-layout-right-rail">
            {rightOpen ? (
              <div className="app-layout-rail-content">{eventLog}</div>
            ) : (
              <CollapsedBar
                side="right"
                icon={MessageSquare}
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
        <div className="app-layout-mobile-chat">{chatDrawer}</div>
      ) : null}
    </div>
  );
}
