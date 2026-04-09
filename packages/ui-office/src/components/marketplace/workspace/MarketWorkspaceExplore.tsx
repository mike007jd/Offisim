import type { AssetKind } from '@offisim/asset-schema';
import { Button } from '@offisim/ui-core';
import { RefreshCw, WifiOff } from 'lucide-react';
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

  // ── Error: game-style "CONNECTION LOST" ──
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <div className="relative flex h-24 w-24 items-center justify-center">
          {/* Pulsing ring */}
          <div className="absolute inset-0 animate-ping rounded-full border-2 border-red-500/20" />
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-red-500/30 bg-red-500/[0.08]">
            <WifiOff className="h-8 w-8 text-red-400" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-lg font-black uppercase tracking-[0.25em] text-red-400">
            Connection Lost
          </p>
          <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-slate-500">
            Unable to reach the marketplace server. Check your connection and try again.
          </p>
        </div>
        {error && (
          <p className="max-w-sm text-center font-mono text-[11px] text-red-300/40 break-words">
            {error}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onResetFilters}
          className="gap-1.5 border-red-400/30 text-red-300 hover:bg-red-500/10"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    );
  }

  // ── Loading: pulsing dots ──
  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 py-20">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.3s]" />
          <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-violet-400 [animation-delay:-0.15s]" />
          <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-amber-400" />
        </div>
        <p className="text-[13px] font-medium uppercase tracking-[0.15em] text-slate-500">
          Loading Item Shop...
        </p>
      </div>
    );
  }

  // ── Empty: "No items in shop" ──
  if (!isLoading && results.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
          <span className="text-2xl">0</span>
        </div>
        <div>
          <p className="text-sm font-bold uppercase tracking-wider text-slate-300">
            No Items in Shop
          </p>
          <p className="mt-1 text-[12px] text-slate-500">
            Nothing matches your current filters. Try a different search.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onResetFilters}>
          Reset Filters
        </Button>
      </div>
    );
  }

  // ── Grid: game item shop ──
  return (
    <div className="p-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {results.map((listing) => (
          <ListingCard key={listing.listing_id} listing={listing} onOpen={onSelectListing} />
        ))}
      </div>

      {hasMore ? (
        <div className="flex justify-center py-6">
          <Button
            type="button"
            variant="outline"
            className="min-w-[200px] border-white/10 text-slate-300 hover:border-cyan-400/30 hover:text-cyan-200"
            disabled={isLoadingMore}
            onClick={loadMore}
          >
            {isLoadingMore ? 'Loading...' : 'Load More Items'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
