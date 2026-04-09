import type { ListingSummary } from '@offisim/registry-client';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { MarketListingCard } from './MarketListingCard.js';

export interface MarketCardGridProps {
  readonly results: ListingSummary[];
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly hasMore: boolean;
  readonly onSelectListing: (listingId: string) => void;
  readonly onLoadMore: () => void;
}

function SkeletonCard() {
  return (
    <div className="flex h-[220px] flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-5 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-6 w-20 rounded-full bg-white/10" />
        <div className="h-4 w-16 rounded bg-white/10" />
      </div>
      <div className="mt-3 h-5 w-3/4 rounded bg-white/10" />
      <div className="mt-2 h-4 w-full rounded bg-white/10" />
      <div className="mt-1 h-4 w-2/3 rounded bg-white/10" />
      <div className="mt-auto flex gap-4 pt-3">
        <div className="h-4 w-12 rounded bg-white/10" />
        <div className="h-4 w-16 rounded bg-white/10" />
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
        {Array.from({ length: 8 }, (_, i) => (
          <SkeletonCard key={`skeleton-${i}`} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5 p-6">
      {results.map((listing) => (
        <MarketListingCard key={listing.listing_id} listing={listing} onClick={onSelectListing} />
      ))}

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="col-span-full h-1" />

      {isLoadingMore && (
        <div className="col-span-full flex justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      )}
    </div>
  );
}
