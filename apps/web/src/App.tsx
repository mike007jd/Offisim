import { useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { Header } from './components/layout/Header';
import { StatusBar } from './components/layout/StatusBar';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { AgentPanel } from './components/agents/AgentPanel';
import { ChatPanel } from './components/chat/ChatPanel';
import { ChatDrawer } from './components/chat/ChatDrawer';
import { SceneCanvas } from './components/scene/SceneCanvas';
import { EventLog } from './components/events/EventLog';
import { PlanProgressPanel } from './components/plan/PlanProgressPanel';
import { InstallDialog } from './components/install/InstallDialog';
import { useAicsRuntime } from './runtime/aics-runtime-context';
import { useReducedMotion } from './hooks/use-reduced-motion';
import { useInstallFlow } from './hooks/useInstallFlow';
import { type ProviderConfig, loadProviderConfig } from './lib/provider-config';

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
