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
  kanbanOpen?: boolean;
  gitSlot?: ReactNode;
  onSearchSelectEmployee?: (employeeId: string) => void;
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
      onToggleKanban={onToggleKanban}
      onOpenEditor={onOpenOfficeEditor}
      onOpenStudio={onOpenStudio}
      activeProject={activeProject}
      activeThreadId={activeThreadId}
      onSelectThread={onSelectThread}
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
        showActivityRail: true,
      })}
      activeThreadId={props.activeThreadId}
      activeProjectId={projectId}
      onSelectThread={props.onSelectThread}
      onSelectEmployee={props.onSearchSelectEmployee}
    />
  );
}
