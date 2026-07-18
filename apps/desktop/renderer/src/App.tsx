import { CommandPalette } from '@/app/CommandPalette.js';
import { UpdateNotifier } from '@/app/UpdateNotifier.js';
import { useUiState } from '@/app/ui-state.js';
import { AppFrame } from '@/design-system/shell/AppFrame.js';
import { LoopScheduler } from '@/runtime/loops/LoopScheduler.js';
import { useRealDataBootstrap } from '@/runtime/useRealDataBootstrap.js';
import { SurfaceRouter } from '@/surfaces/SurfaceRouter.js';
import { LifecycleSurface } from '@/surfaces/lifecycle/LifecycleSurface.js';
import { CodexPetProvider } from '@/surfaces/office/scene/office-companion/CodexPetProvider.js';
import { FirstRunGuide } from '@/surfaces/onboarding/FirstRunGuide.js';
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

  // Detach the previous company's renderer-side runtime when the active company
  // changes (or the app unmounts). Detach must not abort a live Pi host: renderer
  // reload reconnect relies on the Rust host continuing until explicit Stop.
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
    <CodexPetProvider>
      {isLifecycle ? (
        <div className="off-first-run-lifecycle">
          <FirstRunGuide />
          <LifecycleSurface />
        </div>
      ) : (
        <AppFrame banner={<FirstRunGuide />}>
          <SurfaceRouter />
        </AppFrame>
      )}
      <CommandPalette />
      <LoopScheduler />
      <UpdateNotifier />
    </CodexPetProvider>
  );
}
