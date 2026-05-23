import type { ListingSummary } from '@offisim/registry-client';
import { Badge, Card, CardButton, cn } from '@offisim/ui-core';
import { Download, Star } from 'lucide-react';
import { CoverIconTile, MarketCoverViz, hasCoverViz } from './MarketCoverViz.js';
import { getRarityClasses } from './market-rarity.js';
import { INSTALLABLE_KINDS, KIND_ICON, formatInstallCount } from './marketplace-meta.js';

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
  const verified = verification === 'verified' || verification === 'trusted';
  const rarity = getRarityClasses(listing.kind);

  return (
    <Card
      className={cn(
        'group relative h-market-listing-card overflow-hidden rounded-r-md bg-surface-1 p-0 shadow-elev-1 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-line-strong hover:shadow-elev-2',
        featured && 'col-span-2',
        selected ? rarity.accentBorder : 'border-line-soft',
      )}
    >
      <CardButton
        aria-label={`Open ${listing.title}`}
        onClick={() => onClick(listing.listing_id)}
        selected={selected}
      />

      <div className="pointer-events-none flex h-full flex-col overflow-hidden">
        <span
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 z-elevated h-1 opacity-90',
            rarity.accentBg,
          )}
          aria-hidden="true"
        />

        <div
          className={cn(
            'relative h-24 flex-none overflow-hidden border-b border-line-soft',
            rarity.cover,
          )}
        >
          {hasCoverViz(listing.kind) ? (
            <MarketCoverViz listing={listing} />
          ) : (
            <CoverIconTile kind={listing.kind} />
          )}

          {showInstalled && (
            <Badge
              variant="success"
              size="xs"
              className="absolute left-2 top-2 z-elevated h-5 shrink-0 rounded-r-pill px-2 font-bold uppercase tracking-wide"
            >
              Installed
            </Badge>
          )}

          <Badge
            variant="outline"
            size="xs"
            className={cn(
              'absolute right-2 top-2 z-elevated h-5 shrink-0 gap-1 rounded-r-pill bg-surface-1 px-2 font-bold uppercase tracking-wide shadow-elev-1',
              rarity.accent,
              rarity.accentBorder,
            )}
          >
            {Icon && <Icon className="size-3" aria-hidden="true" />}
            {listing.kind}
          </Badge>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 py-2.5">
          <div className="truncate text-fs-md font-bold leading-tight text-ink-1">
            {listing.title}
          </div>
          <p className="line-clamp-2 flex-1 text-fs-sm leading-snug text-ink-3">
            {listing.summary}
          </p>

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
                  title={verification === 'trusted' ? 'Trusted creator' : 'Verified creator'}
                />
              )}
              <span className="truncate">@{listing.creator.handle}</span>
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
