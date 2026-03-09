import { useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { Header } from './components/layout/Header';
import { StatusBar } from './components/layout/StatusBar';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { AgentPanel } from './components/agents/AgentPanel';
import { ChatPanel } from './components/chat/ChatPanel';
import { EventLog } from './components/events/EventLog';
import { useAicsRuntime } from './runtime/aics-runtime-context';
import { type ProviderConfig, loadProviderConfig } from './lib/provider-config';

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(loadProviderConfig);
  const { reinitRuntime } = useAicsRuntime();

  function handleSaveConfig(config: ProviderConfig) {
    setProviderConfig(config);
    reinitRuntime();
  }

  return (
    <>
      <AppLayout
        header={<Header providerName={providerConfig?.model} onOpenSettings={() => setSettingsOpen(true)} />}
        agentPanel={<AgentPanel />}
        chatPanel={<ChatPanel onOpenSettings={() => setSettingsOpen(true)} />}
        eventLog={<EventLog />}
        statusBar={<StatusBar modelName={providerConfig?.model} />}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSave={handleSaveConfig}
      />
    </>
  );
}
