import type { MarketListingInstalledPayload, RuntimeEvent, SkillRow } from '@offisim/shared-types';
import { useEffect, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import { useOffisimRuntime } from '../runtime/offisim-runtime-context.js';

/**
 * Set of marketplace `listingId`s that the active company already has
 * installed on the local device. Drives Market UI's per-company `Installed`
 * affordances (detail view button, card badge) so the user immediately sees
 * the result of an install without needing to refresh or re-navigate.
 *
 * The set is computed from two persistence sources:
 * - `installedPackages` rows where `origin_listing_id` is non-null (employee
 *   listings — `MaterializeResult` writes this)
 * - `skills` rows from a marketplace source (Skill listings — `installSkill`
 *   stores `source_kind='installed'` + `source_ref=listingId` for the
 *   marketplace branch)
 *
 * The hook is event-driven: a single subscription to `market.listing-installed`
 * incrementally adds entries when the active-company guard matches, avoiding
 * the cost of a full `listByCompany` re-query on every install.
 */
export interface UseInstalledListingsResult {
  /** Listing IDs already installed under the active company. */
  readonly installedListingIds: ReadonlySet<string>;
  /**
   * `package_id::version` keys for each installed package. Survives catalog
   * re-seeds where listing_id rotates but package_id stays stable. Consumers
   * should match on EITHER `installedListingIds.has(listing.listing_id)` OR
   * `installedPackageKeys.has(`${listing.package_id}::${listing.latest_version}`)`.
   */
  readonly installedPackageKeys: ReadonlySet<string>;
  /** False until the initial DB load resolves, true thereafter. */
  readonly isReady: boolean;
}

export function packageInstallKey(packageId: string, version: string): string {
  return `${packageId}::${version}`;
}

const NON_MARKETPLACE_REF_PREFIXES = ['git:', 'upload:', 'claude-code:', 'codex:'] as const;

function isMarketplaceSkillRow(row: SkillRow): boolean {
  if (row.source_kind !== 'installed') return false;
  if (!row.source_ref) return false;
  return !NON_MARKETPLACE_REF_PREFIXES.some((p) => row.source_ref?.startsWith(p));
}

export function useInstalledListings(): UseInstalledListingsResult {
  const { repos, eventBus } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const [installedListingIds, setInstalledListingIds] = useState<ReadonlySet<string>>(new Set());
  const [installedPackageKeys, setInstalledPackageKeys] = useState<ReadonlySet<string>>(new Set());
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsReady(false);
    setInstalledListingIds(new Set());
    setInstalledPackageKeys(new Set());

    if (!repos || !activeCompanyId) {
      setIsReady(true);
      return;
    }

    let cancelled = false;

    void (async () => {
      const nextListingIds = new Set<string>();
      const nextPackageKeys = new Set<string>();
      try {
        const installed = await repos.installedPackages.listByCompany(activeCompanyId);
        for (const pkg of installed) {
          if (pkg.origin_listing_id) nextListingIds.add(pkg.origin_listing_id);
          nextPackageKeys.add(packageInstallKey(pkg.package_id, pkg.version));
        }
      } catch (err) {
        console.warn('[useInstalledListings] installedPackages.listByCompany failed', err);
      }

      if (repos.skills) {
        try {
          const rows = await repos.skills.listByCompany(activeCompanyId);
          for (const row of rows) {
            if (isMarketplaceSkillRow(row) && row.source_ref) {
              nextListingIds.add(row.source_ref);
            }
          }
        } catch (err) {
          console.warn('[useInstalledListings] skills.listByCompany failed', err);
        }
      }

      if (cancelled) return;
      setInstalledListingIds(nextListingIds);
      setInstalledPackageKeys(nextPackageKeys);
      setIsReady(true);
    })();

    const unsubscribe = eventBus.on(
      'market.listing-installed',
      (event: RuntimeEvent<MarketListingInstalledPayload>) => {
        if (event.companyId !== activeCompanyId) return;
        const listingId = event.payload.listingId;
        if (listingId) {
          setInstalledListingIds((prev) => {
            if (prev.has(listingId)) return prev;
            const next = new Set(prev);
            next.add(listingId);
            return next;
          });
        }
        const pkgKey =
          event.payload.packageId && event.payload.version
            ? packageInstallKey(event.payload.packageId, event.payload.version)
            : null;
        if (pkgKey) {
          setInstalledPackageKeys((prev) => {
            if (prev.has(pkgKey)) return prev;
            const next = new Set(prev);
            next.add(pkgKey);
            return next;
          });
        }
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [repos, eventBus, activeCompanyId]);

  return { installedListingIds, installedPackageKeys, isReady };
}
