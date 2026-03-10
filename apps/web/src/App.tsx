import { useState } from 'react';
import { AgentPanel } from './components/agents/AgentPanel';
import { ChatDrawer } from './components/chat/ChatDrawer';
import { ChatPanel } from './components/chat/ChatPanel';
import { EventLog } from './components/events/EventLog';
import { InstallDialog } from './components/install/InstallDialog';
import { AppLayout } from './components/layout/AppLayout';
import { Header } from './components/layout/Header';
import { StatusBar } from './components/layout/StatusBar';
import { PlanProgressPanel } from './components/plan/PlanProgressPanel';
import { SceneCanvas } from './components/scene/SceneCanvas';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { useReducedMotion } from './hooks/use-reduced-motion';
import { useInstallFlow } from './hooks/useInstallFlow';
import { type ProviderConfig, loadProviderConfig } from './lib/provider-config';
import { useAicsRuntime } from './runtime/aics-runtime-context';

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(loadProviderConfig);
  const { reinitRuntime } = useAicsRuntime();
  const reducedMotion = useReducedMotion();
  const installFlow = useInstallFlow();

  function handleSaveConfig(config: ProviderConfig) {
    setProviderConfig(config);
    reinitRuntime();
  }

  return (
    <>
      <AppLayout
        header={
          <Header
            providerName={providerConfig?.model}
            onOpenSettings={() => setSettingsOpen(true)}
            onFileImport={installFlow.startFileImport}
          />
        }
        agentPanel={<AgentPanel />}
        sceneCanvas={<SceneCanvas reducedMotion={reducedMotion} />}
        chatDrawer={
          <ChatDrawer>
            <ChatPanel onOpenSettings={() => setSettingsOpen(true)} />
          </ChatDrawer>
        }
        eventLog={
          <>
            <PlanProgressPanel />
            <EventLog />
          </>
        }
        statusBar={<StatusBar modelName={providerConfig?.model} />}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSave={handleSaveConfig}
      />
      <InstallDialog {...installFlow} />
    </>
  );
}
