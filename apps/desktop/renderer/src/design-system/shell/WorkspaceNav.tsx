import { PRIMARY_NAV } from '@/app/nav-registry.js';
import { useUiState } from '@/app/ui-state.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';

export function WorkspaceNav() {
  const surface = useUiState((s) => s.surface);
  const setSurface = useUiState((s) => s.setSurface);

  return (
    <nav className="off-workspace-nav" aria-label="Primary">
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
    </nav>
  );
}
