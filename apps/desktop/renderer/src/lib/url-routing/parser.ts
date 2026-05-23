import type { AssetKind } from '@offisim/asset-schema';
import type {
  ActivityLogSessionState,
  MarketSessionState,
  PersonnelTabId,
  SettingsSessionState,
  WorkspaceAppKey,
} from '../../components/workspaces/types';
import type { ParsedInitialState, ParsedUrl, UrlOverlayKey } from './types';

type LocationParts = Pick<Location, 'pathname' | 'search'> | Pick<URL, 'pathname' | 'search'>;

const MAX_URL_PART_LENGTH = 1024;

const PERSONNEL_TABS = new Set<PersonnelTabId>([
  'profile',
  'appearance',
  'runtime',
  'skills',
  'memory',
  'history',
]);
const SETTINGS_TABS = new Set<SettingsSessionState['activeTab']>([
  'provider',
  'runtime',
  'mcp',
  'external',
]);
const WORKSPACE_APPS = new Set<WorkspaceAppKey>([
  'messenger',
  'approvals',
  'docs',
  'calendar',
  'meetings',
  'contacts',
  'workplace',
]);
const MARKET_MANAGE_TABS = new Set<MarketSessionState['manageTab']>([
  'installed',
  'updates',
  'published',
]);
const MARKET_SORTS = new Set<MarketSessionState['sort']>([
  'relevance',
  'newest',
  'rating',
  'installs',
]);
const MARKET_KINDS = new Set<MarketSessionState['kind']>([
  'all',
  'employee',
  'skill',
  'sop',
  'company_template',
  'office_layout',
  'bundle',
  'prefab',
]);
const ACTIVITY_DATE_PRESETS = new Set<ActivityLogSessionState['datePreset']>([
  'today',
  '7d',
  '30d',
  'custom',
]);
const QUERY_OVERLAYS = new Set<UrlOverlayKey>(['office-editor']);

function boundedPart(value: string, kind: 'pathname' | 'search'): string {
  if (value.length <= MAX_URL_PART_LENGTH) return value;
  console.warn(`[url-routing] ${kind} exceeded ${MAX_URL_PART_LENGTH} chars; truncating.`);
  return value.slice(0, MAX_URL_PART_LENGTH);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function cleanSegments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean).map(safeDecode).filter(Boolean);
}

