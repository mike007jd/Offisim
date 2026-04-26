import type { ProjectRow } from '@offisim/shared-types';
import { ChatDrawer, ChatPanel, RightSidebar } from '@offisim/ui-office/web';
import type { StarterPrompt } from '../../lib/onboarding-prompts';

interface CollaborationRailProps {
  activeProject: ProjectRow | null;
  chatOnboardingStarterPrompts?: readonly StarterPrompt[];
  chatOpenToken: number;
  focusOutputsToken: number;
  onOpenOfficeEditor: () => void;
  onOpenSettings: () => void;
  onOpenStudio: () => void;
  onSelectEmployee: (id: string | null) => void;
  onToggleDashboard: () => void;
  onToggleKanban: () => void;
  onUserMessage: (text: string) => void;
  /** Open ProjectCreateDialog in edit mode for the active project. */
  onRequestEditProject?: (project: ProjectRow) => void;
  /** Toast surface for ProjectContextStrip "folder not found" feedback. */
  onProjectStripError?: (message: string) => void;
  selectedEmployeeId: string | null;
  selectedEmployeeName: string | null;
}

function renderChatPanel({
  activeProject,
  chatOnboardingStarterPrompts,
  onOpenOfficeEditor,
  onOpenSettings,
  onOpenStudio,
  onSelectEmployee,
  onToggleDashboard,
  onToggleKanban,
  onUserMessage,
  onRequestEditProject,
  onProjectStripError,
  selectedEmployeeId,
  selectedEmployeeName,
  compact,
  showMeetingPanel,
  showPipelineProgress,
  showActivityRail,
}: CollaborationRailProps & {
  compact?: boolean;
  showMeetingPanel?: boolean;
  showPipelineProgress?: boolean;
  showActivityRail?: boolean;
}) {
  return (
    <ChatPanel
      compact={compact}
      onOpenSettings={onOpenSettings}
      selectedEmployeeId={selectedEmployeeId}
      selectedEmployeeName={selectedEmployeeName}
      onClearSelection={() => onSelectEmployee(null)}
      onToggleDashboard={onToggleDashboard}
      onToggleKanban={onToggleKanban}
      onOpenEditor={onOpenOfficeEditor}
      onOpenStudio={onOpenStudio}
      activeProject={activeProject}
      onRequestEditProject={onRequestEditProject}
      onProjectStripError={onProjectStripError}
      onUserMessage={onUserMessage}
      onboardingStarterPrompts={chatOnboardingStarterPrompts}
      showPipelineProgress={showPipelineProgress}
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
          showPipelineProgress: true,
          showActivityRail: compact,
        })
      }
    </ChatDrawer>
  );
}

export function CollaborationSidebar(props: CollaborationRailProps) {
  return (
    <RightSidebar
      chatPanel={renderChatPanel({
        ...props,
        showPipelineProgress: false,
        showMeetingPanel: false,
        showActivityRail: false,
      })}
      focusTasksToken={props.focusOutputsToken}
      requestChatToken={props.chatOpenToken}
      activeThreadId={props.activeProject?.thread_id ?? null}
    />
  );
}
