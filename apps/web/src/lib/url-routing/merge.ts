import type { WorkspaceSessionState } from '../../components/workspaces/types';
import type { ParsedUrl } from './types';

/**
 * Apply a URL-derived session patch on top of an existing WorkspaceSessionState.
 * Empty patches return `base` unchanged so caller useState/useEffect identity
 * checks short-circuit.
 */
export function mergeSessionPatch(
  base: WorkspaceSessionState,
  patch: ParsedUrl['sessionPatch'] | undefined,
): WorkspaceSessionState {
  if (!patch) return base;
  return {
    office: { ...base.office, ...patch.office },
    sops: { ...base.sops, ...patch.sops },
    market: { ...base.market, ...patch.market },
    personnel: { ...base.personnel, ...patch.personnel },
    activityLog: { ...base.activityLog, ...patch.activityLog },
    settings: { ...base.settings, ...patch.settings },
  };
}
