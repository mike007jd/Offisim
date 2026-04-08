import type { ProjectRow } from '@offisim/shared-types';
import type { EmptyStateWelcome } from '@offisim/ui-office';
import { ChatDrawer, ChatPanel, RightSidebar } from '@offisim/ui-office/web';
import type { StarterPrompt } from '../../lib/onboarding-prompts';

interface CollaborationRailProps {
  activeProject: ProjectRow | null;
  chatOnboardingStarterPrompts?: readonly StarterPrompt[];
  chatOnboardingWelcome?: EmptyStateWelcome;
  chatOpenToken: number;
  focusOutputsToken: number;
  onOpenOfficeEditor: () => void;
  onOpenSettings: () => void;
  onOpenStudio: () => void;
  onSelectEmployee: (id: string | null) => void;
  onToggleDashboard: () => void;
  onToggleKanban: () => void;
  onUserMessage: (text: string) => void;
  selectedEmployeeId: string | null;
  selectedEmployeeName: string | null;
}

function renderChatPanel({
  activeProject,
  chatOnboardingStarterPrompts,
  chatOnboardingWelcome,
  onOpenOfficeEditor,
  onOpenSettings,
  onOpenStudio,
  onSelectEmployee,
  onToggleDashboard,
  onToggleKanban,
  onUserMessage,
  selectedEmployeeId,
  selectedEmployeeName,
  compact,
  showMeetingPanel,
  showPipelineProgress,
}: CollaborationRailProps & {
  compact?: boolean;
  showMeetingPanel?: boolean;
  showPipelineProgress?: boolean;
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
      onUserMessage={onUserMessage}
      onboardingWelcome={chatOnboardingWelcome}
      onboardingStarterPrompts={chatOnboardingStarterPrompts}
      showPipelineProgress={showPipelineProgress}
      showMeetingPanel={showMeetingPanel}
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
      })}
      focusTasksToken={props.focusOutputsToken}
      requestChatToken={props.chatOpenToken}
      activeThreadId={props.activeProject?.thread_id ?? null}
    />
  );
}
