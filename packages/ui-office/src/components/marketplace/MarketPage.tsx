import type { AssetKind } from '@offisim/asset-schema';
import { ToastBanner, useToasts } from '@offisim/ui-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLayoutTier } from '../../hooks/use-layout-tier.js';
import { useInstalledListings } from '../../hooks/useInstalledListings.js';
import { useListingDetail } from '../../hooks/useListingDetail.js';
import { useMarketplace } from '../../hooks/useMarketplace.js';
import { MarketCardGrid } from './MarketCardGrid.js';
import { MarketDetailView } from './MarketDetailView.js';
import { MarketEmptyState } from './MarketEmptyState.js';
import { MarketErrorState } from './MarketErrorState.js';
import { MarketFilterBar } from './MarketFilterBar.js';
import { MarketManageView } from './MarketManageView.js';
import { PublishDialog } from './PublishDialog.js';
import type { MarketSortOption } from './marketplace-meta.js';

export type MarketSessionState = {
  mode: 'explore' | 'manage';
  selectedListingId: string | null;
  search: string;
  sort: MarketSortOption;
  kind: AssetKind | 'all';
  manageTab: 'installed' | 'updates' | 'published';
};

export interface MarketPageProps {
  readonly sessionState: MarketSessionState;
  readonly onSessionStateChange: (
    updater: (prev: MarketSessionState) => MarketSessionState,
  ) => void;
  readonly onStartInstall?: (listingId: string, version: string) => void;
}

