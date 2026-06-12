import { useUiState } from '@/app/ui-state.js';
import { cn } from '@/lib/utils.js';
import { ChatRail } from './ChatRail.js';
import { OfficeStage } from './OfficeStage.js';
import { TeamDock } from './TeamDock.js';
import { WorkspacePanel } from './WorkspacePanel.js';

export function OfficeSurface() {
  // Narrow-tier only (≤1200px): CSS turns the workspace panel into an overlay
  // drawer when this class is present; wide tiers keep the grid column.
  const wsPanelOverlayOpen = useUiState((s) => s.wsPanelOverlayOpen);
  const toggleWsPanelOverlay = useUiState((s) => s.toggleWsPanelOverlay);
  return (
    <div className={cn('off-office', wsPanelOverlayOpen && 'is-ws-overlay')}>
      <WorkspacePanel />
      <OfficeStage />
      <TeamDock />
      <ChatRail />
      {/* Drawer scrim (CSS-gated to the narrow tier): the drawer covers the
          stage float that opened it, so dismissal lives on the scrim. */}
      {wsPanelOverlayOpen ? (
        <button
          type="button"
          className="off-ws-scrim"
          aria-label="Close workspace panel"
          onClick={toggleWsPanelOverlay}
        />
      ) : null}
    </div>
  );
}
