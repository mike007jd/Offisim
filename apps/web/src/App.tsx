import { useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { Header } from './components/layout/Header';
import { StatusBar } from './components/layout/StatusBar';

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <AppLayout
      header={<Header onOpenSettings={() => setSettingsOpen(!settingsOpen)} />}
      agentPanel={
        <div className="p-3 text-sm text-text-muted">Agent Panel</div>
      }
      chatPanel={
        <div className="flex flex-1 items-center justify-center text-text-muted">
          Chat Panel
        </div>
      }
      eventLog={
        <div className="p-3 text-sm text-text-muted">Event Log</div>
      }
      statusBar={<StatusBar runStatus="idle" />}
    />
  );
}
