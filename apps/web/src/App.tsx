import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { ToastBanner, useToasts } from '@aics/ui-core';
import {
  AgentPanel,
  AppLayout,
  ChatDrawer,
  ChatPanel,
  CompanyCreationWizard,
  CompanyEditor,
  DashboardOverlay,
  NotificationCenter,
  ErrorBoundary,
  Header,
  InstallDialog,
  type ProviderConfig,
  RightSidebar,
  SettingsDialog,
  StatusBar,
  loadProviderConfig,
  useAicsRuntime,
  useAgentStates,
  useCompanyEditor,
  useDeepLinkInstall,
  useInstallFlow,
  useReducedMotion,
} from '@aics/ui-office';

/** Lazy-loaded SceneCanvas — keeps PixiJS + GSAP (~504KB) out of the initial bundle */
const SceneCanvas = React.lazy(() =>
  import('@aics/ui-office/scene').then((m) => ({ default: m.SceneCanvas })),
);

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(loadProviderConfig);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const { reinitRuntime } = useAicsRuntime();
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

  function handleSaveConfig(config: ProviderConfig) {
    setProviderConfig(config);
    reinitRuntime();
  }

  return (
    <ErrorBoundary>
      <>
        <ToastBanner toasts={toasts} onDismiss={dismissToast} />
        <AppLayout
          header={
            <Header
              providerName={providerConfig?.model}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenCompanyEditor={companyEditor.open}
              onFileImport={installFlow.startFileImport}
              notificationSlot={<NotificationCenter />}
            />
          }
          agentPanel={
            <AgentPanel
              onSelectEmployee={setSelectedEmployeeId}
              selectedEmployeeId={selectedEmployeeId}
            />
          }
          sceneCanvas={
            <Suspense
              fallback={
                <div className="h-full w-full bg-ocean-deep animate-pulse" />
              }
            >
              <SceneCanvas reducedMotion={reducedMotion} />
            </Suspense>
          }
          chatDrawer={
            <ChatDrawer>
              <ChatPanel
                onOpenSettings={() => setSettingsOpen(true)}
                selectedEmployeeId={selectedEmployeeId}
                selectedEmployeeName={selectedEmployeeName}
                onClearSelection={() => setSelectedEmployeeId(null)}
              />
            </ChatDrawer>
          }
          eventLog={<RightSidebar onOpenDashboard={() => setDashboardOpen(true)} />}
          statusBar={<StatusBar modelName={providerConfig?.model} />}
        />
        {dashboardOpen && <DashboardOverlay open={dashboardOpen} onClose={() => setDashboardOpen(false)} />}
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onSave={handleSaveConfig}
        />
        <InstallDialog {...installFlow} />
        <CompanyEditor {...companyEditor} />
        <CompanyCreationWizard />
      </>
    </ErrorBoundary>
  );
}
