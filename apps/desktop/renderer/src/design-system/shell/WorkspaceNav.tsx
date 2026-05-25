import { WORKSPACE_NAV, useUiState } from '@/app/ui-state.js';
import { cn } from '@/lib/utils.js';

export function WorkspaceNav() {
  const surface = useUiState((s) => s.surface);
  const setSurface = useUiState((s) => s.setSurface);

  return (
    <nav className="off-workspace-nav" aria-label="Workspace">
      {WORKSPACE_NAV.map((item) => {
        const active = surface === item.key || (item.key === 'office' && surface === 'studio');
        return (
          <button
            key={item.key}
            type="button"
            className={cn('off-focusable', active && 'is-active')}
            aria-current={active ? 'page' : undefined}
            onClick={() => setSurface(item.key)}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
