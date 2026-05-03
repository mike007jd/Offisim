import type { ToastVariant } from '@offisim/ui-core';
import {
  AgentPanel,
  AppLayout,
  Header,
  KanbanTray,
  NotificationCenter,
  ProjectSelectedSummary,
  ProjectSelector,
  type ProviderConfig,
  StatusBar,
} from '@offisim/ui-office/web';
import type { CreateKanbanCardInput, KanbanState } from '../workspaces/kanban/types';
import React, { Suspense, useMemo } from 'react';
import { PEER_WORKSPACE_ITEMS } from '../../lib/workspace-navigation';
import { useKanbanStream } from '../../runtime/useKanbanStream';
import { WorkspaceRouter } from '../workspaces/WorkspaceRouter';
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

const WORKSPACE_TITLES: Record<string, string> = {
  sops: 'SOPs',
  market: 'Market',
  personnel: 'Personnel',
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
  agents: React.ComponentProps<typeof AgentPanel>['agents'];
  onFileImport: (file: File) => void;
  projects: React.ComponentProps<typeof ProjectSelector>['projects'];
  activeProjectId: React.ComponentProps<typeof ProjectSelector>['activeProjectId'];
  setActiveProjectId: React.ComponentProps<typeof ProjectSelector>['onSelect'];
  onRequestCreateProject: () => void;
  onRequestEditProject: React.ComponentProps<typeof ProjectSelector>['onRequestEditProject'];
  activeProjectStatus: React.ComponentProps<typeof StatusBar>['activeProjectStatus'];
  chatOpenToken: number;
  collaborationRailProps: CollaborationRailProps;
  handleOpenSettings: () => void;
  handleBackToOffice: () => void;
  onSelectWorkspace: (key: WorkspaceKey) => void;
  onOpenCompanySelect: () => void;
  onOpenEmployeeCreator: () => void;
  onToggleDashboard: () => void;
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
    activeProjectStatus,
    chatOpenToken,
    collaborationRailProps,
    handleOpenSettings,
    handleBackToOffice,
    onSelectWorkspace,
    onOpenCompanySelect,
    onOpenEmployeeCreator,
    onToggleDashboard,
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
  } = props;
  const kanban = useKanbanStream(activeProjectId);
  const activeProject = useMemo(
    () => projects.find((project) => project.project_id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );
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
        />
      }
      taskTray={null}
      agentPanel={
        isOffice ? (
          <AgentPanel
            agents={agents}
            onSelectEmployee={onSelectEmployee}
            selectedEmployeeId={officeState.selectedEmployeeId}
            onOpenCreator={onOpenEmployeeCreator}
          />
        ) : null
      }
      sceneCanvas={
        isOffice ? (
          <Suspense fallback={<div className="h-full w-full animate-pulse bg-ocean-deep" />}>
            <OfficeSceneSurface
              leftPanelWidth={officeState.leftPanelWidth}
              onSceneFallbackTo2D={onSceneFallbackTo2D}
              onSelectEmployee={onSelectEmployee}
              rightPanelWidth={officeState.rightPanelWidth}
              selectedEmployeeId={officeState.selectedEmployeeId}
              sceneInteractive={sceneInteractive}
              viewMode={officeState.viewMode}
              viewModeNonce={viewModeNonce}
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
            <CollaborationSidebar
              {...collaborationRailProps}
              projectSlot={<ProjectSelector {...projectSelectorProps} summaryMode="none" />}
              projectSummarySlot={
                activeProject ? (
                  <ProjectSelectedSummary
                    project={activeProject}
                    onRequestEdit={onRequestEditProject}
                    onError={collaborationRailProps.onProjectError}
                    showWorkspaceFiles
                  />
                ) : null
              }
              kanbanCardCount={kanban.cards.length}
              onSearchSelectEmployee={onEditExternalEmployee}
              kanbanSlot={
                <KanbanTray
                  expanded
                  requestText={lastUserRequest ?? undefined}
                  cards={kanban.cards}
                  onMove={kanban.move as (id: string, next: KanbanState) => Promise<void>}
                  onCreate={kanban.create as (input: CreateKanbanCardInput) => Promise<void>}
                  onToggle={onToggleKanban}
                />
              }
            />
          </Suspense>
        ) : null
      }
      centerContent={
        !isOffice ? (
          <WorkspaceRouter
            activeWorkspace={activeWorkspace}
            sessionState={workspaceSessionState}
            updateWorkspaceState={updateWorkspaceState}
            marketPageProps={{ onStartInstall: onStartMarketInstall }}
            activityLogPageProps={{ onBackToOffice: handleBackToOffice }}
            personnelPageProps={{
              onOpenCreator: onOpenEmployeeCreator,
              onOpenMarket: () => onSelectWorkspace('market'),
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
      statusBar={
        <StatusBar
          modelName={providerConfig?.model}
          activeProjectStatus={activeProjectStatus}
          dashboardSlot={
            isOffice ? (
              <button
                type="button"
                onClick={onToggleDashboard}
                className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[10px] font-semibold uppercase tracking-wider transition ${
                  officeState.dashboardOpen
                    ? 'border-border-focus bg-accent-muted text-accent-text'
                    : 'border-border-subtle bg-surface-muted text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                }`}
                aria-pressed={officeState.dashboardOpen}
                aria-label="Toggle dashboard"
                title="Toggle dashboard (⌘D)"
              >
                Dashboard
              </button>
            ) : null
          }
          notificationSlot={
            isOffice ? (
              <NotificationCenter
                onFocusEmployee={onFocusEmployee}
                onOpenActivityLog={onOpenActivityLog}
              />
            ) : null
          }
          gitBranchSlot={null}
        />
      }
      chatDrawerMode="mobile-only"
      requestRightExpandToken={chatOpenToken}
      onLayoutMetricsChange={onLayoutMetricsChange}
    />
  );
}
