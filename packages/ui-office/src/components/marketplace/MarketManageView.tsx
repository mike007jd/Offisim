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
    <div className="market-manage-view">
      {manageTab === 'updates' && (
        <div className="market-manage-heading">
          <p>Packages with available updates</p>
        </div>
      )}
      <InstalledList onStartInstall={onStartInstall} />
      <div className="market-manage-footer">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onGoToExplore}
          className="market-manage-explore"
        >
          Browse Explore
        </Button>
      </div>
    </div>
  );
}
