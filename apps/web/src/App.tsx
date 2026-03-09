import { useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { Header } from './components/layout/Header';
import { StatusBar } from './components/layout/StatusBar';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { AgentPanel } from './components/agents/AgentPanel';
import { ChatPanel } from './components/chat/ChatPanel';
import { type ProviderConfig, loadProviderConfig } from './lib/provider-config';
import { useAicsRuntime } from './runtime/aics-runtime-context';

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(loadProviderConfig);
  const runtime = useAicsRuntime();

  function handleSaveConfig(config: ProviderConfig) {
    setProviderConfig(config);
    // Trigger runtime reinit with new config
    const reinit = (window as Record<string, unknown>).__aicsReinitRuntime;
    if (typeof reinit === 'function') reinit();
  }

  return (
    <>
      <AppLayout
        header={<Header providerName={providerConfig?.model} onOpenSettings={() => setSettingsOpen(true)} />}
        agentPanel={<AgentPanel />}
        chatPanel={<ChatPanel />}
        eventLog={<div className="p-3 text-sm text-text-muted">Event Log</div>}
        statusBar={<StatusBar runStatus={runtime.isRunning ? 'running' : runtime.error ? 'error' : 'idle'} modelName={providerConfig?.model} />}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSave={handleSaveConfig}
      />
    </>
  );
}
