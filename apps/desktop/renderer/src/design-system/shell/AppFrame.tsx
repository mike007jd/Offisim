import { useUiState } from '@/app/ui-state.js';
import type { ReactNode } from 'react';
import { IconBar } from './IconBar.js';
import { ScopeBar } from './ScopeBar.js';
import { WorkspaceNav } from './WorkspaceNav.js';

interface AppFrameProps {
  children: ReactNode;
}

export function AppFrame({ children }: AppFrameProps) {
  const openLifecycle = useUiState((s) => s.openLifecycle);
  return (
    <main className="off-app">
      <header className="off-topbar">
        <button
          type="button"
          className="off-wordmark off-focusable"
          aria-label="Offisim — back to companies"
          onClick={() => openLifecycle('select')}
        >
          Offisim
        </button>
        <ScopeBar />
        <WorkspaceNav />
        <IconBar />
      </header>
      <div className="off-surface-host">{children}</div>
    </main>
  );
}
