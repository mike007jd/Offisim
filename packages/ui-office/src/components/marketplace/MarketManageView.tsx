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
        <div className="px-sp-7 pb-1 pt-3">
          <p className="text-fs-meta font-semibold uppercase tracking-wide text-ink-4">
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
          className="rounded-r-md bg-surface-2 text-fs-sm text-ink-2 hover:bg-surface-sunken hover:text-ink-1"
        >
          Browse Explore
        </Button>
      </div>
    </div>
  );
}
