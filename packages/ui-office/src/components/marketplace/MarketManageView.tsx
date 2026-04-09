import { Store } from 'lucide-react';
import { InstalledList } from './InstalledList.js';

export interface MarketManageViewProps {
  readonly manageTab: 'installed' | 'updates' | 'published';
  readonly onStartInstall: (listingId: string, version: string) => void;
  readonly onGoToExplore: () => void;
}

export function MarketManageView({
  manageTab,
  onStartInstall,
  onGoToExplore,
}: MarketManageViewProps) {
  if (manageTab === 'published') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
          <Store className="h-5 w-5 text-slate-500" />
        </div>
        <p className="text-sm font-semibold text-slate-200">Published packages</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {manageTab === 'updates' && (
        <div className="px-3 pt-3 pb-1">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
            Packages with available updates
          </p>
        </div>
      )}
      <InstalledList onStartInstall={onStartInstall} />
      <div className="px-4 pb-4 flex justify-center">
        <button
          type="button"
          onClick={onGoToExplore}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 transition"
        >
          Browse Explore
        </button>
      </div>
    </div>
  );
}
