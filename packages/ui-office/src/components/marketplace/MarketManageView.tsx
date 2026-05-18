import { Button } from '@offisim/ui-core';
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
    <div className="flex h-full flex-col">
      {manageTab === 'updates' && (
        <div className="px-3 pb-1 pt-3">
          <p className="text-caption uppercase tracking-[0.2em] text-text-muted">
            Packages with available updates
          </p>
        </div>
      )}
      <InstalledList onStartInstall={onStartInstall} />
      <div className="flex justify-center px-4 pb-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onGoToExplore}
          className="bg-surface-muted text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
        >
          Browse Explore
        </Button>
      </div>
    </div>
  );
}
