import type { AssetKind } from '@offisim/asset-schema';
import type { ListingSummary, SearchParams } from '@offisim/registry-client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRegistryClient } from './useRegistryClient.js';

const PAGE_SIZE = 12;

export interface MarketplaceFilters {
  readonly kind: AssetKind | 'all';
  readonly sort: NonNullable<SearchParams['sort']>;
}

export interface UseMarketplaceResult {
  readonly query: string;
  readonly setQuery: (value: string) => void;
  readonly filters: MarketplaceFilters;
  readonly setKind: (kind: MarketplaceFilters['kind']) => void;
  readonly setSort: (sort: MarketplaceFilters['sort']) => void;
  readonly results: ListingSummary[];
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly error: string | null;
  readonly hasMore: boolean;
  readonly loadMore: () => void;
  readonly refresh: () => void;
}

export function useMarketplace(): UseMarketplaceResult {
  const client = useRegistryClient();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filters, setFilters] = useState<MarketplaceFilters>({
    kind: 'all',
    sort: 'relevance',
  });
  const [results, setResults] = useState<ListingSummary[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is an intentional trigger for manual refresh via refresh()
  useEffect(() => {
    let cancelled = false;

    async function runSearch() {
      const loadingMore = page > 1;
      setError(null);
      if (loadingMore) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      try {
        const response = await client.searchListings({
          q: debouncedQuery || undefined,
          kind: filters.kind === 'all' ? undefined : filters.kind,
          sort: filters.sort,
          page,
          per_page: PAGE_SIZE,
        });

        if (cancelled) return;

        setResults((prev) => (page === 1 ? response.items : [...prev, ...response.items]));
        setTotal(response.total);
      } catch (err) {
        if (cancelled) return;
        const status = (err as { status?: number }).status;
        if (status === 401) {
          setError('Authentication required — browse is still available');
        } else if (status === 503) {
          setError('Marketplace service unavailable — is the platform running?');
        } else {
          setError(err instanceof Error ? err.message : 'Marketplace unavailable');
        }
        if (page === 1) {
          setResults([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    }

    void runSearch();

    return () => {
      cancelled = true;
    };
  }, [client, debouncedQuery, filters.kind, filters.sort, page, refreshToken]);

  const hasMore = useMemo(() => results.length < total, [results.length, total]);

  const setKind = useCallback((kind: MarketplaceFilters['kind']) => {
    setFilters((prev) => ({ ...prev, kind }));
    setPage(1);
  }, []);

  const setSort = useCallback((sort: MarketplaceFilters['sort']) => {
    setFilters((prev) => ({ ...prev, sort }));
    setPage(1);
  }, []);

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || !hasMore) return;
    setPage((prev) => prev + 1);
  }, [hasMore, isLoading, isLoadingMore]);

  const refresh = useCallback(() => {
    setRefreshToken((prev) => prev + 1);
  }, []);

  return {
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
    refresh,
  };
}
