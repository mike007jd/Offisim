import { CommandPalette } from '@/app/CommandPalette.js';
import { useUiState } from '@/app/ui-state.js';
import { AppFrame } from '@/design-system/shell/AppFrame.js';
import { useRealDataBootstrap } from '@/runtime/useRealDataBootstrap.js';
import { SurfaceRouter } from '@/surfaces/SurfaceRouter.js';
import { LifecycleSurface } from '@/surfaces/lifecycle/LifecycleSurface.js';
import { useLoadPersistedAppearance } from '@/surfaces/settings/appearance.js';
import { useEffect } from 'react';

export function App() {
  useRealDataBootstrap();
  // Apply the persisted theme/density preference to the document on load and
  // keep 'system' theme in sync with the OS color scheme, app-wide.
  useLoadPersistedAppearance();
  // Company creation is a level-0 flow: it takes over the whole window instead of
  // rendering inside the app shell, so the topbar/nav chrome is hidden.
  const isLifecycle = useUiState((s) => s.surface === 'lifecycle');

  // Tear down the previous company's agent runtime when the active company
  // changes (or the app unmounts): the cleanup fires for the company this effect
  // was bound to, killing its MCP child processes + skill-staging timer. The
  // agent-runtime module is dynamically imported so it stays out of the main
  // bundle; disposing a never-assembled company is a no-op.
  const companyId = useUiState((s) => s.companyId);
  useEffect(() => {
    if (!companyId) return;
    return () => {
      void import('@/runtime/desktop-agent-runtime.js')
        .then(({ disposeDesktopAgentRuntime }) => disposeDesktopAgentRuntime(companyId))
        .catch(() => undefined);
    };
  }, [companyId]);
  return (
    <>
      {isLifecycle ? (
        <LifecycleSurface />
      ) : (
        <AppFrame>
          <SurfaceRouter />
        </AppFrame>
      )}
      <CommandPalette />
    </>
  );
}
