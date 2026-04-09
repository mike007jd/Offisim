import type { AssetKind } from '@offisim/asset-schema';
import { Button } from '@offisim/ui-core';
import { useEffect } from 'react';
import { useMarketplace } from '../../../hooks/useMarketplace.js';
import { ListingCard } from '../ListingCard.js';
import type { MarketSortOption } from '../marketplace-meta.js';

export interface MarketWorkspaceExploreProps {
  search: string;
  sort: MarketSortOption;
  kind: AssetKind | 'all';
  onSelectListing: (listingId: string) => void;
  onResetFilters: () => void;
}

export function MarketWorkspaceExplore({
  search,
  sort,
  kind,
  onSelectListing,
  onResetFilters,
}: MarketWorkspaceExploreProps) {
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

  useEffect(() => {
    if (query !== search) setQuery(search);
  }, [search, query, setQuery]);

  useEffect(() => {
    if (mFilters.kind !== kind) setKind(kind);
  }, [kind, mFilters.kind, setKind]);

  useEffect(() => {
    if (mFilters.sort !== sort) setSort(sort);
  }, [sort, mFilters.sort, setSort]);

  if (error) {
    return (
      <div className="flex items-center justify-center p-8 h-full">
        <div className="relative max-w-md rounded-xl border border-red-400/20 bg-red-500/[0.06] p-5 text-sm text-red-200 overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-red-400" />
          <p className="pl-3">Marketplace unavailable. Check connection and retry.</p>
          {error && (
            <p className="mt-2 pl-3 font-mono text-[11px] text-red-300/60 break-words">{error}</p>
          )}
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 h-full">
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <p className="text-sm text-slate-500">Loading marketplace…</p>
        </div>
      </div>
    );
  }

  if (!isLoading && results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center h-full">
        <p className="text-sm text-slate-400">No packages match filters</p>
        <Button type="button" variant="outline" size="sm" onClick={onResetFilters}>
          Reset
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 p-5">
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
