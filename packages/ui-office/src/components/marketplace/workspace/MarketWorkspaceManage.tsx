import { Button } from '@offisim/ui-core';
import { Store } from 'lucide-react';
import { InstalledList } from '../InstalledList.js';

export interface MarketWorkspaceManageProps {
  manageTab: 'installed' | 'updates' | 'published';
  onStartInstall: (listingId: string, version: string) => void;
  onGoToExplore: () => void;
}

export function MarketWorkspaceManage({
  manageTab,
  onStartInstall,
  onGoToExplore,
}: MarketWorkspaceManageProps) {
  if (manageTab === 'published') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
          <Store className="h-5 w-5 text-slate-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-200">Published packages</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Published packages will appear here once the registry integration is complete.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {manageTab === 'updates' ? (
        <div className="px-3 pt-3 pb-1">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
            Packages with available updates
          </p>
        </div>
      ) : null}

      <InstalledListWithEmptyState
        onStartInstall={onStartInstall}
        onGoToExplore={onGoToExplore}
      />
    </div>
  );
}

// Wrapper that intercepts the InstalledList empty state to add a "Browse Explore" CTA
function InstalledListWithEmptyState({
  onStartInstall,
  onGoToExplore,
}: {
  onStartInstall: (listingId: string, version: string) => void;
  onGoToExplore: () => void;
}) {
  return (
    <div className="flex flex-col flex-1">
      <InstalledList onStartInstall={onStartInstall} />
      {/* The InstalledList renders its own empty state; we add a CTA below it */}
      <div className="px-4 pb-4 flex justify-center">
        <Button type="button" variant="outline" size="sm" onClick={onGoToExplore}>
          Browse Explore
        </Button>
      </div>
    </div>
  );
}
