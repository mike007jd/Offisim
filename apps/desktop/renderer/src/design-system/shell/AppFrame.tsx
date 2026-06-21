import { useUiState } from '@/app/ui-state.js';
import type { ReactNode } from 'react';
import { ScopeBar } from './ScopeBar.js';
import { WorkspaceNav } from './WorkspaceNav.js';

interface AppFrameProps {
  children: ReactNode;
  /**
   * Optional banner row rendered BETWEEN the topbar and the surface host. The
   * surface host fills the rest with `position: absolute` surfaces, so a banner
   * placed inside it would be covered — it needs its own grid row. The slot
   * collapses to zero height when the banner renders nothing.
   */
  banner?: ReactNode;
}

export function AppFrame({ children, banner }: AppFrameProps) {
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
      </header>
      <div className="off-banner-slot">{banner}</div>
      <div className="off-surface-host">{children}</div>
    </main>
  );
}
