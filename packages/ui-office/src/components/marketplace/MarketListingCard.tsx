import type { ListingSummary } from '@offisim/registry-client';
import { Button, cn } from '@offisim/ui-core';
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
    <Button
      type="button"
      variant="ghost"
      onClick={() => onClick(listing.listing_id)}
      className={cn(
        'group relative flex h-market-listing-card flex-col items-stretch justify-start gap-0 overflow-hidden rounded-r-md border bg-surface-1 p-0 text-left shadow-elev-1 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-line-strong hover:bg-surface-1 hover:shadow-elev-2',
        featured && 'col-span-2',
        selected ? rarity.accentBorder : 'border-line-soft',
      )}
    >
      <span
        className={cn('pointer-events-none absolute inset-x-0 top-0 z-elevated h-1 opacity-90', rarity.accentBg)}
        aria-hidden="true"
      />

      <div className={cn('relative h-24 flex-none overflow-hidden border-b border-line-soft', rarity.cover)}>
        {hasCoverViz(listing.kind) ? (
          <MarketCoverViz listing={listing} />
        ) : (
          <CoverIconTile kind={listing.kind} />
        )}

        {showInstalled && (
          <span className="absolute left-2 top-2 z-elevated inline-flex h-5 items-center gap-1 rounded-r-pill border border-ok bg-ok-surface px-2 text-fs-meta font-bold uppercase tracking-wide text-ok">
            Installed
          </span>
        )}

        <span
          className={cn(
            'absolute right-2 top-2 z-elevated inline-flex h-5 items-center gap-1 rounded-r-pill border bg-surface-1 px-2 text-fs-meta font-bold uppercase tracking-wide shadow-elev-1',
            rarity.accent,
            rarity.accentBorder,
          )}
        >
          {Icon && <Icon className="size-3" aria-hidden="true" />}
          {listing.kind}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 py-2.5">
        <div className="truncate text-fs-md font-bold leading-tight text-ink-1">
          {listing.title}
        </div>
        <p className="line-clamp-2 flex-1 text-fs-sm leading-snug text-ink-3">{listing.summary}</p>

        <div className="mt-auto flex items-center gap-1.5 border-t border-line-soft pt-2">
          <span className="inline-flex h-5 items-center gap-1 rounded-r-xs border border-warn bg-warn-surface px-2 text-fs-meta font-semibold tabular-nums text-warn">
            <Star className="size-3 fill-current" aria-hidden="true" />
            {listing.rating.toFixed(1)}
          </span>
          <span className="inline-flex h-5 items-center gap-1 rounded-r-xs bg-surface-sunken px-2 font-mono text-fs-meta font-semibold tabular-nums text-ink-2">
            <Download className="size-3 text-ink-4" aria-hidden="true" />
            {formatInstallCount(listing.install_count)}
          </span>
          <span className="ml-auto inline-flex items-center gap-1 truncate pl-1 font-mono text-fs-meta font-semibold text-ink-4">
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
    </Button>
  );
}
