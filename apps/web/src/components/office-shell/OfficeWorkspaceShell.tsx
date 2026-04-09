import type { EmptyStateWelcome } from '@offisim/ui-office';
import {
  AgentPanel,
  AppLayout,
  EmployeeInspector,
  Header,
  NotificationCenter,
  ProjectSelector,
  ResumeBar,
  StatusBar,
  useAgentStates,
  useCompany,
  useOffisimRuntime,
  useProjects,
} from '@offisim/ui-office/web';
import type { ProviderConfig } from '@offisim/ui-office/web';
import React, { Suspense } from 'react';
import { type AppView, isFullPageWorkspaceView } from '../../lib/app-view-layout';
import type { StarterPrompt } from '../../lib/onboarding-prompts';
import { OnboardingController } from '../OnboardingController';
import type { WorkspaceKey } from '../workspaces/types';
const ChatDock = React.lazy(() =>
  import('./CollaborationRail').then((module) => ({ default: module.ChatDock })),
);
const CollaborationSidebar = React.lazy(() =>
  import('./CollaborationRail').then((module) => ({ default: module.CollaborationSidebar })),
);
const OfficeSceneSurface = React.lazy(() =>
  import('./OfficeSceneSurface').then((module) => ({ default: module.OfficeSceneSurface })),
);

const DashboardOverlay = React.lazy(() =>
  import('@offisim/ui-office/dashboard').then((module) => ({ default: module.DashboardOverlay })),
);
const KanbanOverlay = React.lazy(() =>
  import('@offisim/ui-office/kanban').then((module) => ({ default: module.KanbanOverlay })),
);
const MarketplaceOverlay = React.lazy(() =>
  import('@offisim/ui-office/marketplace').then((module) => ({
    default: module.MarketplaceDetailOverlay,
  })),
);

// ---------------------------------------------------------------------------
// Grouped prop interfaces
// ---------------------------------------------------------------------------

export interface NavigationCallbacks {
  onOpenCompanyEditor: () => void;
  onOpenCompanySelect: () => void;
  onOpenEmployeeCreator: () => void;
  onOpenOfficeEditor: () => void;
  onOpenSettings: () => void;
  onOpenStudio: () => void;
  onWorkspaceSwitch: (workspace: WorkspaceKey) => void;
  onToggleDashboard: () => void;
  onToggleKanban: () => void;
}

export interface EmployeeActions {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onStartChat: (id: string) => void;
  onOpenEditor: (id: string) => void;
}

export interface SceneViewProps {
  viewMode: '2D' | '3D';
  onViewModeChange: (mode: '2D' | '3D') => void;
  onSceneFallbackTo2D: () => void;
}

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

interface OfficeWorkspaceShellProps {
  activeCompanyId: string | null;
  anyOverlayOpen: boolean;
  chatOnboardingStarterPrompts?: readonly StarterPrompt[];
  chatOnboardingWelcome?: EmptyStateWelcome;
  chatOpenToken: number;
  dashboardOpen: boolean;
  focusOutputsToken: number;
  kanbanOpen: boolean;
  lastUserRequest: string | null;
  leftPanelWidth: number;
  rightPanelWidth: number;
  marketplaceListingId: string | null;
  onCloseDashboard: () => void;
  onCloseKanban: () => void;
  onCloseMarketplace: () => void;
  onFileImport: (file: File) => void;
  onInstallListing: (listingId: string, version: string) => void;
  onLayoutMetricsChange: (metrics: {
    leftPanelWidth: number;
    rightPanelWidth: number;
  }) => void;
  onUserMessage: (text: string) => void;
  providerConfig: ProviderConfig | null;
  view: AppView;
  workspaceRouterContent: React.ReactNode;
  navigation: NavigationCallbacks;
  employee: EmployeeActions;
  sceneView: SceneViewProps;
}

