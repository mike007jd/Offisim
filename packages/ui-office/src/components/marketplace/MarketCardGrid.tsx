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

const GRID_CLASS = 'market-card-grid';

function SkeletonCard() {
  return (
    <div className="market-card-skeleton">
      <div className="market-card-skeleton-cover">
        <Skeleton className="market-card-skeleton-avatar" />
        <div className="market-card-skeleton-cover-lines">
          <div className="market-card-skeleton-cover-row">
            <Skeleton className="market-card-skeleton-line" data-size="short" />
            <Skeleton className="market-card-skeleton-line" data-size="chip" />
          </div>
          <Skeleton className="market-card-skeleton-line" data-size="long" />
        </div>
      </div>
      <div className="market-card-skeleton-body">
        <Skeleton className="market-card-skeleton-line" data-size="full" />
        <Skeleton className="market-card-skeleton-line" data-size="medium" />
        <div className="market-card-skeleton-stats">
          <Skeleton className="market-card-skeleton-line" data-size="stat" />
          <Skeleton className="market-card-skeleton-line" data-size="stat-wide" />
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
      <div ref={sentinelRef} className="market-card-grid-sentinel" />

      {isLoadingMore && (
        <div className="market-card-grid-loading">
          <Loader2 data-icon="loading" />
        </div>
      )}
    </div>
  );
}
