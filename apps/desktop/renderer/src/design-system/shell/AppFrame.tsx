import { useUiState } from '@/app/ui-state.js';
import { useRunCost } from '@/data/queries.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/design-system/primitives/tooltip.js';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { ScopeBar } from './ScopeBar.js';
import { WorkspaceNav } from './WorkspaceNav.js';

interface AppFrameProps {
  children: ReactNode;
  /**
   * Optional banner row rendered BETWEEN the topbar and the surface host. The
   * surface host fills the rest with `position: absolute` surfaces, so a banner
   * placed inside it would be covered — it needs its own grid row. The slot
   * collapses to zero height when the banner renders nothing.
   */
  banner?: ReactNode;
}

export function AppFrame({ children, banner }: AppFrameProps) {
  const openLifecycle = useUiState((s) => s.openLifecycle);
  const openSettings = useUiState((s) => s.openSettings);
  const surface = useUiState((s) => s.surface);
  const leftRailCollapsed = useUiState((s) => s.officeLeftRailCollapsed);
  const rightRailCollapsed = useUiState((s) => s.officeRightRailCollapsed);
  const stageMaximized = useUiState((s) => s.officeStageMaximized);
  const setLeftRailCollapsed = useUiState((s) => s.setOfficeLeftRailCollapsed);
  const setRightRailCollapsed = useUiState((s) => s.setOfficeRightRailCollapsed);
  const setStageMaximized = useUiState((s) => s.setOfficeStageMaximized);
  const runCost = useRunCost();
  const lastToastRef = useRef('');
  const isOffice = surface === 'office';
  const leftRailVisible = isOffice && !stageMaximized && !leftRailCollapsed;
  const rightRailVisible = isOffice && !stageMaximized && !rightRailCollapsed;
  const leftRailAction = leftRailVisible ? 'Collapse workspace rail' : 'Expand workspace rail';
  const rightRailAction = rightRailVisible
    ? 'Collapse conversation rail'
    : 'Expand conversation rail';
  useEffect(() => {
    const signature = (runCost.data?.alerts ?? [])
      .map((item) => `${item.scope}:${item.level}`)
      .join('|');
    if (!signature) {
      lastToastRef.current = '';
      return;
    }
    if (signature === lastToastRef.current) return;
    lastToastRef.current = signature;
    for (const item of runCost.data?.alerts ?? []) {
      const scope = item.scope === 'monthly' ? 'Monthly company' : 'Current session';
      const message = `${scope} token alert ${item.level === 'critical' ? 'threshold reached' : 'at 80%'}`;
      const detail = `${item.used.toLocaleString()} / ${item.budget.toLocaleString()} tokens. Advisory only — this run continues.`;
      toast.warning(message, {
        description: detail,
        action: { label: 'Budget settings', onClick: () => openSettings('runtime') },
      });
    }
  }, [openSettings, runCost.data?.alerts]);
  return (
    <main className="off-app">
      <header className="off-topbar">
        <div className="off-topbar-start">
          {isOffice ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="off-topbar-rail-toggle off-focusable"
                  aria-label={leftRailAction}
                  aria-expanded={leftRailVisible}
                  onClick={() => {
                    if (stageMaximized) setStageMaximized(false);
                    setLeftRailCollapsed(leftRailVisible);
                  }}
                >
                  {leftRailVisible ? (
                    <ChevronsLeft aria-hidden="true" />
                  ) : (
                    <ChevronsRight aria-hidden="true" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{leftRailAction}</TooltipContent>
            </Tooltip>
          ) : null}
          <button
            type="button"
            className="off-wordmark off-focusable"
            aria-label="Offisim — back to companies"
            onClick={() => openLifecycle('select')}
          >
            Offisim
          </button>
          <ScopeBar />
        </div>
        <WorkspaceNav />
        <div className="off-topbar-end">
          {isOffice ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="off-topbar-rail-toggle off-focusable"
                  aria-label={rightRailAction}
                  aria-expanded={rightRailVisible}
                  onClick={() => {
                    if (stageMaximized) setStageMaximized(false);
                    setRightRailCollapsed(rightRailVisible);
                  }}
                >
                  {rightRailVisible ? (
                    <ChevronsRight aria-hidden="true" />
                  ) : (
                    <ChevronsLeft aria-hidden="true" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{rightRailAction}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </header>
      <div className="off-main-stack">
        <div className="off-banner-slot">{banner}</div>
        <div className="off-surface-host">{children}</div>
      </div>
    </main>
  );
}
