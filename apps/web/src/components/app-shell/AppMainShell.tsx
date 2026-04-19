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
import React, { Suspense } from 'react';
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
  onOpenCompanyEditor: () => void;
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
  onOpenSops: () => void;
  onOpenMarket: () => void;
  onOpenStudio: () => void;
  onOpenCompanySelect: () => void;
  onOpenEmployeeCreator: () => void;
  onSelectEmployee: (id: string | null) => void;
  onViewModeChange: (mode: '2D' | '3D') => void;
  onSceneFallbackTo2D: () => void;
  onLayoutMetricsChange: (metrics: { leftPanelWidth: number; rightPanelWidth: number }) => void;
  onSaveConfig: (config: ProviderConfig) => void;
  onOpenActivityLog: () => void;
  onFocusEmployee: (id: string) => void;
  onStartMarketInstall: (listingId: string, version: string) => void;
  addToast: (message: string, variant?: ToastVariant) => void;
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
    onOpenCompanyEditor,
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
    onOpenSops,
    onOpenMarket,
    onOpenStudio,
    onOpenCompanySelect,
    onOpenEmployeeCreator,
    onSelectEmployee,
    onViewModeChange,
    onSceneFallbackTo2D,
    onLayoutMetricsChange,
    onSaveConfig,
    onOpenActivityLog,
    onFocusEmployee,
    onStartMarketInstall,
    addToast,
  } = props;

  return (
    <AppLayout
      header={
        <Header
          providerName={providerConfig?.model}
          companyName={activeCompanyName}
          onOpenSettings={handleOpenSettings}
          onOpenOffice={handleBackToOffice}
          onOpenSops={onOpenSops}
          onOpenMarket={onOpenMarket}
          onOpenStudio={onOpenStudio}
          onOpenCompanySelect={onOpenCompanySelect}
          onOpenCompanyEditor={onOpenCompanyEditor}
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
