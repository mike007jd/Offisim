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
        <div className="max-w-lg rounded-2xl border border-rose-400/20 bg-rose-500/10 p-5 text-sm leading-relaxed text-rose-100">
          Marketplace is unavailable right now. Check the connection and retry.
          <div className="mt-3 font-mono text-xs text-rose-200/80 break-words">{error}</div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 h-full">
        <p className="text-base text-slate-500">Loading marketplace…</p>
      </div>
    );
  }

  if (!isLoading && results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center h-full">
        <p className="text-base font-semibold text-slate-200">No packages match this view</p>
        <p className="text-sm leading-relaxed text-slate-500">
          Try a broader search or switch the asset filter.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onResetFilters}>
          Reset filters
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5 p-6">
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
