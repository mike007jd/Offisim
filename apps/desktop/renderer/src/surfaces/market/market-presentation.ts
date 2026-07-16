import { titleizeSlug } from '@/lib/utils.js';
import type {
  InstalledPackage,
  ManageView,
  MarketMode,
  PublishedDraft,
  RegistryConnectionState,
} from './market-data.js';

export interface MarketConnectionCopy {
  title: string;
  description: string;
}

export function marketConnectionCopy(
  state: RegistryConnectionState | null | undefined,
): MarketConnectionCopy {
  switch (state?.reason) {
    case 'connected':
      return {
        title: 'Online catalog connected',
        description: 'Browsing, publishing, and update checks are available.',
      };
    case 'creator-missing':
      return {
        title: 'Publishing profile needed',
        description: 'Browsing is available, but this account cannot publish yet.',
      };
    case 'platform-unreachable':
      return {
        title: 'Online catalog unavailable',
        description: 'Local items remain available. Check the connection and try again later.',
      };
    case 'desktop-runtime-unavailable':
      return {
        title: 'Desktop connection unavailable',
        description: 'Open the desktop app to manage the online catalog connection.',
      };
    case 'auth-not-configured':
      return {
        title: 'Connect to the online catalog',
        description: 'Add the account connection in Settings to browse and publish.',
      };
    default:
      return {
        title: 'Online catalog not connected',
        description: 'Local items and imports still work without an online connection.',
      };
  }
}

export function installedDisplayName(packageId: string): string {
  const tail = packageId.split(/[./]/u).filter(Boolean).pop() ?? packageId;
  return titleizeSlug(tail) || packageId;
}

export function filterInstalledPackages(
  rows: readonly InstalledPackage[],
  query: string,
  updatesOnly: boolean,
): InstalledPackage[] {
  const normalized = query.trim().toLowerCase();
  return rows.filter((item) => {
    if (updatesOnly && !item.latestVersion) return false;
    if (!normalized) return true;
    return [installedDisplayName(item.packageId), item.packageId, item.version, item.latestVersion]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(normalized));
  });
}

export function filterPublishedDrafts(
  rows: readonly PublishedDraft[],
  query: string,
): PublishedDraft[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...rows];
  return rows.filter((draft) =>
    [draft.title, draft.summary, draft.kind, draft.status]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(normalized)),
  );
}

export function marketSearchPlaceholder(mode: MarketMode, view: ManageView): string {
  if (mode === 'explore') return 'Search Market…';
  if (view === 'published') return 'Search submissions…';
  return 'Search installed items…';
}
