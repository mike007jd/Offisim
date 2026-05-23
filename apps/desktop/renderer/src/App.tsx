import type { CompanyStartupPayload, ProjectRow, RuntimeEvent } from '@offisim/shared-types';
import { ToastBanner, TooltipProvider, useToasts } from '@offisim/ui-core';
import {
  EmployeeInspector,
  ErrorBoundary,
  FirstRunWelcomeScreen,
  OnboardingTourProvider,
  ProjectCreateDialog,
  type ProviderConfig,
  ResumeBar,
  loadProviderConfig,
  useAgentStates,
  useCompany,
  useDeepLinkInstall,
  useFirstRunGuidance,
  useInstallFlow,
  useOffisimRuntimeExecution,
  useOffisimRuntimeServices,
  useProjects,
} from '@offisim/ui-office/web';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OnboardingController } from './components/OnboardingController';
import { AppGlobalDialogs } from './components/app-shell/AppGlobalDialogs';
import { AppMainShell } from './components/app-shell/AppMainShell';
import { AppOverlayHost } from './components/app-shell/AppOverlayHost';
import { AppResumeBannerHost } from './components/app-shell/AppShellSurfaces';
import { useWorkspaceSessionState } from './components/workspaces/useWorkspaceSessionState';
import { useAppKeyboardShortcuts } from './hooks/useAppKeyboardShortcuts';
import { useAppRuntimeToasts } from './hooks/useAppRuntimeToasts';
import { useCompanyBootstrap } from './hooks/useCompanyBootstrap';
import { useCompanyLifecycle } from './hooks/useCompanyLifecycle';
import { useOfficeStateBindings } from './hooks/useOfficeStateBindings';
import { useOverlayState } from './hooks/useOverlayState';
import { useThreadBootstrap } from './hooks/useThreadBootstrap';
import { getOnboardingCopy } from './lib/onboarding-prompts';
import {
  dismissTour,
  getCompanyOnboardingState,
  markAccount,
  markWelcomeSeen,
  setCompanyStartupCeremony,
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

  const { repos, eventBus, attachmentStore } = useOffisimRuntimeServices();
  const { reinitRuntime, unfinishedThreads, dismissUnfinishedThreads, resumeThread } =
    useOffisimRuntimeExecution();
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
  const handleProjectWorkspaceError = useCallback(
    (message: string) => addToast(message, 'error'),
    [addToast],
  );

  const officeBindings = useOfficeStateBindings({ activeCompanyId, updateWorkspaceState });

  useThreadBootstrap({
    chatThreads: repos?.chatThreads ?? null,
    activeProjectId,
    selectedThreadId: officeState.selectedThreadId,
    updateWorkspaceState,
  });

  useAppRuntimeToasts({
    eventBus,
    addToast,
    onOpenTasks: officeBindings.bumpFocusOutputsToken,
  });

  useEffect(() => {
    return eventBus.on('company.startup.', (event: RuntimeEvent<CompanyStartupPayload>) => {
      const payload = event.payload;
      const existingStartup = getCompanyOnboardingState(payload.companyId).startup_ceremony;
      const base = {
        startup_id: payload.startupId,
        source: payload.source,
        provider_ready: payload.providerReady,
        replay: payload.isReplay,
        replay_count:
          payload.isReplay && existingStartup.startup_id !== payload.startupId
            ? existingStartup.replay_count + 1
            : existingStartup.replay_count,
      };
      switch (payload.status) {
        case 'requested':
          setCompanyStartupCeremony(payload.companyId, {
            ...base,
            requested: true,
            completed: false,
            skipped: false,
            failed: false,
            requested_at: payload.requestedAt,
          });
          return;
        case 'started':
          setCompanyStartupCeremony(payload.companyId, {
            ...base,
            requested: true,
            started: true,
            started_at: payload.startedAt,
          });
          return;
        case 'completed':
          setCompanyStartupCeremony(payload.companyId, {
            ...base,
            completed: true,
            skipped: false,
            failed: false,
            completed_at: payload.completedAt,
          });
          return;
        case 'skipped':
          setCompanyStartupCeremony(payload.companyId, {
            ...base,
            skipped: true,
            failed: false,
            skipped_at: payload.skippedAt,
          });
          return;
        default:
          setCompanyStartupCeremony(payload.companyId, {
            ...base,
            failed: true,
            failed_at: payload.failedAt,
            failure_error: payload.error,
          });
      }
    });
  }, [eventBus]);

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
    handleToggleKanban: officeBindings.handleToggleKanban,
    updateWorkspaceState,
    onViewModeClick: officeBindings.onViewModeClick,
  });

  useEffect(() => {
    if (providerConfig) {
      markAccount('provider_configured');
    }
  }, [providerConfig]);

  // Boot-time chat-attachment GC sweep. Time-sliced via requestIdleCallback
  // inside the sweeper; not awaited so it never blocks first paint. Re-fires
  // when the runtime is recreated (different repos/store/bus identities).
  useEffect(() => {
    if (!repos || !attachmentStore || !eventBus) return;
    void import('./lib/attachment-gc').then(({ attachmentGcSweeper }) => {
      void attachmentGcSweeper.run({ attachmentStore, repos, eventBus });
    });
  }, [repos, attachmentStore, eventBus]);

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
    officeState.kanbanOpen ||
    officeState.marketplaceListingId !== null ||
    installFlow.isOpen ||
    shortcutHelpOpen ||
    companyWizardMode !== null;

  const handleSelectThread = useCallback(
    (threadId: string) =>
      updateWorkspaceState('office', (prev) =>
        prev.selectedThreadId === threadId ? prev : { ...prev, selectedThreadId: threadId },
      ),
    [updateWorkspaceState],
  );

  const collaborationRailProps = useMemo(
    () => ({
      activeProject,
      activeThreadId: officeState.selectedThreadId,
      onSelectThread: handleSelectThread,
      chatOnboardingStarterPrompts: onboardingCopy.starterPrompts,
      chatOpenToken: officeBindings.chatOpenToken,
      focusOutputsToken: officeBindings.focusOutputsToken,
      onOpenOfficeEditor: overlay.openOfficeEditor,
      onOpenSettings: handleOpenSettings,
      onOpenStudio: lifecycle.handleOpenStudio,
      onSelectEmployee: officeBindings.handleSelectEmployee,
      onToggleKanban: officeBindings.handleToggleKanban,
      onUserMessage: officeBindings.handleUserMessage,
      onRequestEditProject: handleRequestEditProject,
      onProjectError: handleProjectWorkspaceError,
      selectedEmployeeId: officeState.selectedEmployeeId,
      selectedEmployeeName,
    }),
    [
      activeProject,
      handleOpenSettings,
      handleProjectWorkspaceError,
      handleRequestEditProject,
      handleSelectThread,
      lifecycle.handleOpenStudio,
      officeBindings.chatOpenToken,
      officeBindings.focusOutputsToken,
      officeBindings.handleSelectEmployee,
      officeBindings.handleToggleKanban,
      officeBindings.handleUserMessage,
      officeState.selectedEmployeeId,
      officeState.selectedThreadId,
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
            <AppResumeBannerHost>
              <ResumeBar
                projects={unfinishedThreads}
                onResume={(threadId: string) => void resumeThread(threadId)}
                onDismiss={dismissUnfinishedThreads}
              />
            </AppResumeBannerHost>
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
            repos={repos}
            onStudioCompanyCreated={lifecycle.handleStudioCompanyCreated}
            onCreatorDeploy={lifecycle.handleCreatorDeploy}
            updateOfficeState={officeBindings.updateOfficeState}
            updateWorkspaceState={updateWorkspaceState}
            installFlow={installFlow}
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
              sceneInteractive={overlay.activeOverlay === null}
              agents={agents}
              onFileImport={(file) => installFlow.startFileImport(file)}
              projects={projects}
              activeProjectId={activeProjectId}
              setActiveProjectId={setActiveProjectId}
              onRequestCreateProject={handleRequestCreateProject}
              onRequestEditProject={handleRequestEditProject}
              chatOpenToken={officeBindings.chatOpenToken}
              collaborationRailProps={collaborationRailProps}
              handleOpenSettings={handleOpenSettings}
              handleBackToOffice={handleBackToOffice}
              onSelectWorkspace={setActiveWorkspace}
              onOpenCompanySelect={overlay.openCompanySelect}
              onOpenEmployeeCreator={overlay.openEmployeeCreator}
              onToggleKanban={officeBindings.handleToggleKanban}
              onSelectEmployee={officeBindings.handleSelectEmployee}
              onViewModeChange={officeBindings.onViewModeChange}
              onViewModeClick={officeBindings.onViewModeClick}
              viewModeNonce={officeBindings.viewModeNonce}
              onSceneFallbackTo2D={officeBindings.onSceneFallbackTo2D}
              onLayoutMetricsChange={officeBindings.onLayoutMetricsChange}
              onSaveConfig={lifecycle.handleSaveConfig}
              onOpenActivityLog={() => setActiveWorkspace('activity-log')}
              onFocusEmployee={onFocusEmployeeFromNotifications}
              onStartMarketInstall={installFlow.startRegistryInstall}
              addToast={addToast}
              onEditExternalEmployee={(id) => routeToPersonnel(id, 'profile')}
              lastUserRequest={officeBindings.lastUserRequest}
              activeCompanyId={activeCompanyId}
              onSelectThread={handleSelectThread}
              selectedEmployeeId={officeState.selectedEmployeeId}
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
              addToast={addToast}
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
