import type { ProjectRow } from '@offisim/shared-types';
import { ChatDrawer, ChatPanel, RightSidebar } from '@offisim/ui-office/web';
import type { ReactNode } from 'react';
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
  onToggleDashboard: () => void;
  onToggleKanban: () => void;
  onUserMessage: (text: string) => void;
  /** Open ProjectCreateDialog in edit mode for the active project. */
  onRequestEditProject?: (project: ProjectRow) => void;
  /** Toast surface for Workspace Project open-folder feedback. */
  onProjectError?: (message: string) => void;
  selectedEmployeeId: string | null;
  selectedEmployeeName: string | null;
}

interface CollaborationSidebarProps extends CollaborationRailProps {
  projectSlot?: ReactNode;
  projectSummarySlot?: ReactNode;
  kanbanCardCount?: number;
  kanbanSlot?: ReactNode;
}

function renderChatPanel({
  activeProject,
  activeThreadId,
  chatOnboardingStarterPrompts,
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
      activeThreadId={activeThreadId}
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

export function CollaborationSidebar(props: CollaborationSidebarProps) {
  const projectId = props.activeProject?.project_id ?? null;
  return (
    <RightSidebar
      projectSlot={props.projectSlot}
      projectSummarySlot={props.projectSummarySlot}
      chatPanel={renderChatPanel({
        ...props,
        showPipelineProgress: false,
        showMeetingPanel: false,
        showActivityRail: false,
      })}
      focusTasksToken={props.focusOutputsToken}
      requestChatToken={props.chatOpenToken}
      activeThreadId={props.activeThreadId}
      activeProjectId={projectId}
      onSelectThread={props.onSelectThread}
      kanbanCardCount={props.kanbanCardCount}
      kanbanSlot={props.kanbanSlot}
    />
  );
}
