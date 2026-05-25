import { ChatRail } from './ChatRail.js';
import { OfficeStage } from './OfficeStage.js';
import { TeamDock } from './TeamDock.js';
import { WorkspacePanel } from './WorkspacePanel.js';

export function OfficeSurface() {
  return (
    <div className="off-office">
      <WorkspacePanel />
      <OfficeStage />
      <TeamDock />
      <ChatRail />
    </div>
  );
}
