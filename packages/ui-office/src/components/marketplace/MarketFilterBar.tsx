import type { AssetKind } from '@offisim/asset-schema';
import { useFocusTrap, useRegisterModal, useTopmostEscape } from '@offisim/ui-core';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { KIND_FILTERS, type MarketSortOption, SORT_OPTIONS } from './marketplace-meta.js';

export interface MarketFilterBarProps {
  readonly mode: 'explore' | 'manage';
  readonly search: string;
  readonly sort: MarketSortOption;
  readonly kind: AssetKind | 'all';
  readonly manageTab: 'installed' | 'updates' | 'published';
  readonly onModeChange: (mode: 'explore' | 'manage') => void;
  readonly onSearchChange: (search: string) => void;
  readonly onSortChange: (sort: MarketSortOption) => void;
  readonly onKindChange: (kind: AssetKind | 'all') => void;
  readonly onManageTabChange: (tab: 'installed' | 'updates' | 'published') => void;
  readonly onPublishClick: () => void;
  readonly variant?: 'default' | 'narrow';
}

const MANAGE_TABS = ['installed', 'updates', 'published'] as const;

export function MarketFilterBar({
  mode,
  search,
  sort,
  kind,
  manageTab,
  onModeChange,
  onSearchChange,
  onSortChange,
  onKindChange,
  onManageTabChange,
  onPublishClick,
  variant = 'default',
}: MarketFilterBarProps) {
  const sheetStackId = 'market-filter-sheet';
  const sheetRef = useRef<HTMLDivElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const narrow = variant === 'narrow';
  const narrowSheetOpen = narrow && sheetOpen;

  useRegisterModal(narrowSheetOpen ? sheetStackId : null, 'overlay');
  useTopmostEscape(narrowSheetOpen ? sheetStackId : null, () => setSheetOpen(false), {
    enabled: narrowSheetOpen,
  });
  useFocusTrap(sheetRef, narrowSheetOpen);

  const controls = (
    <>
      {/* Kind filter — explore only */}
      {mode === 'explore' && (
        <select
          value={kind}
          onChange={(e) => onKindChange(e.target.value as AssetKind | 'all')}
          className="h-9 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-slate-300 focus:outline-none"
        >
          {KIND_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      )}

      {/* Sort — explore only */}
      {mode === 'explore' && (
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as MarketSortOption)}
          className="h-9 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-slate-300 focus:outline-none"
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      )}

      {/* Mode toggle */}
      <div className="flex overflow-hidden rounded-lg border border-white/10">
        <button
          type="button"
          onClick={() => onModeChange('explore')}
          className={`px-3 py-1.5 text-sm transition-colors ${
            mode === 'explore' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          Explore
        </button>
        <button
          type="button"
          onClick={() => onModeChange('manage')}
          className={`px-3 py-1.5 text-sm transition-colors ${
            mode === 'manage' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          Manage
        </button>
      </div>

      {/* Publish — explore only */}
      {mode === 'explore' && (
        <button
          type="button"
          onClick={onPublishClick}
          className="h-9 rounded-lg bg-white/[0.06] px-4 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10"
        >
          Publish
        </button>
      )}
    </>
  );

  return (
    <div className="shrink-0 border-b border-white/10">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search packages..."
            className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-white/20 focus:outline-none"
          />
        </div>

        {narrow ? (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300"
            aria-label="Open market filters"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        ) : (
          controls
        )}
      </div>

      {sheetOpen && narrow && (
        <div className="fixed inset-0 z-modal flex items-end bg-black/50">
          <div
            ref={sheetRef}
            className="w-full rounded-t-2xl border-t border-white/10 bg-slate-950 p-4 shadow-modal"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Market filters</div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-300"
                aria-label="Close market filters"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3">{controls}</div>
          </div>
        </div>
      )}

      {/* Manage sub-tabs */}
      {mode === 'manage' && (
        <div className="flex gap-1 px-6 pb-2">
          {MANAGE_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onManageTabChange(tab)}
              className={`rounded-lg px-3 py-1 text-sm capitalize transition-colors ${
                manageTab === tab ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
