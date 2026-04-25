import type { ToastVariant } from '@offisim/ui-core';
import {
  AgentPanel,
  AppLayout,
  Header,
  NotificationCenter,
  ProjectSelector,
  type ProviderConfig,
  StatusBar,
} from '@offisim/ui-office/web';
import React, { Suspense, useMemo } from 'react';
import { PEER_WORKSPACE_ITEMS, buildOfficeToolItems } from '../../lib/workspace-navigation';
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
  activeCompanyId: string | null;
  sceneInteractive: boolean;
  agents: React.ComponentProps<typeof AgentPanel>['agents'];
  onFileImport: (file: File) => void;
  projects: React.ComponentProps<typeof ProjectSelector>['projects'];
  activeProjectId: React.ComponentProps<typeof ProjectSelector>['activeProjectId'];
  setActiveProjectId: React.ComponentProps<typeof ProjectSelector>['onSelect'];
  createProject: React.ComponentProps<typeof ProjectSelector>['onCreateProject'];
  activeProjectStatus: React.ComponentProps<typeof StatusBar>['activeProjectStatus'];
  chatOpenToken: number;
  collaborationRailProps: CollaborationRailProps;
  handleOpenSettings: () => void;
  handleBackToOffice: () => void;
  onSelectWorkspace: (key: WorkspaceKey) => void;
  onOpenStudio: () => void;
  onOpenCompanySelect: () => void;
  onOpenEmployeeCreator: () => void;
  onToggleDashboard: () => void;
  onToggleKanban: () => void;
  onSelectEmployee: (id: string | null) => void;
  onViewModeChange: (mode: '2D' | '3D') => void;
  onSceneFallbackTo2D: () => void;
  onLayoutMetricsChange: (metrics: { leftPanelWidth: number; rightPanelWidth: number }) => void;
  onSaveConfig: (config: ProviderConfig) => void;
  onOpenActivityLog: () => void;
  onFocusEmployee: (id: string) => void;
  onStartMarketInstall: (listingId: string, version: string) => void;
  addToast: (message: string, variant?: ToastVariant) => void;
  onEditExternalEmployee: (employeeId: string) => void;
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
    activeCompanyId,
    sceneInteractive,
    agents,
    onFileImport,
    projects,
    activeProjectId,
    setActiveProjectId,
    createProject,
    activeProjectStatus,
    chatOpenToken,
    collaborationRailProps,
    handleOpenSettings,
    handleBackToOffice,
    onSelectWorkspace,
    onOpenStudio,
    onOpenCompanySelect,
    onOpenEmployeeCreator,
    onToggleDashboard,
    onToggleKanban,
    onSelectEmployee,
    onViewModeChange,
    onSceneFallbackTo2D,
    onLayoutMetricsChange,
    onSaveConfig,
    onOpenActivityLog,
    onFocusEmployee,
    onStartMarketInstall,
    addToast,
    onEditExternalEmployee,
  } = props;

  const officeToolItems = useMemo(
    () =>
      buildOfficeToolItems({
        hasActiveCompany: activeCompanyId !== null,
        dashboardOpen: officeState.dashboardOpen,
        kanbanOpen: officeState.kanbanOpen,
        onOpenStudio,
        onToggleDashboard,
        onToggleKanban,
        onOpenAddEmployee: onOpenEmployeeCreator,
      }),
    [
      activeCompanyId,
      officeState.dashboardOpen,
      officeState.kanbanOpen,
      onOpenStudio,
      onToggleDashboard,
      onToggleKanban,
      onOpenEmployeeCreator,
    ],
  );

  return (
    <AppLayout
      header={
        <Header
          providerName={providerConfig?.model}
          companyName={activeCompanyName}
          onOpenSettings={handleOpenSettings}
          onOpenCompanySelect={onOpenCompanySelect}
          onFileImport={onFileImport}
          notificationSlot={
            <NotificationCenter
              onFocusEmployee={onFocusEmployee}
              onOpenActivityLog={onOpenActivityLog}
            />
          }
          projectSlot={
            <ProjectSelector
              projects={projects}
              activeProjectId={activeProjectId}
              onSelect={setActiveProjectId}
              onCreateProject={createProject}
            />
          }
          viewMode={officeState.viewMode}
          onViewModeChange={onViewModeChange}
          needsConfig={!providerConfig}
          activeWorkspace={activeWorkspace}
          onBackToOffice={handleBackToOffice}
          workspaceTitle={WORKSPACE_TITLES[activeWorkspace]}
          peerWorkspaces={PEER_WORKSPACE_ITEMS}
          onSelectWorkspace={onSelectWorkspace}
          officeTools={officeToolItems}
        />
      }
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
            marketPageProps={{ onStartInstall: onStartMarketInstall }}
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
        <StatusBar modelName={providerConfig?.model} activeProjectStatus={activeProjectStatus} />
      }
      chatDrawerMode="mobile-only"
      requestRightExpandToken={chatOpenToken}
      onLayoutMetricsChange={onLayoutMetricsChange}
    />
  );
}
