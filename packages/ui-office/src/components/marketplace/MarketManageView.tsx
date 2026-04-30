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
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border-default bg-surface-muted">
          <Store className="h-5 w-5 text-text-muted" />
        </div>
        <p className="text-sm font-semibold text-text-primary">Published packages</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {manageTab === 'updates' && (
        <div className="px-3 pt-3 pb-1">
          <p className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
            Packages with available updates
          </p>
        </div>
      )}
      <InstalledList onStartInstall={onStartInstall} />
      <div className="px-4 pb-4 flex justify-center">
        <button
          type="button"
          onClick={onGoToExplore}
          className="rounded-lg border border-border-default bg-surface-muted px-3 py-1.5 text-xs text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
        >
          Browse Explore
        </button>
      </div>
    </div>
  );
}
