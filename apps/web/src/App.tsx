import { useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { Header } from './components/layout/Header';
import { StatusBar } from './components/layout/StatusBar';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { type ProviderConfig, loadProviderConfig } from './lib/provider-config';

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(loadProviderConfig);

  function handleSaveConfig(config: ProviderConfig) {
    setProviderConfig(config);
  }

  const providerLabel = providerConfig
    ? `${providerConfig.model}`
    : undefined;

  return (
    <>
      <AppLayout
        header={<Header providerName={providerLabel} onOpenSettings={() => setSettingsOpen(true)} />}
        agentPanel={
          <div className="p-3 text-sm text-text-muted">Agent Panel</div>
        }
        chatPanel={
          <div className="flex flex-1 items-center justify-center text-text-muted">
            {providerConfig
              ? 'Send a message to your AI company'
              : 'Configure your LLM provider to get started'}
          </div>
        }
        eventLog={
          <div className="p-3 text-sm text-text-muted">Event Log</div>
        }
        statusBar={<StatusBar runStatus="idle" modelName={providerConfig?.model} />}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSave={handleSaveConfig}
      />
    </>
  );
}
