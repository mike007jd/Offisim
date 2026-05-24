import type { ListingSummary } from '@offisim/registry-client';
import { Skeleton } from '@offisim/ui-core';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { packageInstallKey } from '../../hooks/useInstalledListings.js';
import { MarketListingCard } from './MarketListingCard.js';

const SKELETON_CARD_KEYS = [
  'skeleton-0',
  'skeleton-1',
  'skeleton-2',
  'skeleton-3',
  'skeleton-4',
  'skeleton-5',
  'skeleton-6',
  'skeleton-7',
] as const;

export interface MarketCardGridProps {
  readonly results: ListingSummary[];
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly hasMore: boolean;
  readonly onSelectListing: (listingId: string) => void;
  readonly onLoadMore: () => void;
  readonly installedListingIds?: ReadonlySet<string>;
  /** `package_id::version` keys; survives catalog re-seed where listing_id rotates. */
  readonly installedPackageKeys?: ReadonlySet<string>;
  /** Currently open listing in the detail side-panel (renders the selected ring). */
  readonly selectedListingId?: string | null;
}

const GRID_CLASS = 'grid grid-market-card-list p-sp-7';

function SkeletonCard() {
  return (
    <div className="flex h-market-grid-card flex-col overflow-hidden rounded-r-md border border-line-soft bg-surface-1 shadow-elev-1">
      <div className="flex flex-none items-start gap-2 border-b border-line-soft px-3 pb-2 pt-3">
        <Skeleton className="size-8 rounded-r-sm" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-20 rounded-r-xs" />
            <Skeleton className="h-5 w-16 rounded-r-pill" />
          </div>
          <Skeleton className="h-5 w-3/4 rounded-r-xs" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-3 py-2.5">
        <Skeleton className="h-3 w-full rounded-r-xs" />
        <Skeleton className="h-3 w-2/3 rounded-r-xs" />
        <div className="mt-auto flex gap-1.5 pt-2">
          <Skeleton className="h-5 w-12 rounded-r-xs" />
          <Skeleton className="h-5 w-14 rounded-r-xs" />
        </div>
      </div>
    </div>
  );
}

export function MarketCardGrid({
  results,
  isLoading,
  isLoadingMore,
  hasMore,
  onSelectListing,
  onLoadMore,
  installedListingIds,
  installedPackageKeys,
  selectedListingId,
}: MarketCardGridProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;

  const handleIntersect = useCallback((entries: IntersectionObserverEntry[]) => {
    if (entries[0]?.isIntersecting && hasMoreRef.current) {
      onLoadMoreRef.current();
    }
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(handleIntersect, { threshold: 0.1 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleIntersect]);

  if (isLoading) {
    return (
      <div className={GRID_CLASS}>
        {SKELETON_CARD_KEYS.map((key) => (
          <SkeletonCard key={key} />
        ))}
      </div>
    );
  }

  return (
    <div className={GRID_CLASS}>
      {results.map((listing) => {
        const byListingId = installedListingIds?.has(listing.listing_id) ?? false;
        const byPackage =
          listing.package_id && listing.latest_version
            ? (installedPackageKeys?.has(
                packageInstallKey(listing.package_id, listing.latest_version),
              ) ?? false)
            : false;
        return (
          <MarketListingCard
            key={listing.listing_id}
            listing={listing}
            onClick={onSelectListing}
            installed={byListingId || byPackage}
            selected={selectedListingId === listing.listing_id}
          />
        );
      })}

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="col-span-full h-1" />

      {isLoadingMore && (
        <div className="col-span-full flex justify-center py-4">
          <Loader2 className="size-6 animate-spin text-ink-4" />
        </div>
      )}
    </div>
  );
}
