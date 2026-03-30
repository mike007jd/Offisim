import { employeeCreated } from '@offisim/core/browser';
import type { DeliverableCreatedPayload, RuntimeEvent } from '@offisim/shared-types';
import { ToastBanner, useToasts } from '@offisim/ui-core';
import {
  AgentPanel,
  AppLayout,
  ChatDrawer,
  ChatPanel,
  CompanySelectionPage,
  EmployeeInspector,
  ErrorBoundary,
  Header,
  NotificationCenter,
  ProjectListPanel,
  ProjectSelector,
  type ProviderConfig,
  ResumeBar,
  RightSidebar,
  StatusBar,
  loadProviderConfig,
  primeEventLogStore,
  useAgentStates,
  useOffisimRuntime,
  useCompany,
  useCompanyEditor,
  useDeepLinkInstall,
  useInstallFlow,
  useProjects,
  useReducedMotion,
} from '@offisim/ui-office';
import React, { Suspense, useCallback, useEffect, useState } from 'react';
import {
  isOfficeSceneInteractive,
  shouldKeepOfficeMounted,
  shouldShowEmployeeCreatorOverlay,
  type AppView,
} from './lib/app-view-layout';

const PENDING_VIEW_KEY = 'offisim:pending-view';

interface SceneCanvasLazyProps {
  active?: boolean;
  reducedMotion?: boolean;
  viewMode?: '2D' | '3D';
  selectedEmployeeId?: string | null;
  onSelectEmployee?: (id: string | null) => void;
  onDeselectEmployee?: () => void;
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
  import('@offisim/ui-office/employee-creator').then((m) => ({ default: m.EmployeeCreatorOverlay })),
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
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(loadProviderConfig);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [focusOutputsToken, setFocusOutputsToken] = useState(0);
  const [chatOpenToken, setChatOpenToken] = useState(0);
  const [studioMode, setStudioMode] = useState<'create' | 'edit'>('create');
  const [projectListOpen, setProjectListOpen] = useState(false);
  const [lastUserRequest, setLastUserRequest] = useState<string | null>(null);
  const [companyWizardMode, setCompanyWizardMode] = useState<'create-new' | null>(null);
  const [portalPreviewCompanyId, setPortalPreviewCompanyId] = useState<string | null>(activeCompanyId);
  const {
    reinitRuntime,
    repos,
    eventBus,
    unfinishedThreads,
    dismissUnfinishedThreads,
    resumeThread,
  } = useOffisimRuntime();
  const activeCompanyName = companies.find((c) => c.company_id === activeCompanyId)?.name;
  const { projects, activeProject, activeProjectId, setActiveProjectId } = useProjects({
    repos,
    companyId: activeCompanyId ?? '',
  });
  const reducedMotion = useReducedMotion();
  const companyEditor = useCompanyEditor();
  const installFlow = useInstallFlow();
  const agents = useAgentStates();
  const { toasts, addToast, dismissToast } = useToasts();

  useEffect(() => {
    setView(activeCompanyId ? 'office' : 'company-select');
  }, [activeCompanyId]);

