import type { ListingSummary } from '@offisim/registry-client';
import { Badge, Card, CardButton, cn } from '@offisim/ui-core';
import { Download, Star } from 'lucide-react';
import { rarityClassName } from './market-rarity.js';
import {
  INSTALLABLE_KINDS,
  KIND_ICON,
  formatCreatorVerificationLabel,
  formatInstallCount,
  formatMarketKindLabel,
  isVerifiedCreator,
} from './marketplace-meta.js';

export interface MarketListingCardProps {
  readonly listing: ListingSummary;
  readonly onClick: (listingId: string) => void;
  readonly installed?: boolean;
  readonly selected?: boolean;
  readonly featured?: boolean;
}

export function MarketListingCard({
  listing,
  onClick,
  installed,
  selected,
  featured,
}: MarketListingCardProps) {
  const Icon = KIND_ICON[listing.kind];
  const showInstalled = installed === true && INSTALLABLE_KINDS.has(listing.kind);
  const verification = listing.creator.verification_state;
  const verified = isVerifiedCreator(verification);
  const kindLabel = formatMarketKindLabel(listing.kind);

  return (
    <Card
      className={cn(
        'group relative h-market-listing-card overflow-hidden rounded-r-md bg-surface-1 p-0 shadow-elev-1 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-line-strong hover:shadow-elev-2',
        rarityClassName(listing.kind),
        featured && 'col-span-2',
        selected ? 'market-rarity-border' : 'border-line-soft',
      )}
    >
      <CardButton
        aria-label={`Open ${listing.title}`}
        onClick={() => onClick(listing.listing_id)}
        selected={selected}
      />

      <div className="pointer-events-none flex h-full flex-col overflow-hidden">
        <span
          className="market-rarity-stripe pointer-events-none absolute inset-x-0 top-0 z-elevated h-1 opacity-90"
          aria-hidden="true"
        />

        <div className="flex min-w-0 items-start gap-2 border-b border-line-soft px-3 pb-2 pt-3">
          <span
            className="market-rarity-tile grid size-8 flex-none place-items-center rounded-r-sm border bg-surface-2"
            aria-hidden="true"
          >
            {Icon && <Icon className="size-4" />}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                {showInstalled && (
                  <Badge variant="success" size="xs" className="h-5 shrink-0 rounded-r-pill px-2">
                    Installed
                  </Badge>
                )}
                <span className="truncate font-mono text-fs-meta font-semibold text-ink-4">
                  @{listing.creator.handle}
                </span>
              </div>
              <Badge
                variant="outline"
                size="xs"
                className="market-rarity-chip h-5 max-w-28 shrink-0 gap-1 truncate rounded-r-pill px-2 font-bold uppercase tracking-wide"
                title={kindLabel}
              >
                {Icon && <Icon className="size-3" aria-hidden="true" />}
                {kindLabel}
              </Badge>
            </div>
            <div
              className="truncate text-fs-md font-bold leading-tight text-ink-1"
              title={listing.title}
            >
              {listing.title}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2.5">
          <p className="line-clamp-2 text-fs-sm leading-snug text-ink-3">{listing.summary}</p>
          {listing.tags && listing.tags.length > 0 ? (
            <div className="flex min-w-0 flex-wrap gap-1">
              {listing.tags.slice(0, 4).map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  size="xs"
                  className="h-5 max-w-full truncate rounded-r-xs border-transparent bg-surface-sunken px-1.5 font-mono text-fs-meta text-ink-3"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}

          <div className="mt-auto flex items-center gap-1.5 border-t border-line-soft pt-2">
            <Badge
              variant="warning"
              size="xs"
              className="h-5 shrink-0 gap-1 rounded-r-xs px-2 font-semibold tabular-nums"
            >
              <Star className="size-3 fill-current" aria-hidden="true" />
              {listing.rating.toFixed(1)}
            </Badge>
            <Badge
              variant="secondary"
              size="xs"
              className="h-5 shrink-0 gap-1 rounded-r-xs border-transparent bg-surface-sunken px-2 font-mono font-semibold tabular-nums text-ink-2"
            >
              <Download className="size-3 text-ink-4" aria-hidden="true" />
              {formatInstallCount(listing.install_count)}
            </Badge>
            <span className="ml-auto inline-flex min-w-0 items-center gap-1 truncate pl-1 font-mono text-fs-meta font-semibold text-ink-4">
              {verified && (
                <span
                  className="inline-block size-1.5 flex-none rounded-full bg-accent"
                  title={formatCreatorVerificationLabel(verification)}
                />
              )}
              <span className="truncate">
                {verified
                  ? formatCreatorVerificationLabel(verification)
                  : `@${listing.creator.handle}`}
              </span>
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
