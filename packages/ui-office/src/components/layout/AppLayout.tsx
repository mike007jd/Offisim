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
    <Button
      type="button"
      aria-label={label}
      onClick={onClick}
      variant="outline"
      className={`absolute top-1/2 z-30 flex h-14 w-6 -translate-y-1/2 items-center justify-center border-border-default bg-surface-elevated/95 shadow-lg backdrop-blur-sm transition-all hover:border-border-focus hover:bg-accent-muted ${
        side === 'left' ? '-right-3 rounded-r-lg border-l-0' : '-left-3 rounded-l-lg border-r-0'
      }`}
    >
      <Chevron className="size-3.5 text-text-secondary transition-colors" />
    </Button>
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
    <Button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      variant="ghost"
      className="relative z-10 flex h-auto flex-1 flex-col items-center justify-center gap-3 rounded-none border-t-2 border-border-focus transition-colors hover:bg-surface-hover"
    >
      <Icon className="size-4 text-accent" />
      <span
        className={cn(
          'writing-vertical-rl text-caption font-semibold uppercase tracking-wide text-text-muted',
          side === 'right' && 'rotate-180',
        )}
      >
        {label}
      </span>
      <Chevron className="size-3.5 text-text-muted" />
    </Button>
  );
}

const PANEL_SHADOW = 'shadow-overlay';
const PANEL_SHADOW_GLOW = 'shadow-overlay';
const LEFT_PANEL_WIDTH = 300;
const RIGHT_PANEL_WIDTH = 360;
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

      <div className="relative z-50 mx-4 mt-4">
        {header}
        {taskTray ? (
          <div className="pointer-events-auto absolute left-0 right-0 top-full z-40 mt-2">
            {taskTray}
          </div>
        ) : null}
      </div>

      <div className="pointer-events-none relative z-10 flex flex-1 overflow-hidden px-4">
        {/* ══════ LEFT PANEL ══════ */}
        {agentPanel != null && (
          <div
            className={cn(
              'pointer-events-auto relative my-4 shrink-0 transition-all duration-300 ease-out',
              leftOpen ? 'w-office-left-expanded' : 'w-office-rail-collapsed',
            )}
          >
            <div
              className={cn(
                'relative flex h-full flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-elevated/78 backdrop-blur-xl',
                leftOpen ? PANEL_SHADOW_GLOW : PANEL_SHADOW,
              )}
            >
              {leftOpen ? (
                <div className="custom-scrollbar relative z-10 flex-1 overflow-y-auto">
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

        <main className="pointer-events-none min-w-0 flex-1">
          {centerContent ? <div className="pointer-events-auto h-full">{centerContent}</div> : null}
        </main>

        {/* ══════ RIGHT PANEL ══════ */}
        {eventLog != null && (
          <div
            className={cn(
              'pointer-events-auto relative my-4 shrink-0 transition-all duration-300 ease-out',
              rightOpen ? 'w-office-right-expanded' : 'w-office-rail-collapsed',
            )}
          >
            <div
              className={cn(
                'relative flex h-full flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-elevated/78 backdrop-blur-xl',
                rightOpen ? PANEL_SHADOW_GLOW : PANEL_SHADOW,
              )}
            >
              <div
                aria-hidden={!rightOpen}
                className={cn(
                  'custom-scrollbar relative z-10 transition-opacity duration-200',
                  rightOpen
                    ? 'pointer-events-auto flex-1 overflow-y-auto opacity-100'
                    : 'pointer-events-none h-0 overflow-hidden opacity-0',
                )}
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
          className={cn(
            'pointer-events-auto absolute bottom-9 z-30 transition-all duration-300 ease-out',
            isNarrow ? 'left-4 right-4' : 'chat-drawer-wide',
          )}
        >
          {chatDrawer}
        </div>
      ) : null}
      <div className="relative z-30 shrink-0">{statusBar}</div>
    </div>
  );
}
