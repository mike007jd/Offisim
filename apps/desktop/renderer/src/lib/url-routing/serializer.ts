import type { PersonnelTabId } from '../../components/workspaces/types';
import type { ParsedUrl, SerializableUrlState } from './types';

function append(search: URLSearchParams, key: string, value: string | null | undefined) {
  if (value && value.trim().length > 0) search.set(key, value);
}

function suffix(search: URLSearchParams): string {
  const value = search.toString();
  return value ? `?${value}` : '';
}

function primaryIdentity(parsed: ParsedUrl): string {
  const patch = parsed.sessionPatch;
  const overlay = parsed.overlay ?? '';
  switch (parsed.workspace) {
    case 'office': {
      const office = patch.office;
      return [
        'office',
        overlay,
        office?.viewMode ?? '3D',
        office?.marketplaceListingId ?? '',
        office?.selectedThreadId ?? '',
      ].join(':');
    }
    case 'sops':
      return `sops:${patch.sops?.selectedSopId ?? ''}:${overlay}`;
    case 'market':
      return `market:${patch.market?.mode ?? 'explore'}:${patch.market?.manageTab ?? ''}:${patch.market?.selectedListingId ?? ''}:${overlay}`;
    case 'personnel':
      return `personnel:${patch.personnel?.selectedEmployeeId ?? ''}:${overlay}`;
    case 'workspace':
      return `workspace:${patch.workspace?.activeApp ?? 'messenger'}:${overlay}`;
    case 'activity-log':
      return `activity-log:${patch.activityLog?.selectedEventId ?? ''}:${overlay}`;
    case 'settings':
      return `settings:${patch.settings?.activeTab ?? 'provider'}:${overlay}`;
  }
}

export function serializeOfficeUrl({ sessionState, overlay }: SerializableUrlState): string {
  const office = sessionState.office;
  const search = new URLSearchParams();
  if (office.viewMode === '2D') search.set('view', '2d');
  append(search, 'listing', office.marketplaceListingId);
  append(search, 'thread', office.selectedThreadId);
  if (overlay === 'office-editor') search.set('overlay', 'office-editor');
  return `/${suffix(search)}`;
}

export function serializeSopsUrl({ sessionState }: SerializableUrlState): string {
  const sops = sessionState.sops;
  const search = new URLSearchParams();
  append(search, 'q', sops.search);
  append(search, 'step', sops.focusedStepId);
  const path = sops.selectedSopId ? `/sops/${encodeURIComponent(sops.selectedSopId)}` : '/sops';
  return `${path}${suffix(search)}`;
}

export function serializeMarketUrl({ sessionState }: SerializableUrlState): string {
  const market = sessionState.market;
  const search = new URLSearchParams();
  append(search, 'q', market.search);
  if (market.sort !== 'relevance') search.set('sort', market.sort);
  if (market.kind !== 'all') search.set('kind', market.kind);
  if (market.mode === 'manage') {
    append(search, 'detail', market.selectedListingId);
    return `/market/manage/${market.manageTab}${suffix(search)}`;
  }
  const path = market.selectedListingId
    ? `/market/explore/${encodeURIComponent(market.selectedListingId)}`
    : '/market/explore';
  return `${path}${suffix(search)}`;
}

export function serializePersonnelUrl(employeeId: string, tab: PersonnelTabId = 'profile'): string {
  const search = new URLSearchParams();
  if (tab !== 'profile') search.set('tab', tab);
  return `/personnel/${encodeURIComponent(employeeId)}${suffix(search)}`;
}

export function serializePersonnelWorkspaceUrl({
  sessionState,
  overlay,
}: SerializableUrlState): string {
  if (overlay === 'employee-creator') return '/personnel/new';
  const personnel = sessionState.personnel;
  if (!personnel.selectedEmployeeId) return '/personnel';
  return serializePersonnelUrl(personnel.selectedEmployeeId, personnel.activeEmployeeTab);
}

export function serializeActivityUrl({ sessionState }: SerializableUrlState): string {
  const activity = sessionState.activityLog;
  const search = new URLSearchParams();
  append(search, 'event', activity.selectedEventId);
  if (activity.eventTypes.length > 0) search.set('type', activity.eventTypes.join(','));
  if (activity.actorFilters.length > 0) search.set('actor', activity.actorFilters.join(','));
  if (activity.datePreset !== 'today') search.set('date', activity.datePreset);
  append(search, 'q', activity.search);
  return `/activity${suffix(search)}`;
}

export function serializeWorkspaceUrl({ sessionState }: SerializableUrlState): string {
  const app = sessionState.workspace.activeApp;
  const search = new URLSearchParams();
  // Messenger is the default app — keep the canonical path bare for it.
  if (app !== 'messenger') search.set('app', app);
  return `/workspace${suffix(search)}`;
}

export function serializeSettingsUrl({ sessionState }: SerializableUrlState): string {
  return `/settings/${sessionState.settings.activeTab}`;
}

export function serializeStudioUrl({ activeCompanyId }: SerializableUrlState): string {
  const search = new URLSearchParams();
  append(search, 'company', activeCompanyId);
  return `/studio${suffix(search)}`;
}

export function serializeUrl(state: SerializableUrlState): string {
  if (state.overlay === 'studio') return serializeStudioUrl(state);
  if (state.workspace === 'office') return serializeOfficeUrl(state);
  if (state.workspace === 'sops') return serializeSopsUrl(state);
  if (state.workspace === 'market') return serializeMarketUrl(state);
  if (state.workspace === 'personnel') return serializePersonnelWorkspaceUrl(state);
  if (state.workspace === 'workspace') return serializeWorkspaceUrl(state);
  if (state.workspace === 'activity-log') return serializeActivityUrl(state);
  return serializeSettingsUrl(state);
}

export function shouldReplaceUrl(current: ParsedUrl, next: ParsedUrl): boolean {
  return primaryIdentity(current) === primaryIdentity(next);
}
