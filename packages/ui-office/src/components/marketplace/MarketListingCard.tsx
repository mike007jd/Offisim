import type { ListingSummary } from '@offisim/registry-client';
import { Star } from 'lucide-react';
import { getRarityColor } from './market-rarity.js';
import { KIND_ICON, formatInstallCount } from './marketplace-meta.js';

export interface MarketListingCardProps {
  readonly listing: ListingSummary;
  readonly onClick: (listingId: string) => void;
}

export function MarketListingCard({ listing, onClick }: MarketListingCardProps) {
  const rarity = getRarityColor(listing.kind);
  const Icon = KIND_ICON[listing.kind];

  return (
    <button
      type="button"
      onClick={() => onClick(listing.listing_id)}
      className={`group flex h-[220px] flex-col rounded-2xl border bg-surface-elevated p-5 text-left text-text-primary shadow-sm transition-all hover:bg-surface-hover ${rarity.border} ${rarity.glow}`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${rarity.badge}`}
        >
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {listing.kind}
        </span>
        <span className="ml-2 truncate text-xs text-text-muted">@{listing.creator.handle}</span>
      </div>

      <h3 className="mt-3 truncate text-base font-bold text-text-primary">{listing.title}</h3>
      <p className="mt-1 line-clamp-2 flex-1 text-sm leading-relaxed text-text-secondary">
        {listing.summary}
      </p>

      <div className="mt-auto flex items-center gap-4 pt-3 text-xs text-text-secondary">
        <span className="inline-flex items-center gap-1">
          <Star className="h-3.5 w-3.5 fill-current text-warning" />
          {listing.rating.toFixed(1)}
        </span>
        <span>{formatInstallCount(listing.install_count)} installs</span>
      </div>
    </button>
  );
}
