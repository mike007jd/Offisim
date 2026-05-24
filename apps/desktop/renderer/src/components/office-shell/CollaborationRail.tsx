import type { ProjectRow } from '@offisim/shared-types';
import { ChatDrawer, ChatPanel } from '@offisim/ui-office/web';
import type { StarterPrompt } from '../../lib/onboarding-prompts';

interface CollaborationRailProps {
  activeProject: ProjectRow | null;
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  chatOnboardingStarterPrompts?: readonly StarterPrompt[];
  chatOpenToken: number;
  focusOutputsToken: number;
  onOpenOfficeEditor: () => void;
  onOpenSettings: () => void;
  onOpenStudio: () => void;
  onSelectEmployee: (id: string | null) => void;
  onUserMessage: (text: string) => void;
  /** Open ProjectCreateDialog in edit mode for the active project. */
  onRequestEditProject?: (project: ProjectRow) => void;
  /** Toast surface for Workspace Project open-folder feedback. */
  onProjectError?: (message: string) => void;
  selectedEmployeeId: string | null;
  selectedEmployeeName: string | null;
}

function renderChatPanel({
  activeProject,
  activeThreadId,
  chatOnboardingStarterPrompts,
  onOpenOfficeEditor,
  onOpenSettings,
  onOpenStudio,
  onSelectEmployee,
  onSelectThread,
  onUserMessage,
  selectedEmployeeId,
  selectedEmployeeName,
  compact,
  showMeetingPanel,
  showActivityRail,
}: CollaborationRailProps & {
  compact?: boolean;
  showMeetingPanel?: boolean;
  showActivityRail?: boolean;
}) {
  return (
    <ChatPanel
      compact={compact}
      onOpenSettings={onOpenSettings}
      selectedEmployeeId={selectedEmployeeId}
      selectedEmployeeName={selectedEmployeeName}
      onClearSelection={() => onSelectEmployee(null)}
      onOpenEditor={onOpenOfficeEditor}
      onOpenStudio={onOpenStudio}
      activeProject={activeProject}
      activeThreadId={activeThreadId}
      onSelectThread={onSelectThread}
      onUserMessage={onUserMessage}
      onboardingStarterPrompts={chatOnboardingStarterPrompts}
      showMeetingPanel={showMeetingPanel}
      showActivityRail={showActivityRail}
    />
  );
}

export function ChatDock(props: CollaborationRailProps) {
  return (
    <ChatDrawer requestOpen={props.chatOpenToken}>
      {({ compact }) =>
        renderChatPanel({
          ...props,
          compact,
          showMeetingPanel: !compact,
          showActivityRail: compact,
        })
      }
    </ChatDrawer>
  );
}

export function CollaborationSidebar(props: CollaborationRailProps) {
  return (
    <div className="collaboration-sidebar">
      <div className="collaboration-sidebar-body">
        {renderChatPanel({
          ...props,
          showMeetingPanel: false,
          showActivityRail: true,
        })}
      </div>
    </div>
  );
}
