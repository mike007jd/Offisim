import type { ProjectRow } from '@offisim/shared-types';
import type { InteractionMode } from '@offisim/shared-types';
import { ToastBanner, TooltipProvider, useToasts } from '@offisim/ui-core';
import {
  EmployeeInspector,
  ErrorBoundary,
  FirstRunWelcomeScreen,
  OnboardingTourProvider,
  ProjectCreateDialog,
  type ProviderConfig,
  ResumeBar,
  isTauri,
  loadProviderConfig,
  useAgentStates,
  useCompany,
  useDeepLinkInstall,
  useFirstRunGuidance,
  useInstallFlow,
  useOffisimRuntime,
  useProjects,
} from '@offisim/ui-office/web';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OnboardingController } from './components/OnboardingController';
import { AppGlobalDialogs } from './components/app-shell/AppGlobalDialogs';
import { AppMainShell } from './components/app-shell/AppMainShell';
import { AppOverlayHost } from './components/app-shell/AppOverlayHost';
import { useWorkspaceSessionState } from './components/workspaces/useWorkspaceSessionState';
import { useAppKeyboardShortcuts } from './hooks/useAppKeyboardShortcuts';
import { useAppRuntimeToasts } from './hooks/useAppRuntimeToasts';
import { useCompanyBootstrap } from './hooks/useCompanyBootstrap';
import { useCompanyLifecycle } from './hooks/useCompanyLifecycle';
import { useOfficeStateBindings } from './hooks/useOfficeStateBindings';
import { useOverlayState } from './hooks/useOverlayState';
import { getOnboardingCopy } from './lib/onboarding-prompts';
import {
  dismissTour,
  markAccount,
  markWelcomeSeen,
  useOnboardingState,
} from './lib/onboarding-store';
import { createRouteToPersonnel } from './lib/personnel-routing';
import { parseInitialUrl, urlRequiresCompany } from './lib/url-routing';
import type { ParsedUrl } from './lib/url-routing';
import { useUrlSync } from './lib/url-routing/useUrlSync';

interface AppProps {
  onCompanySwitch: (id: string | null) => void;
}

