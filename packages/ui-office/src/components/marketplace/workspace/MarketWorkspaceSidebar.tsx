import type { AssetKind } from '@offisim/asset-schema';
import { Button } from '@offisim/ui-core';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { pillClass } from '../../../lib/sop-utils.js';
import { PublishDialog } from '../PublishDialog.js';
import type { MarketSortOption } from '../marketplace-meta.js';
import { KIND_FILTERS, KIND_ICON, SORT_OPTIONS } from '../marketplace-meta.js';

export interface MarketWorkspaceSidebarProps {
  mode: 'explore' | 'manage';
  manageTab: 'installed' | 'updates' | 'published';
  search: string;
  sort: MarketSortOption;
  kind: AssetKind | 'all';
  onModeChange: (mode: 'explore' | 'manage') => void;
  onManageTabChange: (tab: 'installed' | 'updates' | 'published') => void;
  onSearchChange: (search: string) => void;
  onSortChange: (sort: MarketSortOption) => void;
  onKindChange: (kind: AssetKind | 'all') => void;
  onStartInstall: (listingId: string, version: string) => void;
}

export function MarketWorkspaceSidebar({
  mode,
  manageTab,
  search,
  sort,
  kind,
  onModeChange,
  onManageTabChange,
  onSearchChange,
  onSortChange,
  onKindChange,
  onStartInstall: _onStartInstall,
}: MarketWorkspaceSidebarProps) {
  const [publishOpen, setPublishOpen] = useState(false);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <button
          type="button"
          className={pillClass(mode === 'explore')}
          onClick={() => onModeChange('explore')}
        >
          Explore
        </button>
        <button
          type="button"
          className={pillClass(mode === 'manage')}
          onClick={() => onModeChange('manage')}
        >
          Manage
        </button>
        <div className="flex-1" />
        <Button type="button" size="sm" onClick={() => setPublishOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Publish
        </Button>
      </div>

      {mode === 'explore' ? (
        <>
          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search packages…"
                className="w-full bg-white/5 border border-white/10 rounded-md pl-6 pr-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/40"
              />
            </div>
          </div>

          <div className="px-3 pb-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1.5">Kind</p>
            <div className="flex flex-wrap gap-1.5">
              {KIND_FILTERS.map((filter) => {
                const Icon = filter.value === 'all' ? null : KIND_ICON[filter.value];
                const active = kind === filter.value;
                return (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => onKindChange(filter.value)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                      active
                        ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100'
                        : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200'
                    }`}
                  >
                    {Icon ? <Icon className="h-3 w-3" /> : null}
                    {filter.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="px-3 pb-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1.5">Sort</p>
            <div className="flex flex-wrap gap-1.5">
              {SORT_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSortChange(s)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                    sort === s
                      ? 'border-blue-400/40 bg-blue-500/10 text-blue-100'
                      : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="px-3 pb-2 flex flex-col gap-1">
          {(['installed', 'updates', 'published'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors capitalize ${
                manageTab === tab
                  ? 'bg-blue-500/10 text-blue-200 border border-blue-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
              onClick={() => onManageTabChange(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      )}

      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} />
    </div>
  );
}
