import { useUiState } from '@/app/ui-state.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Activity, LayoutGrid, Settings } from 'lucide-react';

export function IconBar() {
  const surface = useUiState((s) => s.surface);
  const setSurface = useUiState((s) => s.setSurface);
  const showStudio = surface === 'office' || surface === 'studio';

  return (
    <div className="off-iconbar">
      <IconButton
        icon={Activity}
        label="Activity"
        size="iconSm"
        variant={surface === 'activity' ? 'accentSoft' : 'ghost'}
        onClick={() => setSurface('activity')}
      />
      <IconButton
        icon={Settings}
        label="Settings"
        size="iconSm"
        variant={surface === 'settings' ? 'accentSoft' : 'ghost'}
        onClick={() => setSurface('settings')}
      />
      {showStudio ? (
        <>
          <span className="off-iconbar-divider" aria-hidden />
          <IconButton
            icon={LayoutGrid}
            label="Studio"
            size="iconSm"
            variant={surface === 'studio' ? 'accentSoft' : 'ghost'}
            onClick={() => setSurface('studio')}
          />
        </>
      ) : null}
    </div>
  );
}
