import type { AssetKind } from '@offisim/asset-schema';
import type { ListingSummary } from '@offisim/registry-client';
import { Download, Star } from 'lucide-react';
import { KIND_ICON, formatInstallCount } from './marketplace-meta.js';

// ---------------------------------------------------------------------------
// Rarity system — maps asset kinds to game-style rarity tiers
// ---------------------------------------------------------------------------

const KIND_RARITY: Record<
  string,
  { border: string; glow: string; badge: string; bg: string; icon: string }
> = {
  employee: {
    border: 'border-emerald-400/40',
    glow: 'hover:shadow-[0_0_20px_rgba(52,211,153,0.15)]',
    badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30',
    bg: 'bg-emerald-500/[0.03]',
    icon: 'border-emerald-400/20 bg-emerald-500/[0.08] text-emerald-300',
  },
  skill: {
    border: 'border-violet-400/40',
    glow: 'hover:shadow-[0_0_20px_rgba(167,139,250,0.15)]',
    badge: 'bg-violet-500/20 text-violet-300 border-violet-400/30',
    bg: 'bg-violet-500/[0.03]',
    icon: 'border-violet-400/20 bg-violet-500/[0.08] text-violet-300',
  },
  sop: {
    border: 'border-amber-400/40',
    glow: 'hover:shadow-[0_0_20px_rgba(251,191,36,0.15)]',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-400/30',
    bg: 'bg-amber-500/[0.03]',
    icon: 'border-amber-400/20 bg-amber-500/[0.08] text-amber-300',
  },
  company_template: {
    border: 'border-cyan-400/40',
    glow: 'hover:shadow-[0_0_20px_rgba(34,211,238,0.15)]',
    badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/30',
    bg: 'bg-cyan-500/[0.03]',
    icon: 'border-cyan-400/20 bg-cyan-500/[0.08] text-cyan-300',
  },
  office_layout: {
    border: 'border-rose-400/40',
    glow: 'hover:shadow-[0_0_20px_rgba(251,113,133,0.15)]',
    badge: 'bg-rose-500/20 text-rose-300 border-rose-400/30',
    bg: 'bg-rose-500/[0.03]',
    icon: 'border-rose-400/20 bg-rose-500/[0.08] text-rose-300',
  },
  prefab: {
    border: 'border-orange-400/40',
    glow: 'hover:shadow-[0_0_20px_rgba(251,146,60,0.15)]',
    badge: 'bg-orange-500/20 text-orange-300 border-orange-400/30',
    bg: 'bg-orange-500/[0.03]',
    icon: 'border-orange-400/20 bg-orange-500/[0.08] text-orange-300',
  },
  bundle: {
    border: 'border-sky-400/40',
    glow: 'hover:shadow-[0_0_20px_rgba(56,189,248,0.15)]',
    badge: 'bg-sky-500/20 text-sky-300 border-sky-400/30',
    bg: 'bg-sky-500/[0.03]',
    icon: 'border-sky-400/20 bg-sky-500/[0.08] text-sky-300',
  },
};

const DEFAULT_RARITY = {
  border: 'border-white/10',
  glow: 'hover:shadow-[0_0_20px_rgba(255,255,255,0.05)]',
  badge: 'bg-white/10 text-slate-300 border-white/10',
  bg: 'bg-white/[0.02]',
  icon: 'border-white/10 bg-white/[0.04] text-slate-400',
};

export function getRarity(kind: AssetKind | string) {
  return KIND_RARITY[kind] ?? DEFAULT_RARITY;
}

// ---------------------------------------------------------------------------
// Kind labels
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<string, string> = {
  employee: 'Agent',
  skill: 'Skill',
  sop: 'SOP',
  company_template: 'Template',
  office_layout: 'Layout',
  prefab: 'Prefab',
  bundle: 'Bundle',
};

// ---------------------------------------------------------------------------
// ListingCard — game item card
// ---------------------------------------------------------------------------

interface ListingCardProps {
  readonly listing: ListingSummary;
  readonly onOpen: (listingId: string) => void;
}

export function ListingCard({ listing, onOpen }: ListingCardProps) {
  const Icon = KIND_ICON[listing.kind];
  const rarity = getRarity(listing.kind);

  // Star visual: filled stars out of 5
  const fullStars = Math.round(listing.rating);

  return (
    <button
      type="button"
      onClick={() => onOpen(listing.listing_id)}
      className={`game-card group relative flex w-full flex-col overflow-hidden rounded-lg border text-left transition-all duration-200 ${rarity.border} ${rarity.glow} ${rarity.bg} hover:scale-[1.02] hover:brightness-110`}
    >
      {/* Shine sweep on hover */}
      <div className="pointer-events-none absolute inset-0 z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
        <div className="absolute -left-full top-0 h-full w-1/2 skew-x-[-20deg] bg-gradient-to-r from-transparent via-white/[0.04] to-transparent transition-transform duration-700 group-hover:translate-x-[400%]" />
      </div>

      {/* Top: icon area */}
      <div className="flex items-center gap-3 px-3.5 pt-3.5">
        <div
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border ${rarity.icon}`}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold text-white">{listing.title}</p>
          <p className="truncate text-[12px] text-slate-500">@{listing.creator.handle}</p>
        </div>
      </div>

      {/* Summary */}
      <p className="mt-2 line-clamp-2 px-3.5 text-[12px] leading-relaxed text-slate-400">
        {listing.summary || 'No description available.'}
      </p>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom bar */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.05] px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-[11px]">
          {/* Star rating */}
          <span className="inline-flex items-center gap-0.5 text-amber-400">
            {Array.from({ length: 5 }, (_, i) => (
              <Star
                key={i}
                className={`h-3 w-3 ${i < fullStars ? 'fill-current' : 'fill-none opacity-30'}`}
              />
            ))}
          </span>
          {/* Install count */}
          <span className="inline-flex items-center gap-1 text-slate-500">
            <Download className="h-3 w-3" />
            {formatInstallCount(listing.install_count)}
          </span>
        </div>
        {/* Kind badge */}
        <span
          className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${rarity.badge}`}
        >
          {KIND_LABEL[listing.kind] ?? listing.kind.replace('_', ' ')}
        </span>
      </div>
    </button>
  );
}
