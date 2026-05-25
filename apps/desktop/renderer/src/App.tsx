import { CommandPalette } from '@/app/CommandPalette.js';
import { AppFrame } from '@/design-system/shell/AppFrame.js';
import { SurfaceRouter } from '@/surfaces/SurfaceRouter.js';

export function App() {
  return (
    <AppFrame>
      <SurfaceRouter />
      <CommandPalette />
    </AppFrame>
  );
}
