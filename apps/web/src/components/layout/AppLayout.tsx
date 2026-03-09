import type { ReactNode } from 'react';

interface AppLayoutProps {
  header: ReactNode;
  agentPanel: ReactNode;
  chatPanel: ReactNode;
  eventLog: ReactNode;
  statusBar: ReactNode;
}

export function AppLayout({ header, agentPanel, chatPanel, eventLog, statusBar }: AppLayoutProps) {
  return (
    <div className="grid h-screen grid-rows-[auto_1fr_auto]">
      {header}
      <div className="grid min-h-0 grid-cols-[240px_1fr_280px]">
        <aside className="border-r border-border overflow-y-auto">{agentPanel}</aside>
        <main className="min-h-0 flex flex-col">{chatPanel}</main>
        <aside className="border-l border-border overflow-y-auto">{eventLog}</aside>
      </div>
      {statusBar}
    </div>
  );
}
