import { useUiState } from '@/app/ui-state.js';
import { cn } from '@/lib/utils.js';
import { ChatRail } from './ChatRail.js';
import { OfficeStage } from './OfficeStage.js';
import { TeamDock } from './TeamDock.js';
import { WorkspacePanel } from './WorkspacePanel.js';

export function OfficeSurface() {
  const leftCollapsed = useUiState((s) => s.officeLeftRailCollapsed);
  const rightCollapsed = useUiState((s) => s.officeRightRailCollapsed);
  const stageMaximized = useUiState((s) => s.officeStageMaximized);

  return (
    <div
      className={cn(
        'off-office',
        leftCollapsed && 'is-left-collapsed',
        rightCollapsed && 'is-right-collapsed',
        stageMaximized && 'is-stage-maximized',
      )}
    >
      <WorkspacePanel />
      <OfficeStage />
      <TeamDock />
      <ChatRail />
    </div>
  );
}
