import { useUiState } from '@/app/ui-state.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Activity, LayoutGrid, Settings, type LucideIcon } from 'lucide-react';

type UtilityEntry = {
  key: 'activity' | 'settings' | 'studio';
  label: string;
  icon: LucideIcon;
};

const UTILITY_ENTRIES: readonly UtilityEntry[] = [
  { key: 'activity', label: 'Activity', icon: Activity },
  { key: 'settings', label: 'Settings', icon: Settings },
  { key: 'studio', label: 'Studio', icon: LayoutGrid },
];

export function IconBar() {
  const surface = useUiState((s) => s.surface);
  const setSurface = useUiState((s) => s.setSurface);

  return (
    <div className="off-iconbar">
      {UTILITY_ENTRIES.map((entry) => (
        <span key={entry.key} className="off-iconbar-entry">
          {entry.key === 'studio' ? <span className="off-iconbar-divider" aria-hidden /> : null}
          <IconButton
            icon={entry.icon}
            label={entry.label}
            size="iconSm"
            variant={surface === entry.key ? 'accentSoft' : 'ghost'}
            onClick={() => setSurface(entry.key)}
          />
        </span>
      ))}
    </div>
  );
}
