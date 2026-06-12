import { PRIMARY_NAV, UTILITY_NAV } from '@/app/nav-registry.js';
import { useUiState } from '@/app/ui-state.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';

/**
 * The single surface-navigation cluster. Primary surfaces render as text tabs;
 * utility surfaces follow as icon-only buttons behind a divider, sharing the
 * same container and `.is-active` grammar so the current surface always has a
 * visible home in this one chip-bar (utility active state used to live on a
 * far-away frameless icon bar).
 */
export function WorkspaceNav() {
  const surface = useUiState((s) => s.surface);
  const setSurface = useUiState((s) => s.setSurface);

  return (
    <nav className="off-workspace-nav" aria-label="Surfaces">
      {PRIMARY_NAV.map((item) => {
        const active = surface === item.key;
        return (
          <button
            key={item.key}
            type="button"
            className={cn('off-focusable', active && 'is-active')}
            aria-current={active ? 'page' : undefined}
            onClick={() => setSurface(item.key)}
          >
            <Icon icon={item.icon} size="sm" />
            {item.label}
          </button>
        );
      })}
      <span className="off-iconbar-divider" aria-hidden />
      {UTILITY_NAV.map((item) => {
        const active = surface === item.key;
        return (
          <button
            key={item.key}
            type="button"
            className={cn('off-focusable is-icon', active && 'is-active')}
            aria-current={active ? 'page' : undefined}
            aria-label={item.label}
            title={item.label}
            onClick={() => setSurface(item.key)}
          >
            <Icon icon={item.icon} size="sm" />
          </button>
        );
      })}
    </nav>
  );
}
