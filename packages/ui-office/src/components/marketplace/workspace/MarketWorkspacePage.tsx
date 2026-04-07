import { ToastBanner, useToasts } from '@offisim/ui-core';
import { useCallback, useEffect, useRef } from 'react';
import { useRegistryClient } from '../../../hooks/useRegistryClient.js';
import { MarketWorkspaceContextPane } from './MarketWorkspaceContextPane.js';
import { MarketWorkspaceDetail } from './MarketWorkspaceDetail.js';
import { MarketWorkspaceExplore } from './MarketWorkspaceExplore.js';
import { MarketWorkspaceManage } from './MarketWorkspaceManage.js';
import { MarketWorkspaceSidebar } from './MarketWorkspaceSidebar.js';

// ---------------------------------------------------------------------------
// Types — mirrored from apps/web workspace types to avoid cross-package deps
// ---------------------------------------------------------------------------

export type MarketSessionState = {
  mode: 'explore' | 'manage';
  selectedListingId: string | null;
  search: string;
  sort: string;
  filters: string[];
  manageTab: 'installed' | 'updates' | 'published';
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MarketWorkspacePageProps {
  sessionState: MarketSessionState;
  onSessionStateChange: (state: MarketSessionState) => void;
  onStartInstall?: (listingId: string, version: string) => void;
}

// ---------------------------------------------------------------------------
// MarketWorkspacePage
// ---------------------------------------------------------------------------

export function MarketWorkspacePage({
  sessionState,
  onSessionStateChange,
  onStartInstall,
}: MarketWorkspacePageProps) {
  const client = useRegistryClient();
  const { toasts, addToast, dismissToast } = useToasts();

  // Deleted entity recovery: verify selected listing still exists
  const prevSelectedIdRef = useRef(sessionState.selectedListingId);

  useEffect(() => {
    const prevId = prevSelectedIdRef.current;
    prevSelectedIdRef.current = sessionState.selectedListingId;

    if (!sessionState.selectedListingId || sessionState.mode !== 'explore') return;

    // Only check if we just navigated to a listing (id changed)
    if (prevId === sessionState.selectedListingId) return;

    let cancelled = false;
    client
      .getListingDetail(sessionState.selectedListingId)
      .catch(() => {
        if (cancelled) return;
        addToast('The selected listing is no longer available.', 'info');
        onSessionStateChange({
          ...sessionState,
          selectedListingId: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [client, sessionState, onSessionStateChange, addToast]);

  // Callbacks

  const handleModeChange = useCallback(
    (mode: 'explore' | 'manage') => {
      onSessionStateChange({ ...sessionState, mode, selectedListingId: null });
    },
    [sessionState, onSessionStateChange],
  );

  const handleManageTabChange = useCallback(
    (manageTab: 'installed' | 'updates' | 'published') => {
      onSessionStateChange({ ...sessionState, manageTab });
    },
    [sessionState, onSessionStateChange],
  );

  const handleSearchChange = useCallback(
    (search: string) => {
      onSessionStateChange({ ...sessionState, search });
    },
    [sessionState, onSessionStateChange],
  );

  const handleSortChange = useCallback(
    (sort: string) => {
      onSessionStateChange({ ...sessionState, sort });
    },
    [sessionState, onSessionStateChange],
  );

  const handleFiltersChange = useCallback(
    (filters: string[]) => {
      onSessionStateChange({ ...sessionState, filters });
    },
    [sessionState, onSessionStateChange],
  );

  const handleSelectListing = useCallback(
    (listingId: string) => {
      onSessionStateChange({ ...sessionState, selectedListingId: listingId });
    },
    [sessionState, onSessionStateChange],
  );

  const handleBack = useCallback(() => {
    onSessionStateChange({ ...sessionState, selectedListingId: null });
  }, [sessionState, onSessionStateChange]);

  const handleResetFilters = useCallback(() => {
    onSessionStateChange({ ...sessionState, search: '', sort: '', filters: [] });
  }, [sessionState, onSessionStateChange]);

  const handleInstall = useCallback(
    (listingId: string, version: string) => {
      if (onStartInstall) {
        onStartInstall(listingId, version);
      }
    },
    [onStartInstall],
  );

  const handleGoToExplore = useCallback(() => {
    onSessionStateChange({ ...sessionState, mode: 'explore', selectedListingId: null });
  }, [sessionState, onSessionStateChange]);

  // Determine center pane content
  const showDetail =
    sessionState.mode === 'explore' && sessionState.selectedListingId !== null;
  const showExplore = sessionState.mode === 'explore' && !showDetail;
  const showManage = sessionState.mode === 'manage';

  return (
    <div data-workspace="market" data-testid="workspace-market" className="flex flex-col h-full">
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />

      <header className="workspace-shell-header">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="workspace-shell-eyebrow">Workspace</p>
            <h1 className="workspace-shell-title">Market</h1>
          </div>
        </div>
      </header>

      {/* 3-pane layout */}
      <div className="market-workspace-panes">
        <aside
          className="market-workspace-sidebar"
          data-testid="market-workspace-sidebar"
          aria-label="Market navigation"
        >
          <MarketWorkspaceSidebar
            mode={sessionState.mode}
            manageTab={sessionState.manageTab}
            search={sessionState.search}
            sort={sessionState.sort}
            filters={sessionState.filters}
            onModeChange={handleModeChange}
            onManageTabChange={handleManageTabChange}
            onSearchChange={handleSearchChange}
            onSortChange={handleSortChange}
            onFiltersChange={handleFiltersChange}
            onStartInstall={handleInstall}
          />
        </aside>

        <main
          className="market-workspace-canvas"
          data-testid="market-workspace-canvas"
          aria-label="Market content"
        >
          {showExplore ? (
            <MarketWorkspaceExplore
              search={sessionState.search}
              sort={sessionState.sort}
              filters={sessionState.filters}
              onSelectListing={handleSelectListing}
              onResetFilters={handleResetFilters}
            />
          ) : null}

          {showDetail ? (
            <MarketWorkspaceDetail
              // biome-ignore lint/style/noNonNullAssertion: showDetail guards non-null
              listingId={sessionState.selectedListingId!}
              onBack={handleBack}
              onInstall={handleInstall}
            />
          ) : null}

          {showManage ? (
            <MarketWorkspaceManage
              manageTab={sessionState.manageTab}
              onStartInstall={handleInstall}
              onGoToExplore={handleGoToExplore}
            />
          ) : null}
        </main>

        <aside
          className="market-workspace-context"
          data-testid="market-workspace-context"
          aria-label="Market context"
        >
          <MarketWorkspaceContextPane
            selectedListingId={
              sessionState.mode === 'explore' ? sessionState.selectedListingId : null
            }
          />
        </aside>
      </div>
    </div>
  );
}

export default MarketWorkspacePage;
