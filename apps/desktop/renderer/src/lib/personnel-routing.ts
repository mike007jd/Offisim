import type { PersonnelTabId } from '../components/workspaces/types';
import { parseUrl, serializePersonnelUrl } from './url-routing';
import type { ParsedUrl } from './url-routing';

export interface RouteToPersonnelDeps {
  applyParsedUrl: (parsed: ParsedUrl) => void;
}

export type RouteToPersonnelFn = (employeeId: string, tab?: PersonnelTabId) => void;

/**
 * Returns a stable callback that atomically writes the Personnel selection +
 * tab and switches the active workspace. Every "edit employee" surface SHALL
 * route through this helper instead of opening a dialog.
 */
export function createRouteToPersonnel({
  applyParsedUrl,
}: RouteToPersonnelDeps): RouteToPersonnelFn {
  return (employeeId, tab = 'profile') => {
    const url = serializePersonnelUrl(employeeId, tab);
    window.history.pushState(null, '', url);
    const next = parseUrl(new URL(url, window.location.origin));
    applyParsedUrl(next);
  };
}
