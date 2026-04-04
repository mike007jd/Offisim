import type { ListingSummary } from '@offisim/registry-client';
import { Badge } from '@offisim/ui-core';
import { ArrowUpRight, Star } from 'lucide-react';
import { KIND_ICON, formatInstallCount } from './marketplace-meta.js';

interface ListingCardProps {
  readonly listing: ListingSummary;
  readonly onOpen: (listingId: string) => void;
}

export function ListingCard({ listing, onOpen }: ListingCardProps) {
  const Icon = KIND_ICON[listing.kind];

  return (
    <button
      type="button"
      onClick={() => onOpen(listing.listing_id)}
      className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/10"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/70 text-cyan-300">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{listing.title}</p>
              <p className="truncate text-[11px] text-slate-400">@{listing.creator.handle}</p>
            </div>
            <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          </div>
          <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-slate-300/80">
            {listing.summary || 'No summary provided.'}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1">
            <Star className="h-3.5 w-3.5 fill-current text-amber-300" />
            {listing.rating.toFixed(1)}
          </span>
          <span>{formatInstallCount(listing.install_count)} installs</span>
        </div>
        <Badge variant="info" className="px-2 py-0.5 text-[10px] uppercase tracking-wide">
          {listing.kind.replace('_', ' ')}
        </Badge>
      </div>
    </button>
  );
}
