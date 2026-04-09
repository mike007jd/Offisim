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
      className="group relative w-full overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-left transition-all hover:border-cyan-400/30 hover:bg-cyan-500/[0.06] hover:shadow-[0_0_24px_rgba(34,211,238,0.06)]"
    >
      <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r bg-cyan-400/40 opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/[0.08] text-cyan-300">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{listing.title}</p>
              <p className="truncate text-[12px] text-slate-500 mt-0.5">
                @{listing.creator.handle}
              </p>
            </div>
            <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600 transition-colors group-hover:text-cyan-400" />
          </div>
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-slate-400">
            {listing.summary || 'No summary provided.'}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 text-amber-300">
            <Star className="h-3 w-3 fill-current" />
            {listing.rating.toFixed(1)}
          </span>
          <span className="inline-flex items-center rounded-full bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 text-slate-500">
            {formatInstallCount(listing.install_count)}
          </span>
        </div>
        <Badge variant="info" className="px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
          {listing.kind.replace('_', ' ')}
        </Badge>
      </div>
    </button>
  );
}
