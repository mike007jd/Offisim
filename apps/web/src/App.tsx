import { employeeCreated } from '@offisim/core/browser';
import type { DeliverableCreatedPayload, RoleSlug, RuntimeEvent } from '@offisim/shared-types';
import { ToastBanner, useToasts } from '@offisim/ui-core';
import {
  AgentPanel,
  AppLayout,
  ChatDrawer,
  ChatPanel,
  CompanySelectionPage,
  EmployeeEditorDialog,
  EmployeeInspector,
  ErrorBoundary,
  Header,
  KeyboardShortcutsDialog,
  NotificationCenter,
  ProjectSelector,
  type ProviderConfig,
  ResumeBar,
  RightSidebar,
  SceneCeremonyProvider,
  StatusBar,
  disposeEventLogStore,
  getRejectedProviderName,
  loadProviderConfig,
  primeEventLogStore,
  useAgentStates,
  useCompany,
  useCompanyEditor,
  useCompanyZones,
  useDeepLinkInstall,
  useEmployeeEditor,
  useInstallFlow,
  useOffisimRuntime,
  usePrefabInstances,
  useProjects,
  useReducedMotion,
  useSceneOrchestrator,
} from '@offisim/ui-office';
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { OnboardingController } from './components/OnboardingController';
import {
  type AppView,
  isOfficeSceneInteractive,
  shouldKeepOfficeMounted,
  shouldShowEmployeeCreatorOverlay,
} from './lib/app-view-layout';
import { getOnboardingCopy } from './lib/onboarding-prompts';
import { markAccount, markCompany, useCompanyOnboardingState } from './lib/onboarding-store';

const PENDING_VIEW_KEY = 'offisim:pending-view';

interface SceneCanvasLazyProps {
  active?: boolean;
  reducedMotion?: boolean;
  viewMode?: '2D' | '3D';
  selectedEmployeeId?: string | null;
  onSelectEmployee?: (id: string | null) => void;
  onDeselectEmployee?: () => void;
  onFallbackTo2D?: () => void;
}

function CeremonyHost({ children }: { children: React.ReactNode }) {
  const { eventBus, sceneIntentBus } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const agents = useAgentStates();
  const { zones } = useCompanyZones();
  const { instances: prefabInstancesWithDef } = usePrefabInstances();
  const prefabInstances = useMemo(
    () => prefabInstancesWithDef.map((p) => p.instance),
    [prefabInstancesWithDef],
  );
  const ceremony = useSceneOrchestrator({
    companyId: activeCompanyId ?? 'default-scene-company',
    eventBus,
    sceneIntentBus,
    agents,
    zones,
    prefabInstances,
  });
  return <SceneCeremonyProvider value={ceremony}>{children}</SceneCeremonyProvider>;
}

/** Lazy-loaded SceneCanvas — keeps Three.js + scene rendering out of the initial bundle */
const SceneCanvas = React.lazy<React.ComponentType<SceneCanvasLazyProps>>(() =>
  import('@offisim/ui-office/scene').then((m) => ({
    default: m.SceneCanvas as React.ComponentType<SceneCanvasLazyProps>,
  })),
);

