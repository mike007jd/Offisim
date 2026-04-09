import type { AssetKind } from '@offisim/asset-schema';
import { ToastBanner, useToasts } from '@offisim/ui-core';
import { Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketSortOption } from '../marketplace-meta.js';
import { KIND_FILTERS, KIND_ICON, SORT_OPTIONS } from '../marketplace-meta.js';

export type { MarketSortOption } from '../marketplace-meta.js';
import { useListingDetail } from '../../../hooks/useListingDetail.js';
import { PublishDialog } from '../PublishDialog.js';
import { MarketWorkspaceDetail } from './MarketWorkspaceDetail.js';
import { MarketWorkspaceExplore } from './MarketWorkspaceExplore.js';
import { MarketWorkspaceManage } from './MarketWorkspaceManage.js';

// ---------------------------------------------------------------------------
// Types -- mirrored from apps/web workspace types to avoid cross-package deps
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
  onSessionStateChange: (updater: (prev: MarketSessionState) => MarketSessionState) => void;
  onStartInstall?: (listingId: string, version: string) => void;
}

// ---------------------------------------------------------------------------
// Rarity-colored chip helper for kind filters
// ---------------------------------------------------------------------------

const KIND_CHIP_ACTIVE: Record<string, string> = {
  all: 'border-white/20 bg-white/10 text-white',
  employee: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300',
  skill: 'border-violet-400/40 bg-violet-500/15 text-violet-300',
  sop: 'border-amber-400/40 bg-amber-500/15 text-amber-300',
  company_template: 'border-cyan-400/40 bg-cyan-500/15 text-cyan-300',
  office_layout: 'border-rose-400/40 bg-rose-500/15 text-rose-300',
  prefab: 'border-orange-400/40 bg-orange-500/15 text-orange-300',
  bundle: 'border-sky-400/40 bg-sky-500/15 text-sky-300',
};

// ---------------------------------------------------------------------------
// MarketWorkspacePage
// ---------------------------------------------------------------------------

export function MarketWorkspacePage({
  sessionState,
  onSessionStateChange,
  onStartInstall,
}: MarketWorkspacePageProps) {
  const { toasts, addToast, dismissToast } = useToasts();
  const [publishOpen, setPublishOpen] = useState(false);

  // Single source of truth for listing detail -- shared with Detail view
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
      onSessionStateChange((prev) => ({ ...prev, mode, selectedListingId: null }));
    },
    [onSessionStateChange],
  );

  const handleManageTabChange = useCallback(
    (manageTab: 'installed' | 'updates' | 'published') => {
      onSessionStateChange((prev) => ({ ...prev, manageTab }));
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

  const handleSelectListing = useCallback(
    (listingId: string) => {
      onSessionStateChange((prev) => ({ ...prev, selectedListingId: listingId }));
    },
    [onSessionStateChange],
  );

  const handleBack = useCallback(() => {
    onSessionStateChange((prev) => ({ ...prev, selectedListingId: null }));
  }, [onSessionStateChange]);

  const handleResetFilters = useCallback(() => {
    onSessionStateChange((prev) => ({
      ...prev,
      search: '',
      sort: 'relevance',
      kind: 'all',
    }));
  }, [onSessionStateChange]);

  const handleInstall = useCallback(
    (listingId: string, version: string) => {
      onStartInstall?.(listingId, version);
    },
    [onStartInstall],
  );

  const handleGoToExplore = useCallback(() => {
    onSessionStateChange((prev) => ({
      ...prev,
      mode: 'explore',
      selectedListingId: null,
    }));
  }, [onSessionStateChange]);

  // Determine main content
  const showDetail = sessionState.mode === 'explore' && sessionState.selectedListingId !== null;
  const showExplore = sessionState.mode === 'explore' && !showDetail;
  const showManage = sessionState.mode === 'manage';

  return (
    <div className="flex h-full flex-col" data-testid="workspace-market" data-workspace="market">
      <ToastBanner toasts={toasts} onDismiss={dismissToast} />
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} />

      {/* ── Top toolbar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2.5">
        {/* Mode toggle — segmented control */}
        <div className="mr-2 flex items-center overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.02]">
          <button
            type="button"
            onClick={() => handleModeChange('explore')}
            className={`relative px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wider transition-colors ${
              sessionState.mode === 'explore'
                ? 'bg-white/[0.08] text-white'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {sessionState.mode === 'explore' && (
              <div className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-cyan-400" />
            )}
            Explore
          </button>
          <div className="h-5 w-px bg-white/[0.06]" />
          <button
            type="button"
            onClick={() => handleModeChange('manage')}
            className={`relative px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wider transition-colors ${
              sessionState.mode === 'manage'
                ? 'bg-white/[0.08] text-white'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {sessionState.mode === 'manage' && (
              <div className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-cyan-400" />
            )}
            Manage
          </button>
        </div>

        {sessionState.mode === 'explore' && (
          <>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={sessionState.search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search items..."
                className="w-44 rounded-lg border border-white/[0.08] bg-white/[0.04] py-1.5 pl-8 pr-3 text-[12px] text-slate-200 placeholder:text-slate-600 focus:border-cyan-400/30 focus:outline-none"
              />
            </div>

            {/* Kind filter chips — rarity colored when active */}
            <div className="flex items-center gap-1">
              {KIND_FILTERS.map((filter) => {
                const Icon = filter.value === 'all' ? null : KIND_ICON[filter.value];
                const active = sessionState.kind === filter.value;
                const activeClass = KIND_CHIP_ACTIVE[filter.value] ?? KIND_CHIP_ACTIVE.all;
                return (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => handleKindChange(filter.value)}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-all ${
                      active
                        ? activeClass
                        : 'border-white/[0.06] text-slate-500 hover:border-white/[0.12] hover:text-slate-300'
                    }`}
                  >
                    {Icon && <Icon className="h-3 w-3" />}
                    {filter.label}
                  </button>
                );
              })}
            </div>

            {/* Sort */}
            <select
              value={sessionState.sort}
              onChange={(e) => handleSortChange(e.target.value as MarketSortOption)}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-[11px] text-slate-300 focus:outline-none"
            >
              {SORT_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </>
        )}

        {sessionState.mode === 'manage' && (
          <div className="flex items-center gap-1">
            {(['installed', 'updates', 'published'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => handleManageTabChange(tab)}
                className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold capitalize transition-colors ${
                  sessionState.manageTab === tab
                    ? 'border-blue-400/30 bg-blue-500/15 text-blue-200'
                    : 'border-white/[0.06] text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setPublishOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-[12px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20"
        >
          <Plus className="h-3.5 w-3.5" /> Publish
        </button>
      </div>

      {/* Divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

      {/* ── Main content ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {showExplore && (
          <MarketWorkspaceExplore
            search={sessionState.search}
            sort={sessionState.sort}
            kind={sessionState.kind}
            onSelectListing={handleSelectListing}
            onResetFilters={handleResetFilters}
          />
        )}

        {showDetail && (
          <MarketWorkspaceDetail
            // biome-ignore lint/style/noNonNullAssertion: showDetail guards non-null
            listingId={sessionState.selectedListingId!}
            detail={detail}
            detailLoading={detailLoading}
            detailUnavailable={detailUnavailable}
            onBack={handleBack}
            onInstall={handleInstall}
          />
        )}

        {showManage && (
          <MarketWorkspaceManage
            manageTab={sessionState.manageTab}
            onStartInstall={handleInstall}
            onGoToExplore={handleGoToExplore}
          />
        )}
      </div>
    </div>
  );
}

export default MarketWorkspacePage;