export function App({ onCompanySwitch }: AppProps) {
  const { activeCompanyId, companies, switchCompany, refreshCompanies } = useCompany();
  const [initialParsedUrl] = useState(parseInitialUrl);
  const initialUrlCompanyId = initialParsedUrl.companyId ?? null;
  const initialCompanyMismatch =
    initialUrlCompanyId !== null &&
    activeCompanyId !== null &&
    initialUrlCompanyId !== activeCompanyId;
  const pendingInitialDeepLink =
    (!activeCompanyId && urlRequiresCompany(initialParsedUrl)) || initialCompanyMismatch;
  const pendingDeepLinkRef = useRef<ParsedUrl | null>(
    pendingInitialDeepLink ? initialParsedUrl : null,
  );
  const [pendingDeepLinkActive, setPendingDeepLinkActive] = useState(pendingInitialDeepLink);
  const effectiveInitialUrl = pendingInitialDeepLink
    ? ({ workspace: 'office', sessionPatch: {}, overlay: null } satisfies ParsedUrl)
    : initialParsedUrl;
  const overlay = useOverlayState({
    activeCompanyId,
    initial: effectiveInitialUrl.overlay,
  });

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
    applyParsedUrl,
  } = useWorkspaceSessionState({
    initial: {
      activeWorkspace: effectiveInitialUrl.workspace,
      sessionPatch: effectiveInitialUrl.sessionPatch,
    },
  });
  const { toasts, addToast, dismissToast } = useToasts();
  const agents = useAgentStates();
  const onboardingState = useOnboardingState();

  const switchToCompany = useCallback(
    (companyId: string) => {
      switchCompany(companyId);
      onCompanySwitch(companyId);
    },
    [onCompanySwitch, switchCompany],
  );

  const applyParsedUrlAndOverlay = useCallback(
    (parsed: ParsedUrl) => {
      const targetCompanyId = parsed.companyId ?? null;
      if (targetCompanyId !== null && targetCompanyId !== activeCompanyId) {
        switchToCompany(targetCompanyId);
        return;
      }
      applyParsedUrl(parsed);
      overlay.setActiveOverlay(parsed.overlay);
    },
    [activeCompanyId, applyParsedUrl, overlay.setActiveOverlay, switchToCompany],
  );

  const urlFallbackRuntime = useMemo(
    () => ({
      agents,
      companies,
    }),
    [agents, companies],
  );

  useUrlSync({
    workspace: activeWorkspace,
    sessionState: workspaceSessionState,
    overlay: overlay.activeOverlay === 'company-select' ? null : overlay.activeOverlay,
    activeCompanyId,
    applyParsed: applyParsedUrlAndOverlay,
    runtime: urlFallbackRuntime,
    emitToast: ({ message, level }) => addToast(message, level),
    onPopState: () => {
      pendingDeepLinkRef.current = null;
      setPendingDeepLinkActive(false);
    },
    enabled: !pendingDeepLinkActive,
  });

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
    interactionMode = 'boss_proxy',
    setInteractionMode,
  } = useOffisimRuntime();
  const installFlow = useInstallFlow();
  const routeToPersonnel = useMemo(
    () => createRouteToPersonnel({ applyParsedUrl: applyParsedUrlAndOverlay }),
    [applyParsedUrlAndOverlay],
  );
  const { toasts: guidanceToasts, dismissToast: dismissGuidanceToast } = useFirstRunGuidance();
  const {
    projects,
    activeProject,
    activeProjectId,
    setActiveProjectId,
    createProject,
    updateProject,
  } = useProjects({ repos, companyId: activeCompanyId ?? '' });

  type ProjectDialogState = { mode: 'create' } | { mode: 'edit'; initial: ProjectRow } | null;
  const [projectDialog, setProjectDialog] = useState<ProjectDialogState>(null);
  const handleRequestCreateProject = useCallback(() => setProjectDialog({ mode: 'create' }), []);
  const handleRequestEditProject = useCallback(
    (project: ProjectRow) => setProjectDialog({ mode: 'edit', initial: project }),
    [],
  );
  const handleProjectDialogCreate = useCallback(
    async (input: { name: string; description: string | null; workspaceRoot: string | null }) =>
      createProject({
        name: input.name,
        description: input.description,
        workspaceRoot: input.workspaceRoot,
      }),
    [createProject],
  );
  const handleProjectDialogUpdate = useCallback(
    async (
      projectId: string,
      patch: { name?: string; description?: string | null; workspace_root?: string | null },
    ) => updateProject(projectId, patch),
    [updateProject],
  );
  const handleProjectStripError = useCallback(
    (message: string) => addToast(message, 'error'),
    [addToast],
  );

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
    activeWorkspace,
    workspaceSessionState,
    isOffice,
    officeState,
    activeOverlay: overlay.activeOverlay,
    closeOverlay: overlay.closeOverlay,
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

  useEffect(() => {
    if (!pendingDeepLinkRef.current) return;
    const pending = pendingDeepLinkRef.current;
    const targetCompanyId = pending.companyId ?? null;
    if (targetCompanyId !== null && targetCompanyId !== activeCompanyId) {
      switchToCompany(targetCompanyId);
      return;
    }
    if (!activeCompanyId) return;
    pendingDeepLinkRef.current = null;
    setPendingDeepLinkActive(false);
    applyParsedUrl(pending);
    overlay.setActiveOverlay(pending.overlay);
  }, [activeCompanyId, applyParsedUrl, overlay.setActiveOverlay, switchToCompany]);

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
  const activeConversationId = activeProject?.thread_id ?? null;
  const handleInteractionModeChange = useCallback(
    async (mode: InteractionMode) => {
      setInteractionMode?.(mode);
      if (!activeConversationId) return;
      try {
        if (isTauri()) {
          const { invoke } = (await import('@tauri-apps/api/core')) as {
            invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          };
          await invoke('set_session_mode', { id: activeConversationId, mode });
          return;
        }
        await fetch(`/api/sessions/${encodeURIComponent(activeConversationId)}/mode`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        });
      } catch (err) {
        console.warn('[session-mode] host persistence unavailable', err);
      }
    },
    [activeConversationId, setInteractionMode],
  );

  const onboardingCopy = useMemo(() => getOnboardingCopy(activeTemplateId), [activeTemplateId]);
  const providerConfiguredForWelcome =
    onboardingState.account.provider_configured || providerConfig !== null;
  const showFirstRunWelcome = useMemo(
    () =>
      onboardingState.account.welcome_seen === false &&
      providerConfiguredForWelcome === false &&
      companies.length === 0 &&
      onboardingState.account.tour_dismissed === false,
    [
      companies.length,
      onboardingState.account.tour_dismissed,
      onboardingState.account.welcome_seen,
      providerConfiguredForWelcome,
    ],
  );

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
      onRequestEditProject: handleRequestEditProject,
      onProjectStripError: handleProjectStripError,
      selectedEmployeeId: officeState.selectedEmployeeId,
      selectedEmployeeName,
    }),
    [
      activeProject,
      handleOpenSettings,
      handleProjectStripError,
      handleRequestEditProject,
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
      <TooltipProvider delayDuration={700}>
        <OnboardingTourProvider>
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
            onCreateNew={() => {
              overlay.closeOverlay();
              setCompanyWizardMode('create-new');
            }}
            onArchiveCompany={lifecycle.handleArchiveCompany}
            officeState={officeState}
            activeCompanyId={activeCompanyId}
            activeProjectId={activeProjectId}
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
              onRequestCreateProject={handleRequestCreateProject}
              onRequestEditProject={handleRequestEditProject}
              activeProjectStatus={activeProject?.status ?? null}
              interactionMode={interactionMode}
              onInteractionModeChange={handleInteractionModeChange}
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

          <FirstRunWelcomeScreen
            open={showFirstRunWelcome}
            onGetStarted={markWelcomeSeen}
            onSkip={() => {
              markWelcomeSeen();
              dismissTour();
            }}
          />

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
            activeWorkspace={activeWorkspace}
            onSwitchWorkspace={setActiveWorkspace}
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

          <ProjectCreateDialog
            open={projectDialog !== null}
            onOpenChange={(next) => {
              if (!next) setProjectDialog(null);
            }}
            mode={projectDialog?.mode ?? 'create'}
            initial={projectDialog?.mode === 'edit' ? projectDialog.initial : null}
            onCreate={handleProjectDialogCreate}
            onUpdate={handleProjectDialogUpdate}
            onCreated={(project) => setActiveProjectId(project.project_id)}
          />
        </OnboardingTourProvider>
      </TooltipProvider>
    </ErrorBoundary>
  );
}