/** Lazy-loaded overlay/dialog components — kept out of the initial bundle */
const CompanyCreationWizard = React.lazy(() =>
  import('@offisim/ui-office/wizard').then((m) => ({ default: m.CompanyCreationWizard })),
);
const DashboardOverlay = React.lazy(() =>
  import('@offisim/ui-office/dashboard').then((m) => ({ default: m.DashboardOverlay })),
);
const EmployeeCreatorOverlay = React.lazy(() =>
  import('@offisim/ui-office/employee-creator').then((m) => ({
    default: m.EmployeeCreatorOverlay,
  })),
);
const OfficeEditorOverlay = React.lazy(() =>
  import('@offisim/ui-office/office-editor').then((m) => ({ default: m.OfficeEditorOverlay })),
);
const SettingsDialog = React.lazy(() =>
  import('@offisim/ui-office/settings').then((m) => ({ default: m.SettingsDialog })),
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
const KanbanOverlay = React.lazy(() =>
  import('@offisim/ui-office/kanban').then((m) => ({ default: m.KanbanOverlay })),
);
const MarketplaceOverlay = React.lazy(() =>
  import('@offisim/ui-office/marketplace').then((m) => ({
    default: m.MarketplaceDetailOverlay,
  })),
);

interface AppProps {
  /** Callback to propagate company switch up to main.tsx (re-keys OffisimRuntimeProvider). */
  onCompanySwitch: (id: string | null) => void;
}

export function App({ onCompanySwitch }: AppProps) {
  const { activeCompanyId, companies, switchCompany, refreshCompanies } = useCompany();
  const [view, setView] = useState<AppView>(() => (activeCompanyId ? 'office' : 'company-select'));
  const [viewMode, setViewMode] = useState<'2D' | '3D'>('3D');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [kanbanOpen, setKanbanOpen] = useState(false);
  const [marketplaceListingId, setMarketplaceListingId] = useState<string | null>(null);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(loadProviderConfig);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(44);
  const [focusOutputsToken, setFocusOutputsToken] = useState(0);
  const [chatOpenToken, setChatOpenToken] = useState(0);
  const [studioMode, setStudioMode] = useState<'create' | 'edit'>('create');
  const [lastUserRequest, setLastUserRequest] = useState<string | null>(null);
  const [companyWizardMode, setCompanyWizardMode] = useState<'create-new' | null>(null);
  const [portalPreviewCompanyId, setPortalPreviewCompanyId] = useState<string | null>(
    activeCompanyId,
  );
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const {
    reinitRuntime,
    repos,
    eventBus,
    unfinishedThreads,
    dismissUnfinishedThreads,
    resumeThread,
  } = useOffisimRuntime();
  const activeCompanyName = companies.find((c) => c.company_id === activeCompanyId)?.name;
  const { projects, activeProject, activeProjectId, setActiveProjectId, createProject } =
    useProjects({
      repos,
      companyId: activeCompanyId ?? '',
    });
  const reducedMotion = useReducedMotion();
  const companyEditor = useCompanyEditor();
  const employeeEditor = useEmployeeEditor();
  const installFlow = useInstallFlow();
  const agents = useAgentStates();
  const { toasts, addToast, dismissToast } = useToasts();

  // Warn once on mount if saved provider config was rejected by production policy
  useEffect(() => {
    const rejected = getRejectedProviderName();
    if (rejected) {
      addToast(
        `Provider "${rejected}" is not allowed in production. AI features are disabled. Switch to Subscription in Settings.`,
        'error',
        { durationMs: 10_000 },
      );
    }
  }, [addToast]);

  useEffect(() => {
    setView(activeCompanyId ? 'office' : 'company-select');
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
      setStudioMode('edit');
      setView('studio');
    }
  }, [activeCompanyId]);

  useEffect(() => {
    primeEventLogStore(eventBus);
    return () => {
      disposeEventLogStore(eventBus);
    };
  }, [eventBus]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setDashboardOpen((prev) => !prev);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setKanbanOpen((prev) => !prev);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '1') {
        e.preventDefault();
        setViewMode((prev) => (prev === '3D' ? '2D' : '3D'));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        if (!selectedEmployeeId) return;
        e.preventDefault();
        void employeeEditor.openForEdit(selectedEmployeeId);
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
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        if (dashboardOpen) {
          setDashboardOpen(false);
          return;
        }
        if (kanbanOpen) {
          setKanbanOpen(false);
          return;
        }
        if (marketplaceListingId) {
          setMarketplaceListingId(null);
          return;
        }
        if (employeeEditor.isOpen) {
          employeeEditor.close();
          return;
        }
        if (selectedEmployeeId) {
          setSelectedEmployeeId(null);
          return;
        }
        if (view === 'employee-creator' || view === 'office-editor' || view === 'studio') {
          setView('office');
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    dashboardOpen,
    employeeEditor,
    kanbanOpen,
    marketplaceListingId,
    selectedEmployeeId,
    settingsOpen,
    shortcutHelpOpen,
    view,
  ]);

  useEffect(() => {
    if (providerConfig) {
      markAccount('provider_configured');
    }
  }, [providerConfig]);

  // Subscribe to deliverable.created — show toast with View or SOP action.
  useEffect(() => {
    return eventBus.on('deliverable.created', (e: RuntimeEvent<DeliverableCreatedPayload>) => {
      const title = e.payload.title || 'Output';
      const isMultiStep = e.payload.contributingEmployees.length >= 2;
      addToast(`Output ready: ${title}`, 'success', {
        actionLabel: isMultiStep ? 'Save as SOP' : 'View',
        onAction: () => setFocusOutputsToken((t) => t + 1),
        durationMs: isMultiStep ? 12_000 : 8_000,
      });
      if (e.companyId) {
        markCompany(e.companyId, 'first_deliverable_seen');
      }
    });
  }, [eventBus, addToast]);

  // Deep link install handler — receives offisim://install?listing_id=X&version=Y from Tauri shell
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

  // Resolve selected employee name for ChatPanel header
  const selectedEmployeeName = selectedEmployeeId
    ? (agents.get(selectedEmployeeId)?.name ?? null)
    : null;

  const handleSelectEmployee = useCallback((id: string | null) => {
    setSelectedEmployeeId(id);
    if (id) {
      markAccount('first_employee_clicked');
    }
  }, []);

  const handleUserMessage = useCallback(
    (text: string) => {
      setLastUserRequest(text);
      if (activeCompanyId) {
        markCompany(activeCompanyId, 'first_task_sent');
      }
    },
    [activeCompanyId],
  );

  // Welcome card only renders on the very first task of a given company.
  const activeCompanyOnboarding = useCompanyOnboardingState(activeCompanyId);
  const onboardingCopy = useMemo(() => getOnboardingCopy(activeTemplateId), [activeTemplateId]);
  const chatOnboardingWelcome = activeCompanyOnboarding.first_task_sent
    ? undefined
    : onboardingCopy.welcome;
  const chatOnboardingStarters = onboardingCopy.starterPrompts;

  const anyOverlayOpen =
    settingsOpen ||
    dashboardOpen ||
    kanbanOpen ||
    marketplaceListingId !== null ||
    employeeEditor.isOpen ||
    installFlow.isOpen ||
    companyEditor.isOpen ||
    shortcutHelpOpen ||
    companyWizardMode !== null;

  const handleLayoutMetricsChange = useCallback(
    ({ leftPanelWidth: w }: { leftPanelWidth: number }) => {
      setLeftPanelWidth(w);
    },
    [],
  );

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
        setView('office');
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
      // Auto-enter the newly created company instead of returning to the portal.
      // Previous behavior (setView('company-select')) forced users to pick their
      // brand-new company from a list, breaking onboarding flow continuity.
      setPortalPreviewCompanyId(newCompanyId);
      setCompanyWizardMode(null);
      switchCompany(newCompanyId);
      onCompanySwitch(newCompanyId);
      setView('office');
    }
    if (!providerConfig && !companyWizardMode && activeCompanyId) {
      setSettingsOpen(true);
    }
  }

  /** Navigate to company selection, selecting a company triggers runtime switch. */
  function handleSelectCompany(id: string) {
    switchCompany(id);
    onCompanySwitch(id);
    setView('office');
  }

  /** Handle "Create Your Own" from wizard — opens Studio in create mode. */
  function handleCreateYourOwn(newCompanyId: string) {
    refreshCompanies();
    setPortalPreviewCompanyId(newCompanyId);
    sessionStorage.setItem(PENDING_VIEW_KEY, 'studio-edit');
    switchCompany(newCompanyId);
    onCompanySwitch(newCompanyId);
    setCompanyWizardMode(null);
  }

  /** Handle Studio save — switch to the new/edited company and return to office. */
  function handleStudioCompanyCreated(newId: string) {
    switchCompany(newId);
    onCompanySwitch(newId);
    refreshCompanies();
    setPortalPreviewCompanyId(newId);
    setView('office');
  }

  return (
    <ErrorBoundary>
      <>
        <ToastBanner toasts={toasts} onDismiss={dismissToast} />

        {shouldShowEmployeeCreatorOverlay(view) && (
          <div className="fixed inset-0 z-[70]">
            <Suspense fallback={null}>
              <EmployeeCreatorOverlay
                open
                onClose={() => setView('office')}
                onDeploy={handleCreatorDeploy}
              />
            </Suspense>
          </div>
        )}

        {/* ── Full-page views ── */}
        {view === 'office-editor' && (
          <Suspense fallback={null}>
            <OfficeEditorOverlay open onClose={() => setView('office')} />
          </Suspense>
        )}

        {view === 'company-select' && (
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

        {view === 'studio' && (
          <Suspense fallback={null}>
            {studioMode === 'create' ? (
              <StudioPage
                mode="create"
                repos={repos}
                onBack={() => setView('office')}
                onCompanyCreated={handleStudioCompanyCreated}
              />
            ) : activeCompanyId ? (
              <StudioPage
                mode="edit"
                companyId={activeCompanyId}
                repos={repos}
                onBack={() => setView('office')}
                onCompanyCreated={handleStudioCompanyCreated}
              />
            ) : null}
          </Suspense>
        )}

        {/* ── Office view (default) ── */}
        {shouldKeepOfficeMounted(view) && (
          <>
            {unfinishedThreads.length > 0 && (
              <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4">
                <ResumeBar
                  projects={unfinishedThreads}
                  onResume={(threadId: string) => void resumeThread(threadId)}
                  onDismiss={dismissUnfinishedThreads}
                />
              </div>
            )}
            <CeremonyHost>
              <AppLayout
                header={
                  <Header
                    providerName={providerConfig?.model}
                    companyName={activeCompanyName}
                    onOpenSettings={() => setSettingsOpen(true)}
                    onOpenLayoutEditor={() => setView('office-editor')}
                    onOpenStudio={() => {
                      setStudioMode('edit');
                      setView('studio');
                    }}
                    onOpenCompanySelect={() => setView('company-select')}
                    onOpenCompanyEditor={companyEditor.open}
                    onFileImport={installFlow.startFileImport}
                    notificationSlot={
                      <NotificationCenter
                        onFocusEmployee={(employeeId) => {
                          handleSelectEmployee(employeeId);
                          setChatOpenToken((t) => t + 1);
                        }}
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
                    onViewModeChange={setViewMode}
                    needsConfig={!providerConfig}
                  />
                }
                agentPanel={
                  <AgentPanel
                    agents={agents}
                    onSelectEmployee={handleSelectEmployee}
                    selectedEmployeeId={selectedEmployeeId}
                    onOpenCreator={() => setView('employee-creator')}
                  />
                }
                sceneCanvas={
                  <div className="h-full w-full" data-onboarding-target="scene-surface">
                    <Suspense
                      fallback={<div className="h-full w-full bg-ocean-deep animate-pulse" />}
                    >
                      <SceneCanvas
                        active={isOfficeSceneInteractive(view)}
                        reducedMotion={reducedMotion}
                        viewMode={viewMode}
                        selectedEmployeeId={selectedEmployeeId}
                        onSelectEmployee={handleSelectEmployee}
                        onDeselectEmployee={() => setSelectedEmployeeId(null)}
                        onFallbackTo2D={() => {
                          setViewMode('2D');
                          addToast('3D rendering failed — switched to 2D view', 'error');
                        }}
                      />
                    </Suspense>
                  </div>
                }
                chatDrawer={
                  <ChatDrawer requestOpen={chatOpenToken}>
                    {({ compact }) => (
                      <ChatPanel
                        compact={compact}
                        onOpenSettings={() => setSettingsOpen(true)}
                        selectedEmployeeId={selectedEmployeeId}
                        selectedEmployeeName={selectedEmployeeName}
                        onClearSelection={() => setSelectedEmployeeId(null)}
                        onToggleDashboard={() => setDashboardOpen((prev) => !prev)}
                        onToggleKanban={() => setKanbanOpen((prev) => !prev)}
                        onOpenEditor={() => setView('office-editor')}
                        onOpenStudio={() => {
                          setStudioMode('edit');
                          setView('studio');
                        }}
                        activeProject={activeProject}
                        onUserMessage={handleUserMessage}
                        onboardingWelcome={chatOnboardingWelcome}
                        onboardingStarterPrompts={chatOnboardingStarters}
                      />
                    )}
                  </ChatDrawer>
                }
                eventLog={
                  <RightSidebar
                    onOpenDashboard={() => setDashboardOpen(true)}
                    onOpenKanban={() => setKanbanOpen(true)}
                    focusOutputsToken={focusOutputsToken}
                    activeThreadId={activeProject?.thread_id ?? null}
                    onOpenMarketplaceListing={setMarketplaceListingId}
                    onStartMarketplaceInstall={(listingId, version) =>
                      installFlow.startRegistryInstall(listingId, version)
                    }
                  />
                }
                statusBar={
                  <StatusBar
                    modelName={providerConfig?.model}
                    activeProjectStatus={activeProject?.status ?? null}
                  />
                }
                onLayoutMetricsChange={handleLayoutMetricsChange}
              />
            </CeremonyHost>
            {dashboardOpen && (
              <Suspense fallback={null}>
                <DashboardOverlay
                  open={dashboardOpen}
                  onClose={() => setDashboardOpen(false)}
                  activeThreadId={activeProject?.thread_id ?? null}
                />
              </Suspense>
            )}
            {kanbanOpen && (
              <Suspense fallback={null}>
                <KanbanOverlay
                  open={kanbanOpen}
                  onClose={() => setKanbanOpen(false)}
                  requestText={lastUserRequest ?? undefined}
                />
              </Suspense>
            )}
            {marketplaceListingId && (
              <Suspense fallback={null}>
                <MarketplaceOverlay
                  listingId={marketplaceListingId}
                  onClose={() => setMarketplaceListingId(null)}
                  onInstall={(listingId, version) => {
                    setMarketplaceListingId(null);
                    installFlow.startRegistryInstall(listingId, version);
                  }}
                />
              </Suspense>
            )}
            <EmployeeInspector
              employeeId={selectedEmployeeId}
              agents={agents}
              leftOffset={leftPanelWidth}
              onClose={() => setSelectedEmployeeId(null)}
              onOpenEditor={(id) => {
                void employeeEditor.openForEdit(id);
              }}
              onStartChat={(id) => {
                handleSelectEmployee(id);
                setChatOpenToken((t) => t + 1);
              }}
            />
            <OnboardingController
              activeCompanyId={activeCompanyId}
              isOfficeView={view === 'office'}
              anyOverlayOpen={anyOverlayOpen}
              directChatActive={selectedEmployeeId !== null}
            />
          </>
        )}

        {/* ── Global dialogs (available across all views) ── */}
        <Suspense fallback={null}>
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            onSave={handleSaveConfig}
            onSaveSuccess={() => addToast('Provider configuration saved', 'success')}
          />
        </Suspense>
        <Suspense fallback={null}>
          <InstallDialog {...installFlow} />
        </Suspense>
        <EmployeeEditorDialog {...employeeEditor} />
        <Suspense fallback={null}>
          <CompanyEditor {...companyEditor} onOpenOfficeEditor={() => setView('office-editor')} />
        </Suspense>
        <KeyboardShortcutsDialog open={shortcutHelpOpen} onOpenChange={setShortcutHelpOpen} />
        {view === 'office' && (
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
            />
          </Suspense>
        )}
      </>
    </ErrorBoundary>
  );
}
