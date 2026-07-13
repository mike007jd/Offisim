import { NAV_ENTRIES, UTILITY_NAV } from '@/app/nav-registry.js';
import { useUiState } from '@/app/ui-state.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/design-system/primitives/tooltip.js';
import { cn } from '@/lib/utils.js';
import { Fragment } from 'react';

/**
 * The single surface-navigation cluster. Primary surfaces render as text tabs;
 * utility surfaces follow behind a divider. Every destination keeps a stable
 * icon + text footprint so changing the active surface never shifts the bar.
 */
export function WorkspaceNav() {
  const surface = useUiState((s) => s.surface);
  const setSurface = useUiState((s) => s.setSurface);

  return (
    <nav className="off-workspace-nav" aria-label="Surfaces">
      {NAV_ENTRIES.map((item) => {
        const active = surface === item.key;
        const isUtility = item.tier === 'utility';
        const button = (
          <button
            type="button"
            className={cn('off-focusable', isUtility && 'is-icon', active && 'is-active')}
            aria-current={active ? 'page' : undefined}
            aria-label={item.label}
            title={isUtility ? undefined : item.label}
            onClick={() => setSurface(item.key)}
          >
            <Icon icon={item.icon} size="sm" />
            <span className="off-nav-label">{item.label}</span>
          </button>
        );
        return (
          <Fragment key={item.key}>
            {item.key === UTILITY_NAV[0]?.key ? (
              <span className="off-nav-divider" aria-hidden />
            ) : null}
            {isUtility ? (
              <Tooltip>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="bottom">{item.label}</TooltipContent>
              </Tooltip>
            ) : (
              button
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
