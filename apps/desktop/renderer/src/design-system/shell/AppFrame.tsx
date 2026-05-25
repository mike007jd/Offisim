import type { ReactNode } from 'react';
import { IconBar } from './IconBar.js';
import { ScopeBar } from './ScopeBar.js';
import { WorkspaceNav } from './WorkspaceNav.js';

interface AppFrameProps {
  children: ReactNode;
}

export function AppFrame({ children }: AppFrameProps) {
  return (
    <main className="off-app">
      <header className="off-topbar">
        <ScopeBar />
        <WorkspaceNav />
        <IconBar />
      </header>
      <div className="off-surface-host">{children}</div>
    </main>
  );
}
