import { employeeCreated } from '@aics/core/browser';
import { ToastBanner, useToasts } from '@aics/ui-core';
import {
  AgentPanel,
  AppLayout,
  COMPANY_ID,
  ChatDrawer,
  ChatPanel,
  CompanyCreationWizard,
  CompanyEditor,
  DashboardOverlay,
  EmployeeCreatorOverlay,
  EmployeeInspector,
  ErrorBoundary,
  Header,
  InstallDialog,
  NotificationCenter,
  OfficeEditorOverlay,
  type ProviderConfig,
  RightSidebar,
  SettingsDialog,
  StatusBar,
  loadProviderConfig,
  useAgentStates,
  useAicsRuntime,
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

type AppView = 'office' | 'employee-creator' | 'office-editor';

export function App() {
  const [view, setView] = useState<AppView>('office');
  const [viewMode, setViewMode] = useState<'2D' | '3D'>('3D');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(loadProviderConfig);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [focusOutputsToken, setFocusOutputsToken] = useState(0);
  const { reinitRuntime, repos, eventBus } = useAicsRuntime();
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
      if (!repos?.employees) {
        addToast('Runtime not ready — please wait a moment', 'error');
        return;
      }
      try {
        addToast(`Deploying ${name} (${role})…`, 'info');
        const result = await repos.employees.create({
          company_id: COMPANY_ID,
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
        eventBus.emit(employeeCreated(COMPANY_ID, result.employee_id, name, role));
        addToast(`${name} deployed successfully`, 'success');
        setView('office');
      } catch (err) {
        console.error('[App] Failed to create employee:', err);
        addToast(`Failed to deploy ${name}`, 'error');
      }
    },
    [repos, eventBus, addToast],
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
          <EmployeeCreatorOverlay
            open
            onClose={() => setView('office')}
            onDeploy={handleCreatorDeploy}
          />
        )}

        {view === 'office-editor' && <OfficeEditorOverlay open onClose={() => setView('office')} />}

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
                  onSelectEmployee={setSelectedEmployeeId}
                  selectedEmployeeId={selectedEmployeeId}
                  onOpenCreator={() => setView('employee-creator')}
                />
              }
              sceneCanvas={
                <Suspense fallback={<div className="h-full w-full bg-ocean-deep animate-pulse" />}>
                  <SceneCanvas reducedMotion={reducedMotion} viewMode={viewMode} />
                </Suspense>
              }
              chatDrawer={
                <ChatDrawer>
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
              <DashboardOverlay open={dashboardOpen} onClose={() => setDashboardOpen(false)} />
            )}
            <EmployeeInspector
              employeeId={selectedEmployeeId}
              agents={agents}
              onClose={() => setSelectedEmployeeId(null)}
              onOpenEditor={(id) => {
                companyEditor.open();
                console.info('[EmployeeInspector] Open editor for', id);
              }}
              onStartChat={(id) => setSelectedEmployeeId(id)}
            />
          </>
        )}

        {/* ── Global dialogs (available across all views) ── */}
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onSave={handleSaveConfig}
          onSaveSuccess={() => addToast('Provider configuration saved', 'success')}
        />
        <InstallDialog {...installFlow} />
        <CompanyEditor {...companyEditor} onOpenOfficeEditor={() => setView('office-editor')} />
        <CompanyCreationWizard onComplete={handleWizardComplete} />
      </>
    </ErrorBoundary>
  );
}
