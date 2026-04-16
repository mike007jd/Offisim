import { employeeCreated } from '@offisim/core/browser';
import type {
  RoleSlug,
} from '@offisim/shared-types';
import { ToastBanner, useToasts } from '@offisim/ui-core';
import {
  AgentPanel,
  AppLayout,
  CompanySelectionPage,
  EmployeeEditorDialog,
  EmployeeInspector,
  ErrorBoundary,
  Header,
  KeyboardShortcutsDialog,
  NotificationCenter,
  type ProviderConfig,
  ProjectSelector,
  ResumeBar,
  StatusBar,
  disposeEventLogStore,
  loadProviderConfig,
  primeEventLogStore,
  useAgentStates,
  useCompany,
  useCompanyEditor,
  useDeepLinkInstall,
  useEmployeeEditor,
  useFirstRunGuidance,
  useInstallFlow,
  useOffisimRuntime,
  useProjects,
} from '@offisim/ui-office/web';
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { OnboardingController } from './components/OnboardingController';
import { WorkspaceRouter } from './components/workspaces/WorkspaceRouter';
import { useWorkspaceBackNavigation } from './components/workspaces/useWorkspaceBackNavigation';
import { useWorkspaceSessionState } from './components/workspaces/useWorkspaceSessionState';
import { useAppRuntimeToasts } from './hooks/useAppRuntimeToasts';
import type { OverlayKey } from './lib/app-view-layout';
import { getOnboardingCopy } from './lib/onboarding-prompts';
import { markAccount, markCompany, useCompanyOnboardingState } from './lib/onboarding-store';

const PENDING_VIEW_KEY = 'offisim:pending-view';

const WORKSPACE_TITLES: Record<string, string> = {
  sops: 'SOPs',
  market: 'Market',
  'activity-log': 'Activity Log',
  settings: 'Settings',
};

const CompanyCreationWizard = React.lazy(() =>
  import('@offisim/ui-office/wizard').then((m) => ({ default: m.CompanyCreationWizard })),
);
const EmployeeCreatorOverlay = React.lazy(() =>
  import('@offisim/ui-office/employee-creator').then((m) => ({
    default: m.EmployeeCreatorOverlay,
  })),
);
const OfficeEditorOverlay = React.lazy(() =>
  import('@offisim/ui-office/office-editor').then((m) => ({ default: m.OfficeEditorOverlay })),
);
const CompanyEditor = React.lazy(() =>
  import('@offisim/ui-office/company-editor').then((m) => ({ default: m.CompanyEditor })),
);
const InstallDialog = React.lazy(() =>
  import('@offisim/ui-office/install').then((m) => ({ default: m.InstallDialog })),
);
const StudioPage = React.lazy(() =>
  import('@offisim/ui-office/studio').then((m) => ({ default: m.StudioPage })),
);
const ChatDock = React.lazy(() =>
  import('./components/office-shell/CollaborationRail').then((m) => ({ default: m.ChatDock })),
);
const CollaborationSidebar = React.lazy(() =>
  import('./components/office-shell/CollaborationRail').then((m) => ({
    default: m.CollaborationSidebar,
  })),
);
const OfficeSceneSurface = React.lazy(() =>
  import('./components/office-shell/OfficeSceneSurface').then((m) => ({
    default: m.OfficeSceneSurface,
  })),
);
const DashboardOverlay = React.lazy(() =>
  import('@offisim/ui-office/dashboard').then((m) => ({ default: m.DashboardOverlay })),
);
const KanbanOverlay = React.lazy(() =>
  import('@offisim/ui-office/kanban').then((m) => ({ default: m.KanbanOverlay })),
);
const MarketplaceOverlay = React.lazy(() =>
  import('@offisim/ui-office/marketplace').then((m) => ({
    default: m.MarketplaceDetailOverlay,
  })),
);

interface AppProps {
  onCompanySwitch: (id: string | null) => void;
}

