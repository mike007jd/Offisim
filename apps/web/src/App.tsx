import { useCallback, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AgentPanel } from './components/agents/AgentPanel';
import { ChatDrawer } from './components/chat/ChatDrawer';
import { ChatPanel } from './components/chat/ChatPanel';
import { InstallDialog } from './components/install/InstallDialog';
import { AppLayout } from './components/layout/AppLayout';
import { Header } from './components/layout/Header';
import { RightSidebar } from './components/layout/RightSidebar';
import { StatusBar } from './components/layout/StatusBar';
import { SceneCanvas } from './components/scene/SceneCanvas';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { ToastBanner, useToasts } from './components/ui/toast-banner';
import { useReducedMotion } from './hooks/use-reduced-motion';
import { useDeepLinkInstall } from './hooks/useDeepLinkInstall';
import { useInstallFlow } from './hooks/useInstallFlow';
import { type ProviderConfig, loadProviderConfig } from './lib/provider-config';
import { useAicsRuntime } from './runtime/aics-runtime-context';
import { useAgentStates } from './runtime/use-agent-states';

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
      </>
    </ErrorBoundary>
  );
}
