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
}

function SkeletonCard() {
  return (
    <div className="flex h-[220px] flex-col rounded-2xl border border-border-subtle bg-surface-elevated/50 p-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Skeleton className="mt-3 h-5 w-3/4" />
      <Skeleton className="mt-2 h-4 w-full" />
      <Skeleton className="mt-1 h-4 w-2/3" />
      <div className="mt-auto flex gap-4 pt-3">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-4 w-16" />
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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5 p-6">
        {SKELETON_CARD_KEYS.map((key) => (
          <SkeletonCard key={key} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5 p-6">
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
          />
        );
      })}

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="col-span-full h-1" />

      {isLoadingMore && (
        <div className="col-span-full flex justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
        </div>
      )}
    </div>
  );
}
