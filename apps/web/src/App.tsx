import { ToastBanner, useToasts } from '@offisim/ui-core';
import {
  EmployeeInspector,
  ErrorBoundary,
  type ProviderConfig,
  ResumeBar,
  loadProviderConfig,
  useAgentStates,
  useCompany,
  useDeepLinkInstall,
  useFirstRunGuidance,
  useInstallFlow,
  useOffisimRuntime,
  useProjects,
} from '@offisim/ui-office/web';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { OnboardingController } from './components/OnboardingController';
import { AppGlobalDialogs } from './components/app-shell/AppGlobalDialogs';
import { AppMainShell } from './components/app-shell/AppMainShell';
import { AppOverlayHost } from './components/app-shell/AppOverlayHost';
import { useWorkspaceBackNavigation } from './components/workspaces/useWorkspaceBackNavigation';
import { useWorkspaceSessionState } from './components/workspaces/useWorkspaceSessionState';
import { useAppKeyboardShortcuts } from './hooks/useAppKeyboardShortcuts';
import { useAppRuntimeToasts } from './hooks/useAppRuntimeToasts';
import { useCompanyBootstrap } from './hooks/useCompanyBootstrap';
import { useCompanyLifecycle } from './hooks/useCompanyLifecycle';
import { useOfficeStateBindings } from './hooks/useOfficeStateBindings';
import { useOverlayState } from './hooks/useOverlayState';
import { getOnboardingCopy } from './lib/onboarding-prompts';
import { markAccount } from './lib/onboarding-store';
import { createRouteToPersonnel } from './lib/personnel-routing';

interface AppProps {
  onCompanySwitch: (id: string | null) => void;
}

