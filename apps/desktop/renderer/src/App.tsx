import { CommandPalette } from '@/app/CommandPalette.js';
import { useUiState } from '@/app/ui-state.js';
import { AppFrame } from '@/design-system/shell/AppFrame.js';
import { LoopScheduler } from '@/runtime/loops/LoopScheduler.js';
import { useRealDataBootstrap } from '@/runtime/useRealDataBootstrap.js';
import { SurfaceRouter } from '@/surfaces/SurfaceRouter.js';
import { LifecycleSurface } from '@/surfaces/lifecycle/LifecycleSurface.js';
import { CodexPetProvider } from '@/surfaces/office/scene/office-companion/CodexPetProvider.js';
import { useLoadPersistedAppearance } from '@/surfaces/settings/appearance.js';

export function App() {
  useRealDataBootstrap();
  // Apply the persisted theme/density preference to the document on load and
  // keep 'system' theme in sync with the OS color scheme, app-wide.
  useLoadPersistedAppearance();
  // Company creation is a level-0 flow: it takes over the whole window instead of
  // rendering inside the app shell, so the topbar/nav chrome is hidden.
  const isLifecycle = useUiState((s) => s.surface === 'lifecycle');

  return (
    <CodexPetProvider>
      {isLifecycle ? (
        <LifecycleSurface />
      ) : (
        <AppFrame>
          <SurfaceRouter />
        </AppFrame>
      )}
      <CommandPalette />
      <LoopScheduler />
    </CodexPetProvider>
  );
}
