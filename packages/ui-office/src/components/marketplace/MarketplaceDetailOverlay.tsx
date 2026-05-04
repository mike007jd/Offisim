/**
 * Legacy overlay kept for deep-link installs (offisim://install?listing_id=X).
 * Wraps MarketDetailView in a full-screen overlay.
 */
import { X } from 'lucide-react';
import { useInstalledListings } from '../../hooks/useInstalledListings.js';
import { useListingDetail } from '../../hooks/useListingDetail.js';
import { MarketDetailView } from './MarketDetailView.js';

export interface MarketplaceDetailOverlayProps {
  readonly listingId: string;
  readonly onClose: () => void;
  readonly onInstall: (listingId: string, version: string) => void;
}

export function MarketplaceDetailOverlay({
  listingId,
  onClose,
  onInstall,
}: MarketplaceDetailOverlayProps) {
  const { detail, loading, unavailable } = useListingDetail(listingId);
  const { installedListingIds, installedPackageKeys } = useInstalledListings();

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-elevated text-text-primary backdrop-blur-sm">
      <div className="flex h-12 items-center justify-end px-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <MarketDetailView
          detail={detail}
          loading={loading}
          unavailable={unavailable}
          onBack={onClose}
          onInstall={onInstall}
          installedListingIds={installedListingIds}
          installedPackageKeys={installedPackageKeys}
        />
      </div>
    </div>
  );
}