export function MarketPage({
  sessionState,
  onSessionStateChange,
  onStartInstall,
}: MarketPageProps) {
  const { toasts, addToast, dismissToast } = useToasts();
  const { tier } = useLayoutTier();
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);

  // 7.2 — useMarketplace integration
  const {
    results,
    setQuery,
    setKind,
    setSort,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
  } = useMarketplace();

  const { installedListingIds, installedPackageKeys } = useInstalledListings();

  // Sync sessionState → hook
  useEffect(() => {
    setQuery(sessionState.search);
  }, [sessionState.search, setQuery]);

  useEffect(() => {
    setKind(sessionState.kind);
  }, [sessionState.kind, setKind]);

  useEffect(() => {
    setSort(sessionState.sort);
  }, [sessionState.sort, setSort]);

  // 7.3 — useListingDetail integration
  const activeListingId = sessionState.mode === 'explore' ? sessionState.selectedListingId : null;

  const {
    detail,
    loading: detailLoading,
    unavailable: detailUnavailable,
  } = useListingDetail(activeListingId);

  // Toast when listing becomes unavailable
  const lastUnavailableRef = useRef<string | null>(null);
  useEffect(() => {
    if (detailUnavailable && activeListingId && activeListingId !== lastUnavailableRef.current) {
      lastUnavailableRef.current = activeListingId;
      addToast('Listing unavailable', 'info');
    }
  }, [activeListingId, addToast, detailUnavailable]);

  // 7.4 — Mode switch callback
  const handleModeChange = useCallback(
    (mode: 'explore' | 'manage') => {
      onSessionStateChange((prev) => ({
        ...prev,
        mode,
        selectedListingId: mode === 'manage' ? null : prev.selectedListingId,
      }));
    },
    [onSessionStateChange],
  );

  const handleSearchChange = useCallback(
    (search: string) => {
      onSessionStateChange((prev) => ({ ...prev, search }));
    },
    [onSessionStateChange],
  );

  const handleSortChange = useCallback(
    (sort: MarketSortOption) => {
      onSessionStateChange((prev) => ({ ...prev, sort }));
    },
    [onSessionStateChange],
  );

  const handleKindChange = useCallback(
    (kind: AssetKind | 'all') => {
      onSessionStateChange((prev) => ({ ...prev, kind }));
    },
    [onSessionStateChange],
  );

  const handleManageTabChange = useCallback(
    (manageTab: 'installed' | 'updates' | 'published') => {
      onSessionStateChange((prev) => ({ ...prev, manageTab }));
    },
    [onSessionStateChange],
  );

  const handleSelectListing = useCallback(
    (listingId: string) => {
      onSessionStateChange((prev) => ({ ...prev, selectedListingId: listingId }));
    },
    [onSessionStateChange],
  );

  const handleBackToListings = useCallback(() => {
    onSessionStateChange((prev) => ({ ...prev, selectedListingId: null }));
  }, [onSessionStateChange]);

  const handleInstall = useCallback(
    (listingId: string, version: string) => {
      onStartInstall?.(listingId, version);
    },
    [onStartInstall],
  );

  // 7.6 — Reset filters
  const handleResetFilters = useCallback(() => {
    onSessionStateChange((prev) => ({
      ...prev,
      search: '',
      sort: 'relevance' as MarketSortOption,
      kind: 'all' as const,
    }));
  }, [onSessionStateChange]);

  const handleGoToExplore = useCallback(() => {
    handleModeChange('explore');
  }, [handleModeChange]);

  // Determine content to render
  const showDetail = sessionState.mode === 'explore' && sessionState.selectedListingId !== null;
  const showError = sessionState.mode === 'explore' && !showDetail && error !== null;
  const showEmpty =
    sessionState.mode === 'explore' &&
    !showDetail &&
    !showError &&
    !isLoading &&
    results.length === 0;

  return (
    <div className="flex h-full flex-col" data-layout-tier={tier}>
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />

      {/* Narrow detail is a drill-in page; tablet/desktop keep filters visible beside detail. */}
      {(!showDetail || tier !== 'narrow') && (
        <MarketFilterBar
          mode={sessionState.mode}
          search={sessionState.search}
          sort={sessionState.sort}
          kind={sessionState.kind}
          manageTab={sessionState.manageTab}
          onModeChange={handleModeChange}
          onSearchChange={handleSearchChange}
          onSortChange={handleSortChange}
          onKindChange={handleKindChange}
          onManageTabChange={handleManageTabChange}
          onPublishClick={() => setPublishDialogOpen(true)}
          variant={tier === 'narrow' ? 'narrow' : 'default'}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Explore: Detail view */}
        {showDetail && tier === 'narrow' && (
          <MarketDetailView
            detail={detail}
            loading={detailLoading}
            unavailable={detailUnavailable}
            onBack={handleBackToListings}
            onInstall={handleInstall}
            layout="narrow"
            installedListingIds={installedListingIds}
            installedPackageKeys={installedPackageKeys}
          />
        )}

        {showDetail && tier !== 'narrow' && (
          <div
            className={`grid h-full min-h-0 ${
              tier === 'desktop'
                ? 'grid-cols-[minmax(0,3fr)_minmax(380px,2fr)]'
                : 'grid-cols-[minmax(0,3fr)_minmax(340px,2fr)]'
            }`}
          >
            <div className="min-h-0 overflow-y-auto border-r border-border-default">
              <MarketCardGrid
                results={results}
                isLoading={isLoading}
                isLoadingMore={isLoadingMore}
                hasMore={hasMore}
                onSelectListing={handleSelectListing}
                onLoadMore={loadMore}
                installedListingIds={installedListingIds}
              />
            </div>
            <MarketDetailView
              detail={detail}
              loading={detailLoading}
              unavailable={detailUnavailable}
              onBack={handleBackToListings}
              onInstall={handleInstall}
              layout="panel"
              installedListingIds={installedListingIds}
            />
          </div>
        )}

        {/* Explore: Error state */}
        {showError && !showDetail && <MarketErrorState error={error} onRetry={refresh} />}

        {/* Explore: Empty state */}
        {showEmpty && (
          <MarketEmptyState
            variant="no-results"
            onAction={handleResetFilters}
            actionLabel="Reset filters"
          />
        )}

        {/* Explore: Card grid */}
        {sessionState.mode === 'explore' && !showDetail && !showError && !showEmpty && (
          <MarketCardGrid
            results={results}
            isLoading={isLoading}
            isLoadingMore={isLoadingMore}
            hasMore={hasMore}
            onSelectListing={handleSelectListing}
            onLoadMore={loadMore}
            installedListingIds={installedListingIds}
            installedPackageKeys={installedPackageKeys}
          />
        )}

        {/* Manage mode */}
        {sessionState.mode === 'manage' && (
          <MarketManageView
            manageTab={sessionState.manageTab}
            onStartInstall={handleInstall}
            onGoToExplore={handleGoToExplore}
          />
        )}
      </div>

      {/* 7.5 — PublishDialog */}
      <PublishDialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen} />
    </div>
  );
}

export default MarketPage;