function csvParam(search: URLSearchParams, key: string): string[] {
  const raw = search.get(key);
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function readQueryOverlay(search: URLSearchParams): UrlOverlayKey | null {
  const overlay = search.get('overlay') as UrlOverlayKey | null;
  if (!overlay) return null;
  return QUERY_OVERLAYS.has(overlay) ? overlay : null;
}

function readSort(search: URLSearchParams): MarketSessionState['sort'] {
  const sort = search.get('sort') as MarketSessionState['sort'] | null;
  return sort && MARKET_SORTS.has(sort) ? sort : 'relevance';
}

function readKind(search: URLSearchParams): MarketSessionState['kind'] {
  const kind = search.get('kind') as (AssetKind | 'all') | null;
  return kind && MARKET_KINDS.has(kind) ? kind : 'all';
}

export function parseOfficePath(search: URLSearchParams): ParsedUrl {
  const view = search.get('view');
  const viewMode = view === '2d' ? '2D' : view === '3d' ? '3D' : undefined;
  return {
    workspace: 'office',
    overlay: readQueryOverlay(search),
    companyId: search.get('company'),
    sessionPatch: {
      office: {
        ...(viewMode ? { viewMode } : {}),
        marketplaceListingId: search.get('listing'),
        selectedThreadId: search.get('thread'),
      },
    },
  };
}

export function parseSopsPath(segments: string[], search: URLSearchParams): ParsedUrl {
  return {
    workspace: 'sops',
    overlay: null,
    sessionPatch: {
      sops: {
        selectedSopId: segments[1] ?? null,
        focusedStepId: search.get('step'),
        search: search.get('q') ?? '',
      },
    },
  };
}

export function parseMarketPath(segments: string[], search: URLSearchParams): ParsedUrl {
  const section = segments[1] ?? 'explore';
  if (section === 'manage') {
    const manageTab = MARKET_MANAGE_TABS.has(segments[2] as MarketSessionState['manageTab'])
      ? (segments[2] as MarketSessionState['manageTab'])
      : 'installed';
    return {
      workspace: 'market',
      overlay: null,
      sessionPatch: {
        market: {
          mode: 'manage',
          manageTab,
          selectedListingId: search.get('detail'),
          search: search.get('q') ?? '',
          sort: readSort(search),
          kind: readKind(search),
        },
      },
    };
  }

  return {
    workspace: 'market',
    overlay: null,
    sessionPatch: {
      market: {
        mode: 'explore',
        selectedListingId: section === 'explore' ? (segments[2] ?? null) : null,
        search: search.get('q') ?? '',
        sort: readSort(search),
        kind: readKind(search),
      },
    },
  };
}

export function parsePersonnelPath(segments: string[], search: URLSearchParams): ParsedUrl {
  if (segments[1] === 'new') {
    return {
      workspace: 'personnel',
      overlay: 'employee-creator',
      sessionPatch: { personnel: { selectedEmployeeId: null, activeEmployeeTab: 'profile' } },
    };
  }

  const tab = search.get('tab') as PersonnelTabId | null;
  return {
    workspace: 'personnel',
    overlay: null,
    sessionPatch: {
      personnel: {
        selectedEmployeeId: segments[1] ?? null,
        activeEmployeeTab: tab && PERSONNEL_TABS.has(tab) ? tab : 'profile',
      },
    },
  };
}

export function parseActivityPath(search: URLSearchParams): ParsedUrl {
  const date = search.get('date') as ActivityLogSessionState['datePreset'] | null;
  return {
    workspace: 'activity-log',
    overlay: null,
    sessionPatch: {
      activityLog: {
        selectedEventId: search.get('event'),
        eventTypes: csvParam(search, 'type'),
        actorFilters: csvParam(search, 'actor'),
        datePreset: date && ACTIVITY_DATE_PRESETS.has(date) ? date : 'today',
        search: search.get('q') ?? '',
      },
    },
  };
}

export function parseWorkspacePath(search: URLSearchParams): ParsedUrl {
  const app = search.get('app') as WorkspaceAppKey | null;
  return {
    workspace: 'workspace',
    overlay: null,
    sessionPatch: {
      workspace: {
        activeApp: app && WORKSPACE_APPS.has(app) ? app : 'messenger',
      },
    },
  };
}

export function parseSettingsPath(segments: string[]): ParsedUrl {
  const section = SETTINGS_TABS.has(segments[1] as SettingsSessionState['activeTab'])
    ? (segments[1] as SettingsSessionState['activeTab'])
    : 'provider';
  return {
    workspace: 'settings',
    overlay: null,
    sessionPatch: { settings: { activeTab: section } },
  };
}

export function parseUrl(input: LocationParts): ParsedUrl {
  const pathname = boundedPart(input.pathname || '/', 'pathname');
  const searchString = boundedPart(input.search || '', 'search');
  const segments = cleanSegments(pathname);
  const search = new URLSearchParams(searchString);
  const first = segments[0] ?? '';

  switch (first) {
    case '':
    case 'office':
      return parseOfficePath(search);
    case 'sops':
      return parseSopsPath(segments, search);
    case 'market':
      return parseMarketPath(segments, search);
    case 'personnel':
      return parsePersonnelPath(segments, search);
    case 'workspace':
      return parseWorkspacePath(search);
    case 'activity':
      return parseActivityPath(search);
    case 'settings':
      return parseSettingsPath(segments);
    case 'studio':
      return {
        workspace: 'office',
        overlay: 'studio',
        companyId: search.get('company'),
        sessionPatch: {},
      };
    default:
      return { workspace: 'office', overlay: null, sessionPatch: {} };
  }
}

export function parseInitialUrl(): ParsedInitialState {
  if (typeof window === 'undefined') {
    return { workspace: 'office', overlay: null, sessionPatch: {} };
  }
  return parseUrl(window.location);
}

export function urlRequiresCompany(parsed: ParsedUrl): boolean {
  if (parsed.workspace !== 'office') return true;
  if (parsed.overlay === 'studio') return true;
  if (parsed.overlay === 'employee-creator') return true;
  if (parsed.overlay === 'office-editor') return true;
  const office = parsed.sessionPatch.office;
  return Boolean(parsed.companyId || office?.marketplaceListingId);
}