export function App({ onCompanySwitch }: AppProps) {
  const { activeCompanyId, companies, switchCompany, refreshCompanies } = useCompany();
  const overlay = useOverlayState(activeCompanyId);

  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(loadProviderConfig);
  const [companyWizardMode, setCompanyWizardMode] = useState<'create-new' | null>(null);
  const [portalPreviewCompanyId, setPortalPreviewCompanyId] = useState<string | null>(
    activeCompanyId,
  );
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);

  const {
    state: workspaceSessionState,
    activeWorkspace,
    setActiveWorkspace,
    updateWorkspaceState,
    goBack,
  } = useWorkspaceSessionState();

  useWorkspaceBackNavigation(activeWorkspace, goBack);

  const officeState = workspaceSessionState.office;
  const isOffice = activeWorkspace === 'office';

  const handleOpenSettings = useCallback(
    () => setActiveWorkspace('settings'),
    [setActiveWorkspace],
  );
  const handleBackToOffice = useCallback(() => setActiveWorkspace('office'), [setActiveWorkspace]);

  const {
    reinitRuntime,
    repos,
    eventBus,
    unfinishedThreads,
    dismissUnfinishedThreads,
    resumeThread,
  } = useOffisimRuntime();
  const installFlow = useInstallFlow();
  const routeToPersonnel = useMemo(
    () => createRouteToPersonnel({ setActiveWorkspace, updateWorkspaceState }),
    [setActiveWorkspace, updateWorkspaceState],
  );
  const { toasts, addToast, dismissToast } = useToasts();
  const { toasts: guidanceToasts, dismissToast: dismissGuidanceToast } = useFirstRunGuidance();
  const agents = useAgentStates();
  const { projects, activeProject, activeProjectId, setActiveProjectId, createProject } =
    useProjects({ repos, companyId: activeCompanyId ?? '' });

  const officeBindings = useOfficeStateBindings({ activeCompanyId, updateWorkspaceState });

  useAppRuntimeToasts({
    eventBus,
    addToast,
    onOpenTasks: officeBindings.bumpFocusOutputsToken,
  });

  const lifecycle = useCompanyLifecycle({
    repos,
    eventBus,
    addToast,
    refreshCompanies,
    switchCompany,
    onCompanySwitch,
    activeCompanyId,
    companies,
    setPortalPreviewCompanyId,
    companyWizardMode,
    setCompanyWizardMode,
    closeOverlay: overlay.closeOverlay,
    openStudio: overlay.openStudio,
    openSettings: handleOpenSettings,
    reinitRuntime,
    providerConfig,
    setProviderConfig,
    isOffice,
  });

  useCompanyBootstrap({
    activeCompanyId,
    repos,
    eventBus,
    onCompanySwitch,
    setActiveOverlay: overlay.setActiveOverlay,
    updateWorkspaceState,
    setActiveTemplateId,
    portalPreviewCompanyId,
    setPortalPreviewCompanyId,
  });

  useAppKeyboardShortcuts({
    isOffice,
    officeState,
    activeOverlay: overlay.activeOverlay,
    closeOverlay: overlay.closeOverlay,
    goBack,
    setShortcutHelpOpen,
    routeToPersonnel,
    handleToggleDashboard: officeBindings.handleToggleDashboard,
    handleToggleKanban: officeBindings.handleToggleKanban,
    updateWorkspaceState,
  });

  useEffect(() => {
    if (providerConfig) {
      markAccount('provider_configured');
    }
  }, [providerConfig]);

  useDeepLinkInstall(
    useCallback(
      ({ listing_id, version }) => {
        console.info('[deep-link] Install requested:', { listing_id, version });
        addToast(`Fetching package ${listing_id} v${version}...`, 'info');
        installFlow.startRegistryInstall(listing_id, version);
      },
      [addToast, installFlow.startRegistryInstall],
    ),
  );

  const activeCompanyName = useMemo(
    () => companies.find((c) => c.company_id === activeCompanyId)?.name,
    [companies, activeCompanyId],
  );
  const selectedEmployeeName = officeState.selectedEmployeeId
    ? (agents.get(officeState.selectedEmployeeId)?.name ?? null)
    : null;

  const onboardingCopy = useMemo(() => getOnboardingCopy(activeTemplateId), [activeTemplateId]);

  const anyOverlayOpen =
    officeState.dashboardOpen ||
    officeState.kanbanOpen ||
    officeState.marketplaceListingId !== null ||
    installFlow.isOpen ||
    shortcutHelpOpen ||
    companyWizardMode !== null;

  const collaborationRailProps = useMemo(
    () => ({
      activeProject,
      chatOnboardingStarterPrompts: onboardingCopy.starterPrompts,
      chatOpenToken: officeBindings.chatOpenToken,
      focusOutputsToken: officeBindings.focusOutputsToken,
      onOpenOfficeEditor: overlay.openOfficeEditor,
      onOpenSettings: handleOpenSettings,
      onOpenStudio: lifecycle.handleOpenStudio,
      onSelectEmployee: officeBindings.handleSelectEmployee,
      onToggleDashboard: officeBindings.handleToggleDashboard,
      onToggleKanban: officeBindings.handleToggleKanban,
      onUserMessage: officeBindings.handleUserMessage,
      selectedEmployeeId: officeState.selectedEmployeeId,
      selectedEmployeeName,
    }),
    [
      activeProject,
      handleOpenSettings,
      lifecycle.handleOpenStudio,
      officeBindings.chatOpenToken,
      officeBindings.focusOutputsToken,
      officeBindings.handleSelectEmployee,
      officeBindings.handleToggleDashboard,
      officeBindings.handleToggleKanban,
      officeBindings.handleUserMessage,
      officeState.selectedEmployeeId,
      onboardingCopy.starterPrompts,
      overlay.openOfficeEditor,
      selectedEmployeeName,
    ],
  );

  const showLayout = overlay.activeOverlay === null || overlay.activeOverlay === 'employee-creator';
  const onFocusEmployeeFromNotifications = useCallback(
    (employeeId: string) => {
      officeBindings.handleSelectEmployee(employeeId);
      officeBindings.bumpChatOpenToken();
    },
    [officeBindings],
  );

  return (
    <ErrorBoundary>
      <>
        <ToastBanner toasts={toasts} onDismiss={dismissToast} />
        <ToastBanner toasts={guidanceToasts} onDismiss={dismissGuidanceToast} />

        {isOffice && unfinishedThreads.length > 0 && (
          <div className="fixed top-2 left-1/2 z-50 w-full max-w-2xl -translate-x-1/2 px-4">
            <ResumeBar
              projects={unfinishedThreads}
              onResume={(threadId: string) => void resumeThread(threadId)}
              onDismiss={dismissUnfinishedThreads}
            />
          </div>
        )}

        <AppOverlayHost
          activeOverlay={overlay.activeOverlay}
          closeOverlay={overlay.closeOverlay}
          portalPreviewCompanyId={portalPreviewCompanyId}
          setPortalPreviewCompanyId={setPortalPreviewCompanyId}
          onEnterCompany={lifecycle.handleSelectCompany}
          onCreateNew={() => setCompanyWizardMode('create-new')}
          onArchiveCompany={lifecycle.handleArchiveCompany}
          officeState={officeState}
          activeCompanyId={activeCompanyId}
          repos={repos}
          activeThreadId={activeProject?.thread_id ?? null}
          onStudioCompanyCreated={lifecycle.handleStudioCompanyCreated}
          onCreatorDeploy={lifecycle.handleCreatorDeploy}
          updateOfficeState={officeBindings.updateOfficeState}
          updateWorkspaceState={updateWorkspaceState}
          installFlow={installFlow}
          lastUserRequest={officeBindings.lastUserRequest}
        />

        {showLayout && (
          <AppMainShell
            activeWorkspace={activeWorkspace}
            isOffice={isOffice}
            workspaceSessionState={workspaceSessionState}
            updateWorkspaceState={updateWorkspaceState}
            officeState={officeState}
            providerConfig={providerConfig}
            activeCompanyName={activeCompanyName}
            activeCompanyId={activeCompanyId}
            sceneInteractive={overlay.activeOverlay === null}
            agents={agents}
            onFileImport={(file) => installFlow.startFileImport(file)}
            projects={projects}
            activeProjectId={activeProjectId}
            setActiveProjectId={setActiveProjectId}
            createProject={createProject}
            activeProjectStatus={activeProject?.status ?? null}
            chatOpenToken={officeBindings.chatOpenToken}
            collaborationRailProps={collaborationRailProps}
            handleOpenSettings={handleOpenSettings}
            handleBackToOffice={handleBackToOffice}
            onSelectWorkspace={setActiveWorkspace}
            onOpenStudio={lifecycle.handleOpenStudio}
            onOpenCompanySelect={overlay.openCompanySelect}
            onOpenEmployeeCreator={overlay.openEmployeeCreator}
            onToggleDashboard={officeBindings.handleToggleDashboard}
            onToggleKanban={officeBindings.handleToggleKanban}
            onSelectEmployee={officeBindings.handleSelectEmployee}
            onViewModeChange={officeBindings.onViewModeChange}
            onSceneFallbackTo2D={officeBindings.onSceneFallbackTo2D}
            onLayoutMetricsChange={officeBindings.onLayoutMetricsChange}
            onSaveConfig={lifecycle.handleSaveConfig}
            onOpenActivityLog={() => setActiveWorkspace('activity-log')}
            onFocusEmployee={onFocusEmployeeFromNotifications}
            onStartMarketInstall={installFlow.startRegistryInstall}
            addToast={addToast}
            onEditExternalEmployee={(id) => routeToPersonnel(id, 'profile')}
          />
        )}

        {isOffice && (
          <EmployeeInspector
            employeeId={officeState.selectedEmployeeId}
            companyId={activeCompanyId ?? ''}
            agents={agents}
            leftOffset={officeState.leftPanelWidth}
            onClose={() => officeBindings.handleSelectEmployee(null)}
            onOpenEditor={(id) => routeToPersonnel(id, 'profile')}
            onStartChat={(id) => {
              officeBindings.handleSelectEmployee(id);
              officeBindings.bumpChatOpenToken();
            }}
          />
        )}

        <OnboardingController
          activeCompanyId={activeCompanyId}
          isOfficeView={isOffice && overlay.activeOverlay === null}
          anyOverlayOpen={anyOverlayOpen}
          directChatActive={officeState.selectedEmployeeId !== null}
        />

        <AppGlobalDialogs
          installFlow={installFlow}
          shortcutHelpOpen={shortcutHelpOpen}
          setShortcutHelpOpen={setShortcutHelpOpen}
          isOffice={isOffice}
          activeOverlay={overlay.activeOverlay}
          activeCompanyId={activeCompanyId}
          companyWizardMode={companyWizardMode}
          onWizardComplete={lifecycle.handleWizardComplete}
          onCreateYourOwn={lifecycle.handleCreateYourOwn}
          onDismissWizard={() => setCompanyWizardMode(null)}
        />
      </>
    </ErrorBoundary>
  );
}
