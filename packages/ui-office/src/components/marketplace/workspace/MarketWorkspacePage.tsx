import type { AssetKind } from '@offisim/asset-schema';
import { ToastBanner, useToasts } from '@offisim/ui-core';
import { useCallback, useEffect, useRef } from 'react';
import type { MarketSortOption } from '../marketplace-meta.js';

export type { MarketSortOption } from '../marketplace-meta.js';
import { useListingDetail } from '../../../hooks/useListingDetail.js';
import { WorkspacePageShell } from '../../workspace/WorkspacePageShell.js';
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
  sort: MarketSortOption;
  kind: AssetKind | 'all';
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
  const { toasts, addToast, dismissToast } = useToasts();

  // Single source of truth for listing detail — shared with ContextPane and Detail
  const activeListingId = sessionState.mode === 'explore' ? sessionState.selectedListingId : null;
  const {
    detail,
    loading: detailLoading,
    unavailable: detailUnavailable,
  } = useListingDetail(activeListingId);
  const lastUnavailableListingIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeListingId || !detailUnavailable) {
      lastUnavailableListingIdRef.current = null;
      return;
    }

    if (lastUnavailableListingIdRef.current === activeListingId) return;

    lastUnavailableListingIdRef.current = activeListingId;
    addToast('The selected listing is no longer available.', 'info');
  }, [activeListingId, detailUnavailable, addToast]);

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
    (sort: MarketSortOption) => {
      onSessionStateChange({ ...sessionState, sort });
    },
    [sessionState, onSessionStateChange],
  );

  const handleKindChange = useCallback(
    (kind: AssetKind | 'all') => {
      onSessionStateChange({ ...sessionState, kind });
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
    onSessionStateChange({ ...sessionState, search: '', sort: 'relevance', kind: 'all' });
  }, [sessionState, onSessionStateChange]);

  const handleInstall = useCallback(
    (listingId: string, version: string) => {
      onStartInstall?.(listingId, version);
    },
    [onStartInstall],
  );

  const handleGoToExplore = useCallback(() => {
    onSessionStateChange({ ...sessionState, mode: 'explore', selectedListingId: null });
  }, [sessionState, onSessionStateChange]);

  // Determine center pane content
  const showDetail = sessionState.mode === 'explore' && sessionState.selectedListingId !== null;
  const showExplore = sessionState.mode === 'explore' && !showDetail;
  const showManage = sessionState.mode === 'manage';

  return (
    <WorkspacePageShell
      title="Market"
      workspace="market"
      testId="workspace-market"
      topSlot={<ToastBanner toasts={toasts} onDismiss={dismissToast} />}
    >
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
            kind={sessionState.kind}
            onModeChange={handleModeChange}
            onManageTabChange={handleManageTabChange}
            onSearchChange={handleSearchChange}
            onSortChange={handleSortChange}
            onKindChange={handleKindChange}
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
              kind={sessionState.kind}
              onSelectListing={handleSelectListing}
              onResetFilters={handleResetFilters}
            />
          ) : null}

          {showDetail ? (
            <MarketWorkspaceDetail
              // biome-ignore lint/style/noNonNullAssertion: showDetail guards non-null
              listingId={sessionState.selectedListingId!}
              detail={detail}
              detailLoading={detailLoading}
              detailUnavailable={detailUnavailable}
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
            detail={detail}
            loading={detailLoading}
            unavailable={detailUnavailable}
          />
        </aside>
      </div>
    </WorkspacePageShell>
  );
}

export default MarketWorkspacePage;
