/**
 * Legacy overlay kept for deep-link installs (offisim://install?listing_id=X).
 * Wraps MarketDetailView in a full-screen overlay.
 */
import { X } from 'lucide-react';
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur-sm">
      <div className="flex h-12 items-center justify-end px-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
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
        />
      </div>
    </div>
  );
}
