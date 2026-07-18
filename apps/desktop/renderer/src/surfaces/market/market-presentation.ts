import {
  INSTALLABLE_KINDS,
  type InstalledPackage,
  type ListingKind,
  type ManageView,
  type MarketListing,
  type MarketMode,
  type PublishedDraft,
  type RegistryConnectionState,
} from '@/data/market/types.js';
import { titleizeSlug } from '@/lib/utils.js';

export interface RarityTone {
  /** rarity color token reference. */
  rc: string;
  rcs: string;
}

/** 1:1 with prototype getRarityColor(kind). */
export function getRarityTone(kind: ListingKind): RarityTone {
  switch (kind) {
    case 'employee':
      return { rc: 'var(--off-accent)', rcs: 'var(--off-accent-surface)' };
    case 'skill':
      return { rc: 'var(--off-violet)', rcs: 'var(--off-violet-surface)' };
    case 'template':
      return { rc: 'var(--off-violet)', rcs: 'var(--off-violet-surface)' };
    case 'layout':
      return { rc: 'var(--off-danger)', rcs: 'var(--off-danger-surface)' };
    case 'prefab':
      return { rc: 'var(--off-warn)', rcs: 'var(--off-warn-surface)' };
    default:
      return { rc: 'var(--off-ink-3)', rcs: 'var(--off-surface-sunken)' };
  }
}

export function compactInstalls(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function canInstallListing(listing: MarketListing): boolean {
  // Require a usable install route, not just an artifact URL: a registry
  // listing whose artifact lacks a packageVersionId has installSource
  // undefined and the install flow rejects it, so it must render the locked
  // state rather than an Install button that always errors.
  return (
    INSTALLABLE_KINDS.has(listing.kind) &&
    Boolean(listing.installArtifactUrl) &&
    Boolean(listing.installSource)
  );
}

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
