import type { AssetKind } from '@offisim/asset-schema';
import { Button } from '@offisim/ui-core';
import { useEffect } from 'react';
import { useMarketplace } from '../../../hooks/useMarketplace.js';
import { ListingCard } from '../ListingCard.js';

export interface MarketWorkspaceExploreProps {
  search: string;
  sort: string;
  filters: string[];
  onSelectListing: (listingId: string) => void;
  onResetFilters: () => void;
}

export function MarketWorkspaceExplore({
  search,
  sort,
  filters,
  onSelectListing,
  onResetFilters,
}: MarketWorkspaceExploreProps) {
  const activeKind = (filters[0] as AssetKind | 'all') ?? 'all';
  const sortVal = (sort || 'relevance') as 'relevance' | 'newest' | 'rating' | 'installs';

  const {
    query,
    setQuery,
    filters: mFilters,
    setKind,
    setSort,
    results,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
  } = useMarketplace();

  // Sync external session state into the hook
  useEffect(() => {
    if (query !== search) setQuery(search);
  }, [search, query, setQuery]);

  useEffect(() => {
    if (mFilters.kind !== activeKind) setKind(activeKind);
  }, [activeKind, mFilters.kind, setKind]);

  useEffect(() => {
    if (mFilters.sort !== sortVal) setSort(sortVal);
  }, [sortVal, mFilters.sort, setSort]);

  if (error) {
    return (
      <div className="p-4">
        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-3 text-xs leading-relaxed text-rose-100">
          Marketplace is unavailable right now. Check the connection and retry.
          <div className="mt-2 font-mono text-[10px] text-rose-200/80 break-words">{error}</div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-slate-500">Loading marketplace…</p>
      </div>
    );
  }

  if (!isLoading && results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <p className="text-sm font-semibold text-slate-200">No packages match this view</p>
        <p className="text-xs leading-relaxed text-slate-500">
          Try a broader search or switch the asset filter.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onResetFilters}>
          Reset filters
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      {results.map((listing) => (
        <ListingCard key={listing.listing_id} listing={listing} onOpen={onSelectListing} />
      ))}

      {hasMore ? (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={isLoadingMore}
          onClick={loadMore}
        >
          {isLoadingMore ? 'Loading more…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}
