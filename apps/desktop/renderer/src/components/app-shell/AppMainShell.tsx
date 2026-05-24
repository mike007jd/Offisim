import type { ToastVariant } from '@offisim/ui-core';
import {
  type AgentState,
  AppLayout,
  Header,
  KanbanTray,
  NotificationCenter,
  ProjectSelector,
  type ProviderConfig,
} from '@offisim/ui-office/web';
import React, { Suspense, useCallback, useMemo } from 'react';
import {
  PEER_WORKSPACE_ITEMS,
  buildOfficeToolItems,
  visibleOfficeToolsFor,
} from '../../lib/workspace-navigation';
import { useKanbanStream } from '../../runtime/useKanbanStream';
import { OfficeLeftRail } from '../office-shell/OfficeLeftRail';
import { OfficeSceneCanvasFallback } from '../office-shell/OfficeShellSurfaces';
import { StageTeamDock } from '../office-shell/StageTeamDock';
import { WorkspaceRouter } from '../workspaces/WorkspaceRouter';
import type {
  CreateKanbanCardInput,
  KanbanState,
  UpdateKanbanCardInput,
} from '../workspaces/kanban/types';
import type {
  OfficeSessionState,
  UpdateWorkspaceStateFn,
  WorkspaceKey,
  WorkspaceSessionState,
} from '../workspaces/types';

const ChatDock = React.lazy(() =>
  import('../office-shell/CollaborationRail').then((m) => ({ default: m.ChatDock })),
);
const CollaborationSidebar = React.lazy(() =>
  import('../office-shell/CollaborationRail').then((m) => ({ default: m.CollaborationSidebar })),
);
const OfficeSceneSurface = React.lazy(() =>
  import('../office-shell/OfficeSceneSurface').then((m) => ({ default: m.OfficeSceneSurface })),
);

const WORKSPACE_TITLES: Partial<Record<WorkspaceKey, string>> = {
  sops: 'SOPs',
  market: 'Market',
  personnel: 'Personnel',
  workspace: 'Workspace',
  'activity-log': 'Activity Log',
  settings: 'Settings',
};

type CollaborationRailProps = React.ComponentProps<typeof ChatDock>;

export interface AppMainShellProps {
  activeWorkspace: WorkspaceKey;
  isOffice: boolean;
  workspaceSessionState: WorkspaceSessionState;
  updateWorkspaceState: UpdateWorkspaceStateFn;
  officeState: OfficeSessionState;
  providerConfig: ProviderConfig | null;
  activeCompanyName: string | undefined;
  sceneInteractive: boolean;
  agents: Map<string, AgentState>;
  onFileImport: (file: File) => void;
  projects: React.ComponentProps<typeof ProjectSelector>['projects'];
  activeProjectId: React.ComponentProps<typeof ProjectSelector>['activeProjectId'];
  setActiveProjectId: React.ComponentProps<typeof ProjectSelector>['onSelect'];
  onRequestCreateProject: () => void;
  onRequestEditProject: React.ComponentProps<typeof ProjectSelector>['onRequestEditProject'];
  chatOpenToken: number;
  collaborationRailProps: CollaborationRailProps;
  handleOpenSettings: () => void;
  handleBackToOffice: () => void;
  onSelectWorkspace: (key: WorkspaceKey) => void;
  onOpenCompanySelect: () => void;
  onOpenEmployeeCreator: () => void;
  onToggleKanban: () => void;
  onSelectEmployee: (id: string | null) => void;
  onViewModeChange: (mode: '2D' | '3D') => void;
  onViewModeClick: (mode: '2D' | '3D') => void;
  viewModeNonce: number;
  onSceneFallbackTo2D: () => void;
  onLayoutMetricsChange: (metrics: { leftPanelWidth: number; rightPanelWidth: number }) => void;
  onSaveConfig: (config: ProviderConfig) => void;
  onOpenActivityLog: () => void;
  onFocusEmployee: (id: string) => void;
  onStartMarketInstall: (listingId: string, version: string) => void;
  addToast: (message: string, variant?: ToastVariant) => void;
  onEditExternalEmployee: (employeeId: string) => void;
  lastUserRequest?: string | null;
  /** Workspace collaboration suite wiring (deep half). */
  activeCompanyId: string | null;
  onSelectThread: (threadId: string) => void;
  selectedEmployeeId: string | null;
}

