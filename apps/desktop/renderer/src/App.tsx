import { AppFrame } from '@/design-system/shell/AppFrame.js';
import { WorkspaceSurface } from '@/surfaces/WorkspaceSurface.js';

interface AppProps {
  onCompanySwitch: (id: string | null) => void;
}

export function App({ onCompanySwitch: _onCompanySwitch }: AppProps) {
  return (
    <AppFrame>
      <WorkspaceSurface />
    </AppFrame>
  );
}
