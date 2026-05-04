import { InstalledList } from './InstalledList.js';
import { PublishedDraftsList } from './PublishedDraftsList.js';

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
    return <PublishedDraftsList />;
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
