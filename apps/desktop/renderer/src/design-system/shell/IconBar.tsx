import { UTILITY_NAV } from '@/app/nav-registry.js';
import { useUiState } from '@/app/ui-state.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';

export function IconBar() {
  const surface = useUiState((s) => s.surface);
  const setSurface = useUiState((s) => s.setSurface);
  const visibleEntries = UTILITY_NAV;

  return (
    <div className="off-iconbar">
      {visibleEntries.map((entry, index) => (
        <span key={entry.key} className="off-iconbar-entry">
          {/* Divider before Studio separates feed/config utilities from the editor. */}
          {entry.key === 'studio' && index > 0 ? (
            <span className="off-iconbar-divider" aria-hidden />
          ) : null}
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
