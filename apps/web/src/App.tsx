import { useCallback, useState } from 'react';
import { ToastBanner, useToasts } from '@aics/ui-core';
import {
  AgentPanel,
  AppLayout,
  ChatDrawer,
  ChatPanel,
  CompanyCreationWizard,
  ErrorBoundary,
  Header,
  InstallDialog,
  type ProviderConfig,
  RightSidebar,
  SceneCanvas,
  SettingsDialog,
  StatusBar,
  loadProviderConfig,
  useAicsRuntime,
  useAgentStates,
  useDeepLinkInstall,
  useInstallFlow,
  useReducedMotion,
} from '@aics/ui-office';

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(loadProviderConfig);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const { reinitRuntime } = useAicsRuntime();
  const reducedMotion = useReducedMotion();
  const installFlow = useInstallFlow();
  const agents = useAgentStates();
  const { toasts, addToast, dismissToast } = useToasts();

  // Deep link install handler — receives aics://install?listing_id=X&version=Y from Tauri shell
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
              onFileImport={installFlow.startFileImport}
            />
          }
          agentPanel={
            <AgentPanel
              onSelectEmployee={setSelectedEmployeeId}
              selectedEmployeeId={selectedEmployeeId}
            />
          }
          sceneCanvas={<SceneCanvas reducedMotion={reducedMotion} />}
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
          eventLog={<RightSidebar />}
          statusBar={<StatusBar modelName={providerConfig?.model} />}
        />
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onSave={handleSaveConfig}
        />
        <InstallDialog {...installFlow} />
        <CompanyCreationWizard />
      </>
    </ErrorBoundary>
  );
}
