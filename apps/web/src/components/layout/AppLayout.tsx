import type { ReactNode } from 'react';

interface AppLayoutProps {
  header: ReactNode;
  agentPanel: ReactNode;
  sceneCanvas: ReactNode;
  chatDrawer: ReactNode;
  eventLog: ReactNode;
  statusBar: ReactNode;
}

export function AppLayout({
  header,
  agentPanel,
  sceneCanvas,
  chatDrawer,
  eventLog,
  statusBar,
}: AppLayoutProps) {
  return (
    <div className="grid h-screen grid-rows-[auto_1fr_auto_auto]">
      {header}
      <div className="grid min-h-0 grid-cols-[240px_1fr_280px]">
        <aside className="border-r-2 border-ocean-light overflow-y-auto">{agentPanel}</aside>
        <main className="min-h-0 min-w-0 overflow-hidden">{sceneCanvas}</main>
        <aside className="border-l-2 border-ocean-light overflow-y-auto">{eventLog}</aside>
      </div>
      {chatDrawer}
      {statusBar}
    </div>
  );
}