export function AppMainShell(props: AppMainShellProps) {
  const {
    activeWorkspace,
    isOffice,
    workspaceSessionState,
    updateWorkspaceState,
    officeState,
    providerConfig,
    activeCompanyName,
    sceneInteractive,
    agents,
    onFileImport,
    projects,
    activeProjectId,
    setActiveProjectId,
    onRequestCreateProject,
    onRequestEditProject,
    chatOpenToken,
    collaborationRailProps,
    handleOpenSettings,
    handleBackToOffice,
    onSelectWorkspace,
    onOpenCompanySelect,
    onOpenEmployeeCreator,
    onToggleKanban,
    onSelectEmployee,
    onViewModeChange,
    onViewModeClick,
    viewModeNonce,
    onSceneFallbackTo2D,
    onLayoutMetricsChange,
    onSaveConfig,
    onOpenActivityLog,
    onFocusEmployee,
    onStartMarketInstall,
    addToast,
    onEditExternalEmployee,
    lastUserRequest,
    activeCompanyId,
    onSelectThread,
    selectedEmployeeId,
  } = props;
  const kanban = useKanbanStream(activeProjectId);
  const activeProject = useMemo(
    () => projects.find((project) => project.project_id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );
  const officeTools = useMemo(
    () =>
      visibleOfficeToolsFor(
        activeWorkspace,
        buildOfficeToolItems({
          hasActiveCompany: Boolean(activeCompanyName),
          onOpenStudio: collaborationRailProps.onOpenStudio,
        }),
      ),
    [activeCompanyName, activeWorkspace, collaborationRailProps.onOpenStudio],
  );
  const handleOpenSops = useCallback(
    (sopTemplateId?: string) => {
      if (sopTemplateId) {
        updateWorkspaceState('sops', (prev) => ({ ...prev, selectedSopId: sopTemplateId }));
      }
      onSelectWorkspace('sops');
    },
    [onSelectWorkspace, updateWorkspaceState],
  );
  const handleOpenSopTemplates = useCallback(() => {
    updateWorkspaceState('market', (prev) => ({
      ...prev,
      mode: 'explore',
      selectedListingId: null,
      search: '',
      kind: 'sop',
    }));
    onSelectWorkspace('market');
  }, [onSelectWorkspace, updateWorkspaceState]);
  const projectSelectorProps = useMemo(
    () => ({
      projects,
      activeProjectId,
      onSelect: setActiveProjectId,
      onRequestCreate: onRequestCreateProject,
      onRequestEditProject,
      onProjectError: collaborationRailProps.onProjectError,
    }),
    [
      activeProjectId,
      collaborationRailProps.onProjectError,
      onRequestCreateProject,
      onRequestEditProject,
      projects,
      setActiveProjectId,
    ],
  );

  return (
    <AppLayout
      header={
        <Header
          companyName={activeCompanyName}
          onOpenSettings={handleOpenSettings}
          onOpenCompanySelect={onOpenCompanySelect}
          onFileImport={onFileImport}
          projectSlot={<ProjectSelector {...projectSelectorProps} summaryMode="compact" />}
          viewMode={officeState.viewMode}
          onViewModeChange={onViewModeChange}
          onViewModeClick={onViewModeClick}
          needsConfig={!providerConfig}
          activeWorkspace={activeWorkspace}
          workspaceTitle={WORKSPACE_TITLES[activeWorkspace]}
          peerWorkspaces={PEER_WORKSPACE_ITEMS}
          onSelectWorkspace={onSelectWorkspace}
          officeTools={officeTools}
        />
      }
      taskTray={
        isOffice && officeState.kanbanOpen ? (
          <KanbanTray
            expanded={officeState.kanbanOpen}
            requestText={lastUserRequest ?? undefined}
            cards={kanban.cards}
            onMove={kanban.move as (id: string, next: KanbanState) => Promise<void>}
            onCreate={kanban.create as (input: CreateKanbanCardInput) => Promise<void>}
            onUpdate={kanban.update as (id: string, input: UpdateKanbanCardInput) => Promise<void>}
            onToggle={onToggleKanban}
          />
        ) : null
      }
      agentPanel={
        isOffice ? (
          <OfficeLeftRail activeProject={activeProject} onOpenSops={handleOpenSops} />
        ) : null
      }
      sceneCanvas={
        isOffice ? (
          <Suspense fallback={<OfficeSceneCanvasFallback />}>
            <OfficeSceneSurface
              leftPanelWidth={officeState.leftPanelWidth}
              onSceneFallbackTo2D={onSceneFallbackTo2D}
              onSelectEmployee={onSelectEmployee}
              rightPanelWidth={officeState.rightPanelWidth}
              selectedEmployeeId={officeState.selectedEmployeeId}
              sceneInteractive={sceneInteractive}
              viewMode={officeState.viewMode}
              viewModeNonce={viewModeNonce}
              activeThreadId={officeState.selectedThreadId}
              notificationSlot={
                <NotificationCenter
                  onFocusEmployee={onFocusEmployee}
                  onOpenActivityLog={onOpenActivityLog}
                />
              }
              teamDockSlot={
                <StageTeamDock
                  agents={agents}
                  selectedEmployeeId={officeState.selectedEmployeeId}
                  onSelectEmployee={(id) => onSelectEmployee(id)}
                  onOpenCreator={onOpenEmployeeCreator}
                />
              }
            />
          </Suspense>
        ) : null
      }
      chatDrawer={
        isOffice ? (
          <Suspense fallback={null}>
            <ChatDock {...collaborationRailProps} />
          </Suspense>
        ) : null
      }
      eventLog={
        isOffice ? (
          <Suspense fallback={null}>
            <CollaborationSidebar {...collaborationRailProps} />
          </Suspense>
        ) : null
      }
      centerContent={
        !isOffice ? (
          <WorkspaceRouter
            activeWorkspace={activeWorkspace}
            sessionState={workspaceSessionState}
            updateWorkspaceState={updateWorkspaceState}
            marketPageProps={{ onStartInstall: onStartMarketInstall, onFileImport }}
            sopsPageProps={{ onOpenTemplates: handleOpenSopTemplates }}
            activityLogPageProps={{ onBackToOffice: handleBackToOffice }}
            personnelPageProps={{
              onOpenCreator: onOpenEmployeeCreator,
              onOpenMarket: () => onSelectWorkspace('market'),
            }}
            workspaceSuiteProps={{
              activeCompanyId,
              activeProject,
              activeThreadId: officeState.selectedThreadId,
              selectedEmployeeId,
              onSelectThread,
              onSelectDirectEmployee: onSelectEmployee,
              onOpenSettings: handleOpenSettings,
              onFocusEmployee,
              onOpenActivityLog,
            }}
            settingsPageProps={{
              onBack: handleBackToOffice,
              onSave: onSaveConfig,
              onSaveSuccess: () => addToast('Provider configuration saved', 'success'),
              onToast: (message, variant = 'info') => addToast(message, variant),
              onEditExternalEmployee,
            }}
          />
        ) : undefined
      }
      chatDrawerMode="mobile-only"
      requestRightExpandToken={chatOpenToken}
      onLayoutMetricsChange={onLayoutMetricsChange}
    />
  );
}
