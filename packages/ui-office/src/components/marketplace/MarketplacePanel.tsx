import { Button, Input, Tabs, TabsContent, TabsList, TabsTrigger } from '@offisim/ui-core';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useMarketplace } from '../../hooks/useMarketplace.js';
import { InstalledList } from './InstalledList.js';
import { ListingCard } from './ListingCard.js';
import { PublishDialog } from './PublishDialog.js';
import { KIND_FILTERS, KIND_ICON } from './marketplace-meta.js';

interface MarketplacePanelProps {
  readonly onOpenListing: (listingId: string) => void;
  readonly onStartInstall: (listingId: string, version: string) => void;
}

export function MarketplacePanel({ onOpenListing, onStartInstall }: MarketplacePanelProps) {
  const {
    query,
    setQuery,
    filters,
    setKind,
    setSort,
    results,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
  } = useMarketplace();
  const [publishOpen, setPublishOpen] = useState(false);

  return (
    <>
      <Tabs defaultValue="browse" className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-white/5 px-3 py-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Marketplace</p>
            <p className="mt-1 text-sm font-semibold text-white">Browse and publish packages</p>
          </div>
          <Button type="button" size="sm" onClick={() => setPublishOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Publish
          </Button>
        </div>

        <div className="border-b border-white/5 px-3 py-3">
          <TabsList className="grid w-full grid-cols-2 bg-transparent p-0">
            <TabsTrigger value="browse" className="text-xs">
              Browse
            </TabsTrigger>
            <TabsTrigger value="installed" className="text-xs">
              Installed
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="browse" className="mt-0 flex-1 overflow-y-auto">
          <div className="space-y-4 px-3 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <Input
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search packages…"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {KIND_FILTERS.map((filter) => {
                const Icon = filter.value === 'all' ? null : KIND_ICON[filter.value];
                const active = filters.kind === filter.value;

                return (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => setKind(filter.value)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                      active
                        ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100'
                        : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200'
                    }`}
                  >
                    {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                    {filter.label}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              {(['relevance', 'newest', 'rating', 'installs'] as const).map((sort) => (
                <button
                  key={sort}
                  type="button"
                  onClick={() => setSort(sort)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    filters.sort === sort
                      ? 'border-blue-400/40 bg-blue-500/10 text-blue-100'
                      : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200'
                  }`}
                >
                  {sort}
                </button>
              ))}
            </div>

            {error ? (
              <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-3 text-xs leading-relaxed text-rose-100">
                Marketplace is unavailable right now. Check the connection and retry.
                <div className="mt-2 font-mono text-[10px] text-rose-200/80 break-words">
                  {error}
                </div>
              </div>
            ) : null}

            {isLoading ? (
              <p className="py-8 text-center text-sm text-slate-500">Loading marketplace…</p>
            ) : !error && results.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
                <p className="text-sm font-semibold text-slate-200">No packages match this view</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Try a broader search or switch the asset filter.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {results.map((listing) => (
                  <ListingCard key={listing.listing_id} listing={listing} onOpen={onOpenListing} />
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
            )}
          </div>
        </TabsContent>

        <TabsContent value="installed" className="mt-0 flex-1 overflow-y-auto">
          <InstalledList onStartInstall={onStartInstall} />
        </TabsContent>
      </Tabs>

      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} />
    </>
  );
}