  useEffect(() => {
    if (!activeCompanyId || !repos) return;
    let cancelled = false;
    void repos.companies.findById(activeCompanyId).then((company) => {
      if (!cancelled && !company) {
        onCompanySwitch(null);
      }
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
  }, [eventBus]);

  // Keyboard shortcut: Cmd+D / Ctrl+D toggles Boss Dashboard overlay
  // Keyboard shortcut: Cmd+J / Ctrl+J toggles Kanban Board overlay
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        setDashboardOpen((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        setKanbanOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Subscribe to deliverable.created — show a prominent "Output ready" toast with a View action
  useEffect(() => {
    return eventBus.on('deliverable.created', (e: RuntimeEvent<DeliverableCreatedPayload>) => {
      const title = e.payload.title || 'Output';
      addToast(`Output ready: ${title}`, 'success', {
        actionLabel: 'View',
        onAction: () => setFocusOutputsToken((t) => t + 1),
        durationMs: 8_000,
      });
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

  const handleCreatorDeploy = useCallback(
    async ({ name, role, seed }: { name: string; role: string; seed: string }) => {
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
      setPortalPreviewCompanyId(newCompanyId);
      setCompanyWizardMode(null);
      setView('company-select');
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
            <StudioPage
              mode={studioMode}
              companyId={activeCompanyId ?? undefined}
              repos={repos}
              onBack={() => setView('office')}
              onCompanyCreated={handleStudioCompanyCreated}
            />
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
            <AppLayout
              header={
                <Header
                  providerName={providerConfig?.model}
                  companyName={activeCompanyName}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onOpenEmployeeCreator={() => setView('employee-creator')}
                  onOpenStudio={() => {
                    setStudioMode('edit');
                    setView('studio');
                  }}
                  onOpenCompanySelect={() => setView('company-select')}
                  onFileImport={installFlow.startFileImport}
                  notificationSlot={<NotificationCenter />}
                  projectSlot={
                    <div className="relative">
                      <ProjectSelector
                        projects={projects}
                        activeProjectId={activeProjectId}
                        onSelect={setActiveProjectId}
                      />
                      {projectListOpen && (
                        <div className="absolute top-full mt-1 left-0 z-50">
                          <ProjectListPanel
                            projects={projects}
                            activeProjectId={activeProjectId}
                            onSelect={setActiveProjectId}
                            onClose={() => setProjectListOpen(false)}
                          />
                        </div>
                      )}
                    </div>
                  }
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  needsConfig={!providerConfig}
                />
              }
              agentPanel={
                <AgentPanel
                  agents={agents}
                  onSelectEmployee={(id) => {
                    setSelectedEmployeeId(id);
                    setChatOpenToken((t) => t + 1);
                  }}
                  selectedEmployeeId={selectedEmployeeId}
                  onOpenCreator={() => setView('employee-creator')}
                />
              }
              sceneCanvas={
                <Suspense fallback={<div className="h-full w-full bg-ocean-deep animate-pulse" />}>
                  <SceneCanvas
                    active={isOfficeSceneInteractive(view)}
                    reducedMotion={reducedMotion}
                    viewMode={viewMode}
                    selectedEmployeeId={selectedEmployeeId}
                    onSelectEmployee={setSelectedEmployeeId}
                    onDeselectEmployee={() => setSelectedEmployeeId(null)}
                  />
                </Suspense>
              }
              chatDrawer={
                <ChatDrawer requestOpen={chatOpenToken}>
                  <ChatPanel
                    onOpenSettings={() => setSettingsOpen(true)}
                    selectedEmployeeId={selectedEmployeeId}
                    selectedEmployeeName={selectedEmployeeName}
                    onClearSelection={() => setSelectedEmployeeId(null)}
                    onSelectEmployee={setSelectedEmployeeId}
                    onShowDashboard={() => setDashboardOpen(true)}
                    onShowBudget={() => setDashboardOpen(true)}
                    activeProject={activeProject}
                    onUserMessage={setLastUserRequest}
                  />
                </ChatDrawer>
              }
              eventLog={
                <RightSidebar
                  onOpenDashboard={() => setDashboardOpen(true)}
                  onOpenKanban={() => setKanbanOpen(true)}
                  focusOutputsToken={focusOutputsToken}
                />
              }
              statusBar={<StatusBar modelName={providerConfig?.model} />}
            />
            {dashboardOpen && (
              <Suspense fallback={null}>
                <DashboardOverlay open={dashboardOpen} onClose={() => setDashboardOpen(false)} />
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
            <EmployeeInspector
              employeeId={selectedEmployeeId}
              agents={agents}
              onClose={() => setSelectedEmployeeId(null)}
              onOpenEditor={(id) => {
                companyEditor.open();
                console.info('[EmployeeInspector] Open editor for', id);
              }}
              onStartChat={(id) => {
                setSelectedEmployeeId(id);
                setChatOpenToken((t) => t + 1);
              }}
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
        <Suspense fallback={null}>
          <CompanyEditor {...companyEditor} onOpenOfficeEditor={() => setView('office-editor')} />
        </Suspense>
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
