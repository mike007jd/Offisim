import { employeeCreated } from '@aics/core/browser';
import { ToastBanner, useToasts } from '@aics/ui-core';
import {
  AgentPanel,
  AppLayout,
  ChatDrawer,
  ChatPanel,
  EmployeeInspector,
  ErrorBoundary,
  Header,
  NotificationCenter,
  type ProviderConfig,
  RightSidebar,
  StatusBar,
  loadProviderConfig,
  useAgentStates,
  useAicsRuntime,
  useCompany,
  useCompanyEditor,
  useDeepLinkInstall,
  useInstallFlow,
  useReducedMotion,
} from '@aics/ui-office';
import type { DeliverableCreatedPayload, RuntimeEvent } from '@aics/shared-types';
import React, { Suspense, useCallback, useEffect, useState } from 'react';

/** Lazy-loaded SceneCanvas — keeps Three.js + scene rendering out of the initial bundle */
const SceneCanvas = React.lazy(() =>
  import('@aics/ui-office/scene').then((m) => ({ default: m.SceneCanvas })),
);

/** Lazy-loaded overlay/dialog components — kept out of the initial bundle */
const CompanyCreationWizard = React.lazy(() =>
  import('@aics/ui-office/wizard').then((m) => ({ default: m.CompanyCreationWizard })),
);
const DashboardOverlay = React.lazy(() =>
  import('@aics/ui-office/dashboard').then((m) => ({ default: m.DashboardOverlay })),
);
const EmployeeCreatorOverlay = React.lazy(() =>
  import('@aics/ui-office/employee-creator').then((m) => ({ default: m.EmployeeCreatorOverlay })),
);
const OfficeEditorOverlay = React.lazy(() =>
  import('@aics/ui-office/office-editor').then((m) => ({ default: m.OfficeEditorOverlay })),
);
const SettingsDialog = React.lazy(() =>
  import('@aics/ui-office/settings').then((m) => ({ default: m.SettingsDialog })),
);
const CompanyEditor = React.lazy(() =>
  import('@aics/ui-office/company-editor').then((m) => ({ default: m.CompanyEditor })),
);
const InstallDialog = React.lazy(() =>
  import('@aics/ui-office/install').then((m) => ({ default: m.InstallDialog })),
);

type AppView = 'office' | 'employee-creator' | 'office-editor';

export function App() {
  const [view, setView] = useState<AppView>('office');
  const [viewMode, setViewMode] = useState<'2D' | '3D'>('3D');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(loadProviderConfig);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [focusOutputsToken, setFocusOutputsToken] = useState(0);
  const [chatOpenToken, setChatOpenToken] = useState(0);
  const { reinitRuntime, repos, eventBus } = useAicsRuntime();
  const { activeCompanyId } = useCompany();
  const reducedMotion = useReducedMotion();
  const companyEditor = useCompanyEditor();
  const installFlow = useInstallFlow();
  const agents = useAgentStates();
  const { toasts, addToast, dismissToast } = useToasts();

  // Keyboard shortcut: Cmd+D / Ctrl+D toggles Boss Dashboard overlay
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        setDashboardOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Subscribe to deliverable.created — show a prominent "Output ready" toast with a View action
  useEffect(() => {
    return eventBus.on(
      'deliverable.created',
      (e: RuntimeEvent<DeliverableCreatedPayload>) => {
        const title = e.payload.title || 'Output';
        addToast(`Output ready: ${title}`, 'success', {
          actionLabel: 'View',
          onAction: () => setFocusOutputsToken((t) => t + 1),
          durationMs: 8_000,
        });
      },
    );
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

  function handleSaveConfig(config: ProviderConfig) {
    setProviderConfig(config);
    reinitRuntime();
  }

  function handleWizardComplete() {
    if (!providerConfig) {
      setSettingsOpen(true);
    }
  }

  return (
    <ErrorBoundary>
      <>
        <ToastBanner toasts={toasts} onDismiss={dismissToast} />

        {/* ── Full-page views ── */}
        {view === 'employee-creator' && (
          <Suspense fallback={null}>
            <EmployeeCreatorOverlay
              open
              onClose={() => setView('office')}
              onDeploy={handleCreatorDeploy}
            />
          </Suspense>
        )}

        {view === 'office-editor' && (
          <Suspense fallback={null}>
            <OfficeEditorOverlay open onClose={() => setView('office')} />
          </Suspense>
        )}

        {/* ── Office view (default) ── */}
        {view === 'office' && (
          <>
            <AppLayout
              header={
                <Header
                  providerName={providerConfig?.model}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onOpenCompanyEditor={companyEditor.open}
                  onOpenEmployeeCreator={() => setView('employee-creator')}
                  onOpenOfficeEditor={() => setView('office-editor')}
                  onFileImport={installFlow.startFileImport}
                  notificationSlot={<NotificationCenter />}
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
                  />
                </ChatDrawer>
              }
              eventLog={
                <RightSidebar
                  onOpenDashboard={() => setDashboardOpen(true)}
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
        <Suspense fallback={null}>
          <CompanyCreationWizard onComplete={handleWizardComplete} />
        </Suspense>
      </>
    </ErrorBoundary>
  );
}