export function OfficeWorkspaceShell({
  activeCompanyId,
  anyOverlayOpen,
  chatOnboardingStarterPrompts,
  chatOnboardingWelcome,
  chatOpenToken,
  dashboardOpen,
  focusOutputsToken,
  kanbanOpen,
  lastUserRequest,
  leftPanelWidth,
  rightPanelWidth,
  marketplaceListingId,
  onCloseDashboard,
  onCloseKanban,
  onCloseMarketplace,
  onFileImport,
  onInstallListing,
  onLayoutMetricsChange,
  onUserMessage,
  providerConfig,
  view,
  workspaceRouterContent,
  navigation,
  employee,
  sceneView,
}: OfficeWorkspaceShellProps) {
  const {
    onOpenCompanyEditor,
    onOpenCompanySelect,
    onOpenEmployeeCreator,
    onOpenOfficeEditor,
    onOpenSettings,
    onOpenStudio,
    onWorkspaceSwitch,
    onToggleDashboard,
    onToggleKanban,
  } = navigation;
  const {
    selectedId: selectedEmployeeId,
    onSelect: onSelectEmployee,
    onStartChat: onStartEmployeeChat,
    onOpenEditor: openEmployeeEditor,
  } = employee;
  const { viewMode, onViewModeChange, onSceneFallbackTo2D } = sceneView;
  const { unfinishedThreads, dismissUnfinishedThreads, repos, resumeThread } = useOffisimRuntime();
  const { companies } = useCompany();
  const { projects, activeProject, activeProjectId, setActiveProjectId, createProject } =
    useProjects({
      repos,
      companyId: activeCompanyId ?? '',
    });
  const agents = useAgentStates();
  const activeCompanyName = companies.find(
    (company) => company.company_id === activeCompanyId,
  )?.name;
  const selectedEmployeeName = selectedEmployeeId
    ? (agents.get(selectedEmployeeId)?.name ?? null)
    : null;

  return (
    <>
      {unfinishedThreads.length > 0 && (
        <div className="fixed top-2 left-1/2 z-50 w-full max-w-2xl -translate-x-1/2 px-4">
          <ResumeBar
            projects={unfinishedThreads}
            onResume={(threadId: string) => void resumeThread(threadId)}
            onDismiss={dismissUnfinishedThreads}
          />
        </div>
      )}

      <AppLayout
        header={
          <Header
            providerName={providerConfig?.model}
            companyName={activeCompanyName}
            onOpenSettings={onOpenSettings}
            onOpenOffice={() => onWorkspaceSwitch('office')}
            onOpenSops={() => onWorkspaceSwitch('sops')}
            onOpenMarket={() => onWorkspaceSwitch('market')}
            onOpenStudio={onOpenStudio}
            onOpenCompanySelect={onOpenCompanySelect}
            onOpenCompanyEditor={onOpenCompanyEditor}
            onFileImport={onFileImport}
            notificationSlot={
              <NotificationCenter
                onFocusEmployee={(employeeId) => {
                  onStartEmployeeChat(employeeId);
                }}
                onOpenActivityLog={() => onWorkspaceSwitch('activity-log')}
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
            viewMode={viewMode}
            onViewModeChange={onViewModeChange}
            needsConfig={!providerConfig}
            activeWorkspace={isFullPageWorkspaceView(view) ? (view as WorkspaceKey) : 'office'}
          />
        }
        agentPanel={
          <AgentPanel
            agents={agents}
            onSelectEmployee={onSelectEmployee}
            selectedEmployeeId={selectedEmployeeId}
            onOpenCreator={onOpenEmployeeCreator}
          />
        }
        sceneCanvas={
          <Suspense fallback={<div className="h-full w-full animate-pulse bg-ocean-deep" />}>
            <OfficeSceneSurface
              leftPanelWidth={leftPanelWidth}
              onSceneFallbackTo2D={onSceneFallbackTo2D}
              onSelectEmployee={onSelectEmployee}
              rightPanelWidth={rightPanelWidth}
              selectedEmployeeId={selectedEmployeeId}
              view={view}
              viewMode={viewMode}
            />
          </Suspense>
        }
        chatDrawer={
          <Suspense fallback={null}>
            <ChatDock
              activeProject={activeProject}
              chatOnboardingStarterPrompts={chatOnboardingStarterPrompts}
              chatOnboardingWelcome={chatOnboardingWelcome}
              chatOpenToken={chatOpenToken}
              focusOutputsToken={focusOutputsToken}
              onOpenOfficeEditor={onOpenOfficeEditor}
              onOpenSettings={onOpenSettings}
              onOpenStudio={onOpenStudio}
              onSelectEmployee={onSelectEmployee}
              onToggleDashboard={onToggleDashboard}
              onToggleKanban={onToggleKanban}
              onUserMessage={onUserMessage}
              selectedEmployeeId={selectedEmployeeId}
              selectedEmployeeName={selectedEmployeeName}
            />
          </Suspense>
        }
        eventLog={
          <Suspense fallback={null}>
            <CollaborationSidebar
              activeProject={activeProject}
              chatOnboardingStarterPrompts={chatOnboardingStarterPrompts}
              chatOnboardingWelcome={chatOnboardingWelcome}
              chatOpenToken={chatOpenToken}
              focusOutputsToken={focusOutputsToken}
              onOpenOfficeEditor={onOpenOfficeEditor}
              onOpenSettings={onOpenSettings}
              onOpenStudio={onOpenStudio}
              onSelectEmployee={onSelectEmployee}
              onToggleDashboard={onToggleDashboard}
              onToggleKanban={onToggleKanban}
              onUserMessage={onUserMessage}
              selectedEmployeeId={selectedEmployeeId}
              selectedEmployeeName={selectedEmployeeName}
            />
          </Suspense>
        }
        statusBar={
          <StatusBar
            modelName={providerConfig?.model}
            activeProjectStatus={activeProject?.status ?? null}
          />
        }
        centerContent={workspaceRouterContent}
        chatDrawerMode="mobile-only"
        requestRightExpandToken={chatOpenToken}
        onLayoutMetricsChange={onLayoutMetricsChange}
      />

      {dashboardOpen && (
        <Suspense fallback={null}>
          <DashboardOverlay
            open={dashboardOpen}
            onClose={onCloseDashboard}
            activeThreadId={activeProject?.thread_id ?? null}
          />
        </Suspense>
      )}

      {kanbanOpen && (
        <Suspense fallback={null}>
          <KanbanOverlay
            open={kanbanOpen}
            onClose={onCloseKanban}
            requestText={lastUserRequest ?? undefined}
          />
        </Suspense>
      )}

      {marketplaceListingId && (
        <Suspense fallback={null}>
          <MarketplaceOverlay
            listingId={marketplaceListingId}
            onClose={onCloseMarketplace}
            onInstall={onInstallListing}
          />
        </Suspense>
      )}

      <EmployeeInspector
        employeeId={selectedEmployeeId}
        agents={agents}
        leftOffset={leftPanelWidth}
        onClose={() => onSelectEmployee(null)}
        onOpenEditor={openEmployeeEditor}
        onStartChat={onStartEmployeeChat}
      />

      <OnboardingController
        activeCompanyId={activeCompanyId}
        isOfficeView={view === 'office'}
        anyOverlayOpen={anyOverlayOpen}
        directChatActive={selectedEmployeeId !== null}
      />
    </>
  );
}
