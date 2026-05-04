import type { ListingSummary } from '@offisim/registry-client';
import { Star } from 'lucide-react';
import { getRarityColor } from './market-rarity.js';
import { INSTALLABLE_KINDS, KIND_ICON, formatInstallCount } from './marketplace-meta.js';

export interface MarketListingCardProps {
  readonly listing: ListingSummary;
  readonly onClick: (listingId: string) => void;
  readonly installed?: boolean;
}

export function MarketListingCard({ listing, onClick, installed }: MarketListingCardProps) {
  const rarity = getRarityColor(listing.kind);
  const Icon = KIND_ICON[listing.kind];
  const showInstalled = installed === true && INSTALLABLE_KINDS.has(listing.kind);
  const verification = listing.creator.verification_state;
  const cover =
    listing.preview && (listing.preview.kind === 'image' || listing.preview.kind === 'icon')
      ? listing.preview
      : null;

  return (
    <button
      type="button"
      onClick={() => onClick(listing.listing_id)}
      className={`group flex h-[260px] flex-col overflow-hidden rounded-2xl border bg-surface-elevated text-left text-text-primary shadow-sm transition-all hover:bg-surface-hover ${rarity.border} ${rarity.glow}`}
    >
      <div className="relative h-24 w-full shrink-0 overflow-hidden bg-surface-muted">
        {cover ? (
          <img
            src={cover.url}
            alt={cover.alt ?? listing.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center ${rarity.badge.replace('text-', 'bg-').split(' ')[0] ?? ''}`}
          >
            {Icon && <Icon className="h-8 w-8 opacity-50" />}
          </div>
        )}
        <span
          className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${rarity.badge}`}
        >
          {Icon && <Icon className="h-3 w-3" />}
          {listing.kind}
        </span>
        {showInstalled && (
          <span className="absolute right-3 top-3 inline-flex items-center rounded-full border border-success bg-success-muted px-2 py-0.5 text-[11px] font-medium text-success">
            Installed
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">
        <div className="flex items-center gap-1 text-xs text-text-muted">
          <span className="truncate">@{listing.creator.handle}</span>
          {verification === 'verified' || verification === 'trusted' ? (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-info"
              title={verification === 'trusted' ? 'Trusted creator' : 'Verified creator'}
            />
          ) : null}
        </div>
        <h3 className="mt-1 truncate text-sm font-bold text-text-primary">{listing.title}</h3>
        <p className="mt-1 line-clamp-2 flex-1 text-xs leading-relaxed text-text-secondary">
          {listing.summary}
        </p>

        <div className="mt-auto flex items-center gap-3 pt-2 text-[11px] text-text-secondary">
          <span className="inline-flex items-center gap-1">
            <Star className="h-3 w-3 fill-current text-warning" />
            {listing.rating.toFixed(1)}
          </span>
          <span>{formatInstallCount(listing.install_count)} installs</span>
        </div>
      </div>
    </button>
  );
}