export function App({ onCompanySwitch }: AppProps) {
  const { activeCompanyId, companies, switchCompany, refreshCompanies } = useCompany();

  // ── Overlay state (orthogonal to workspace identity) ─────────────────
  const [activeOverlay, setActiveOverlay] = useState<OverlayKey | null>(() =>
    activeCompanyId ? null : 'company-select',
  );

  // ── Global state (not workspace-scoped) ──────────────────────────────
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(loadProviderConfig);
  const [focusOutputsToken, setFocusOutputsToken] = useState(0);
  const [chatOpenToken, setChatOpenToken] = useState(0);
  const [lastUserRequest, setLastUserRequest] = useState<string | null>(null);
  const [companyWizardMode, setCompanyWizardMode] = useState<'create-new' | null>(null);
  const [portalPreviewCompanyId, setPortalPreviewCompanyId] = useState<string | null>(
    activeCompanyId,
  );
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);

  // ── Workspace IA: unified session state + back navigation ────────────
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

  // ── Derived convenience ──────────────────────────────────────────────
  const handleOpenSettings = useCallback(() => {
    setActiveWorkspace('settings');
  }, [setActiveWorkspace]);
  const handleBackToOffice = useCallback(() => {
    setActiveWorkspace('office');
  }, [setActiveWorkspace]);

  const { reinitRuntime, repos, eventBus, unfinishedThreads, dismissUnfinishedThreads, resumeThread } =
    useOffisimRuntime();
  const companyEditor = useCompanyEditor();
  const employeeEditor = useEmployeeEditor();
  const installFlow = useInstallFlow();
  const { toasts, addToast, dismissToast } = useToasts();
  useAppRuntimeToasts({
    eventBus,
    addToast,
    onOpenTasks: () => setFocusOutputsToken((token) => token + 1),
  });

  const { toasts: guidanceToasts, dismissToast: dismissGuidanceToast } = useFirstRunGuidance();
  const agents = useAgentStates();
  const { projects, activeProject, activeProjectId, setActiveProjectId, createProject } =
    useProjects({ repos, companyId: activeCompanyId ?? '' });

  const activeCompanyName = useMemo(
    () => companies.find((c) => c.company_id === activeCompanyId)?.name,
    [companies, activeCompanyId],
  );
  const selectedEmployeeName = officeState.selectedEmployeeId
    ? (agents.get(officeState.selectedEmployeeId)?.name ?? null)
    : null;

  // ── Office-specific callbacks ────────────────────────────────────────
  const updateOfficeState = useCallback(
    (updater: (prev: typeof officeState) => typeof officeState) => {
      updateWorkspaceState('office', updater);
    },
    [updateWorkspaceState],
  );
  const onViewModeChange = useCallback(
    (mode: '2D' | '3D') => updateWorkspaceState('office', (prev) => ({ ...prev, viewMode: mode })),
    [updateWorkspaceState],
  );
  const onSceneFallbackTo2D = useCallback(
    () => updateWorkspaceState('office', (prev) => ({ ...prev, viewMode: '2D' })),
    [updateWorkspaceState],
  );
  const handleToggleDashboard = useCallback(
    () =>
      updateWorkspaceState('office', (prev) => ({
        ...prev,
        dashboardOpen: !prev.dashboardOpen,
      })),
    [updateWorkspaceState],
  );
  const handleToggleKanban = useCallback(
    () =>
      updateWorkspaceState('office', (prev) => ({
        ...prev,
        kanbanOpen: !prev.kanbanOpen,
      })),
    [updateWorkspaceState],
  );
  const onLayoutMetricsChange = useCallback(
    (metrics: { leftPanelWidth: number; rightPanelWidth: number }) => {
      updateOfficeState((prev) => {
        if (
          prev.leftPanelWidth === metrics.leftPanelWidth &&
          prev.rightPanelWidth === metrics.rightPanelWidth
        ) {
          return prev;
        }
        return {
          ...prev,
          leftPanelWidth: metrics.leftPanelWidth,
          rightPanelWidth: metrics.rightPanelWidth,
        };
      });
    },
    [updateOfficeState],
  );

  // ── Company switch → reset overlay ───────────────────────────────────
  useEffect(() => {
    if (activeCompanyId) {
      setActiveOverlay(null);
    } else {
      setActiveOverlay('company-select');
    }
  }, [activeCompanyId]);

  useEffect(() => {
    if (!activeCompanyId || !repos) {
      setActiveTemplateId(null);
      return;
    }
    let cancelled = false;
    void repos.companies.findById(activeCompanyId).then((company) => {
      if (cancelled) return;
      if (!company) {
        onCompanySwitch(null);
        return;
      }
      setActiveTemplateId(company.template_id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, repos, onCompanySwitch]);

  useEffect(() => {
    if (!portalPreviewCompanyId && activeCompanyId) {
      setPortalPreviewCompanyId(activeCompanyId);
    }
  }, [activeCompanyId, portalPreviewCompanyId]);

  useEffect(() => {
    if (!activeCompanyId) return;
    const pendingView = sessionStorage.getItem(PENDING_VIEW_KEY);
    if (pendingView === 'studio-edit') {
      sessionStorage.removeItem(PENDING_VIEW_KEY);
      updateWorkspaceState('office', (prev) => ({ ...prev, studioMode: 'edit' as const }));
      setActiveOverlay('studio');
    }
  }, [activeCompanyId, updateWorkspaceState]);

  useEffect(() => {
    primeEventLogStore(eventBus);
    return () => {
      disposeEventLogStore(eventBus);
    };
  }, [eventBus]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        if (!isOffice) return;
        e.preventDefault();
        handleToggleDashboard();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        if (!isOffice) return;
        e.preventDefault();
        handleToggleKanban();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '1') {
        if (!isOffice) return;
        e.preventDefault();
        updateWorkspaceState('office', (prev) => ({
          ...prev,
          viewMode: prev.viewMode === '3D' ? '2D' : '3D',
        }));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        if (!isOffice) return;
        if (!officeState.selectedEmployeeId) return;
        e.preventDefault();
        void employeeEditor.openForEdit(officeState.selectedEmployeeId);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === '/' || e.key === '?')) {
        e.preventDefault();
        setShortcutHelpOpen(true);
        return;
      }
      if (e.key === 'Escape') {
        if (shortcutHelpOpen) {
          setShortcutHelpOpen(false);
          return;
        }
        if (employeeEditor.isOpen) {
          employeeEditor.close();
          return;
        }
        if (activeOverlay) {
          setActiveOverlay(null);
          return;
        }
        goBack();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeOverlay,
    isOffice,
    employeeEditor,
    goBack,
    handleToggleDashboard,
    handleToggleKanban,
    officeState.selectedEmployeeId,
    shortcutHelpOpen,
    updateWorkspaceState,
  ]);

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

  const handleSelectEmployee = useCallback(
    (id: string | null) => {
      updateWorkspaceState('office', (prev) => ({ ...prev, selectedEmployeeId: id }));
      if (id) {
        markAccount('first_employee_clicked');
      }
    },
    [updateWorkspaceState],
  );

  const handleUserMessage = useCallback(
    (text: string) => {
      setLastUserRequest(text);
      if (activeCompanyId) {
        markCompany(activeCompanyId, 'first_task_sent');
      }
    },
    [activeCompanyId],
  );

  const activeCompanyOnboarding = useCompanyOnboardingState(activeCompanyId);
  const onboardingCopy = useMemo(() => getOnboardingCopy(activeTemplateId), [activeTemplateId]);
  const chatOnboardingWelcome = activeCompanyOnboarding.first_task_sent
    ? undefined
    : onboardingCopy.welcome;
  const chatOnboardingStarters = onboardingCopy.starterPrompts;

  const anyOverlayOpen =
    officeState.dashboardOpen ||
    officeState.kanbanOpen ||
    officeState.marketplaceListingId !== null ||
    employeeEditor.isOpen ||
    installFlow.isOpen ||
    companyEditor.isOpen ||
    shortcutHelpOpen ||
    companyWizardMode !== null;

  const handleOpenStudio = useCallback(() => {
    if (!isOffice) return;
    updateWorkspaceState('office', (prev) => ({ ...prev, studioMode: 'edit' as const }));
    setActiveOverlay('studio');
  }, [isOffice, updateWorkspaceState]);

  const handleCreatorDeploy = useCallback(
    async ({ name, role, seed }: { name: string; role: RoleSlug; seed: string }) => {
      if (!repos?.employees || !activeCompanyId) {
        addToast('Runtime not ready — please wait a moment', 'error');
        return;
      }
      try {
        addToast(`Deploying ${name} (${role})…`, 'info');
        const result = await repos.employees.create({
          company_id: activeCompanyId,
          name,
          role_slug: role,
          source_asset_id: null,
          source_package_id: null,
          persona_json: JSON.stringify({
            expertise: '',
            style: '',
            customInstructions: '',
            avatarSeed: seed,
          }),
          config_json: JSON.stringify({ modelPreference: '', temperature: 0.7, maxTokens: 4096 }),
        });
        eventBus.emit(employeeCreated(activeCompanyId, result.employee_id, name, role));
        addToast(`${name} deployed successfully`, 'success');
        setActiveOverlay(null);
      } catch (err) {
        console.error('[App] Failed to create employee:', err);
        addToast(`Failed to deploy ${name}`, 'error');
      }
    },
    [repos, eventBus, addToast, activeCompanyId],
  );

  const handleArchiveCompany = useCallback(
    async (companyId: string) => {
      if (!repos) return;
      try {
        await repos.companies.update(companyId, { status: 'archived' });
        await refreshCompanies();
        addToast('Company archived', 'success');
      } catch (err) {
        addToast(err instanceof Error ? err.message : 'Failed to archive company', 'error');
        return;
      }
      setPortalPreviewCompanyId((prev) => {
        if (prev !== companyId) return prev;
        const next = companies.find((c) => c.company_id !== companyId && c.status !== 'archived');
        return next?.company_id ?? null;
      });
      if (activeCompanyId === companyId) {
        onCompanySwitch(null);
      }
    },
    [repos, refreshCompanies, addToast, companies, activeCompanyId, onCompanySwitch],
  );

  function handleSaveConfig(config: ProviderConfig) {
    setProviderConfig(config);
    reinitRuntime();
  }

  function handleWizardComplete(newCompanyId?: string) {
    refreshCompanies();
    if (newCompanyId) {
      setPortalPreviewCompanyId(newCompanyId);
      setCompanyWizardMode(null);
      switchCompany(newCompanyId);
      onCompanySwitch(newCompanyId);
      setActiveOverlay(null);
    }
    if (!providerConfig && !companyWizardMode && activeCompanyId) {
      handleOpenSettings();
    }
  }

  function handleSelectCompany(id: string) {
    switchCompany(id);
    onCompanySwitch(id);
    setActiveOverlay(null);
  }

  function handleCreateYourOwn(newCompanyId: string) {
    refreshCompanies();
    setPortalPreviewCompanyId(newCompanyId);
    sessionStorage.setItem(PENDING_VIEW_KEY, 'studio-edit');
    switchCompany(newCompanyId);
    onCompanySwitch(newCompanyId);
    setCompanyWizardMode(null);
  }

  function handleStudioCompanyCreated(newId: string) {
    switchCompany(newId);
    onCompanySwitch(newId);
    refreshCompanies();
    setPortalPreviewCompanyId(newId);
    setActiveOverlay(null);
  }

  const collaborationRailProps = useMemo(
    () => ({
      activeProject,
      chatOnboardingStarterPrompts: chatOnboardingStarters,
      chatOnboardingWelcome,
      chatOpenToken,
      focusOutputsToken,
      onOpenOfficeEditor: () => setActiveOverlay('office-editor' as const),
      onOpenSettings: handleOpenSettings,
      onOpenStudio: handleOpenStudio,
      onSelectEmployee: handleSelectEmployee,
      onToggleDashboard: handleToggleDashboard,
      onToggleKanban: handleToggleKanban,
      onUserMessage: handleUserMessage,
      selectedEmployeeId: officeState.selectedEmployeeId,
      selectedEmployeeName,
    }),
    [
      activeProject,
      chatOnboardingStarters,
      chatOnboardingWelcome,
      chatOpenToken,
      focusOutputsToken,
      handleOpenSettings,
      handleOpenStudio,
      handleSelectEmployee,
      handleToggleDashboard,
      handleToggleKanban,
      handleUserMessage,
      officeState.selectedEmployeeId,
      selectedEmployeeName,
    ],
  );

  const showLayout = activeOverlay === null || activeOverlay === 'employee-creator';

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

        {activeOverlay === 'employee-creator' && (
          <div className="fixed inset-0 z-[70]">
            <Suspense fallback={null}>
              <EmployeeCreatorOverlay
                open
                onClose={() => setActiveOverlay(null)}
                onDeploy={handleCreatorDeploy}
              />
            </Suspense>
          </div>
        )}

        {activeOverlay === 'office-editor' && (
          <Suspense fallback={null}>
            <OfficeEditorOverlay open onClose={() => setActiveOverlay(null)} />
          </Suspense>
        )}

        {activeOverlay === 'company-select' && (
          <CompanySelectionPage
            previewCompanyId={portalPreviewCompanyId}
            onPreviewCompany={setPortalPreviewCompanyId}
            onEnterCompany={handleSelectCompany}
            onCreateNew={() => {
              setCompanyWizardMode('create-new');
            }}
            onArchiveCompany={handleArchiveCompany}
          />
        )}

        {activeOverlay === 'studio' && (
          <Suspense fallback={null}>
            {officeState.studioMode === 'create' ? (
              <StudioPage
                mode="create"
                repos={repos}
                onBack={() => setActiveOverlay(null)}
                onCompanyCreated={handleStudioCompanyCreated}
              />
            ) : activeCompanyId ? (
              <StudioPage
                mode="edit"
                companyId={activeCompanyId}
                repos={repos}
                onBack={() => setActiveOverlay(null)}
                onCompanyCreated={handleStudioCompanyCreated}
              />
            ) : null}
          </Suspense>
        )}

        {showLayout && (
          <AppLayout
            header={
              <Header
                providerName={providerConfig?.model}
                companyName={activeCompanyName}
                onOpenSettings={handleOpenSettings}
                onOpenOffice={handleBackToOffice}
                onOpenSops={() => setActiveWorkspace('sops')}
                onOpenMarket={() => setActiveWorkspace('market')}
                onOpenStudio={handleOpenStudio}
                onOpenCompanySelect={() => setActiveOverlay('company-select')}
                onOpenCompanyEditor={companyEditor.open}
                onFileImport={(file) => installFlow.startFileImport(file)}
                notificationSlot={
                  <NotificationCenter
                    onFocusEmployee={(employeeId) => {
                      handleSelectEmployee(employeeId);
                      setChatOpenToken((token) => token + 1);
                    }}
                    onOpenActivityLog={() => setActiveWorkspace('activity-log')}
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
                  onSelectEmployee={handleSelectEmployee}
                  selectedEmployeeId={officeState.selectedEmployeeId}
                  onOpenCreator={() => setActiveOverlay('employee-creator')}
                />
              ) : null
            }
            sceneCanvas={
              isOffice ? (
                <Suspense
                  fallback={<div className="h-full w-full animate-pulse bg-ocean-deep" />}
                >
                  <OfficeSceneSurface
                    leftPanelWidth={officeState.leftPanelWidth}
                    onSceneFallbackTo2D={onSceneFallbackTo2D}
                    onSelectEmployee={handleSelectEmployee}
                    rightPanelWidth={officeState.rightPanelWidth}
                    selectedEmployeeId={officeState.selectedEmployeeId}
                    sceneInteractive={activeOverlay === null}
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
                  settingsPageProps={{
                    onBack: handleBackToOffice,
                    onSave: handleSaveConfig,
                    onSaveSuccess: () => addToast('Provider configuration saved', 'success'),
                    onToast: (message, variant = 'info') => addToast(message, variant),
                  }}
                />
              ) : undefined
            }
            statusBar={
              <StatusBar
                modelName={providerConfig?.model}
                activeProjectStatus={activeProject?.status ?? null}
              />
            }
            chatDrawerMode="mobile-only"
            requestRightExpandToken={chatOpenToken}
            onLayoutMetricsChange={onLayoutMetricsChange}
          />
        )}

        {officeState.dashboardOpen && (
          <Suspense fallback={null}>
            <DashboardOverlay
              open={officeState.dashboardOpen}
              onClose={() => updateOfficeState((prev) => ({ ...prev, dashboardOpen: false }))}
              activeThreadId={activeProject?.thread_id ?? null}
            />
          </Suspense>
        )}

        {officeState.kanbanOpen && (
          <Suspense fallback={null}>
            <KanbanOverlay
              open={officeState.kanbanOpen}
              onClose={() => updateOfficeState((prev) => ({ ...prev, kanbanOpen: false }))}
              requestText={lastUserRequest ?? undefined}
            />
          </Suspense>
        )}

        {officeState.marketplaceListingId && (
          <Suspense fallback={null}>
            <MarketplaceOverlay
              listingId={officeState.marketplaceListingId}
              onClose={() => updateOfficeState((prev) => ({ ...prev, marketplaceListingId: null }))}
              onInstall={(listingId, version) => {
                updateWorkspaceState('office', (prev) => ({
                  ...prev,
                  marketplaceListingId: null,
                }));
                installFlow.startRegistryInstall(listingId, version);
              }}
            />
          </Suspense>
        )}

        <EmployeeInspector
          employeeId={officeState.selectedEmployeeId}
          companyId={activeCompanyId ?? ''}
          agents={agents}
          leftOffset={officeState.leftPanelWidth}
          onClose={() => handleSelectEmployee(null)}
          onOpenEditor={(id) => void employeeEditor.openForEdit(id)}
          onStartChat={(id) => {
            handleSelectEmployee(id);
            setChatOpenToken((token) => token + 1);
          }}
        />

        <OnboardingController
          activeCompanyId={activeCompanyId}
          isOfficeView={isOffice && activeOverlay === null}
          anyOverlayOpen={anyOverlayOpen}
          directChatActive={officeState.selectedEmployeeId !== null}
        />

        {/* ── Global dialogs (available across all views) ── */}
        <Suspense fallback={null}>
          <InstallDialog {...installFlow} />
        </Suspense>
        <EmployeeEditorDialog {...employeeEditor} />
        <Suspense fallback={null}>
          <CompanyEditor
            {...companyEditor}
            onOpenOfficeEditor={() => setActiveOverlay('office-editor')}
          />
        </Suspense>
        <KeyboardShortcutsDialog open={shortcutHelpOpen} onOpenChange={setShortcutHelpOpen} />
        {isOffice && activeOverlay === null && (
          <Suspense fallback={null}>
            <CompanyCreationWizard
              mode="populate-existing"
              companyId={activeCompanyId}
              onComplete={handleWizardComplete}
              onCreateYourOwn={handleCreateYourOwn}
            />
          </Suspense>
        )}
        {companyWizardMode === 'create-new' && (
          <Suspense fallback={null}>
            <CompanyCreationWizard
              mode="create-new"
              onComplete={handleWizardComplete}
              onCreateYourOwn={handleCreateYourOwn}
              onDismiss={() => setCompanyWizardMode(null)}
            />
          </Suspense>
        )}
      </>
    </ErrorBoundary>
  );
}
