import type { ListingDetail } from '@offisim/registry-client';
import { Skeleton, cn } from '@offisim/ui-core';
import { ArrowLeft, Star } from 'lucide-react';
import { PermissionsBlock } from './PermissionsBlock.js';
import { getRarityColor } from './market-rarity.js';
import { INSTALLABLE_KINDS, KIND_ICON, formatInstallCount } from './marketplace-meta.js';

export interface MarketDetailViewProps {
  readonly detail: ListingDetail | null;
  readonly loading: boolean;
  readonly unavailable: boolean;
  readonly onBack: () => void;
  readonly onInstall: (listingId: string, version: string) => void;
  readonly layout?: 'full' | 'panel' | 'narrow';
}

function DetailSkeleton({ compact }: { compact: boolean }) {
  return (
    <div className={cn('flex h-full', compact && 'flex-col overflow-y-auto')}>
      <div className={cn('space-y-4 p-8', compact ? 'w-full' : 'w-3/5')}>
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="mt-6 h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div
        className={cn(
          'space-y-4 p-8',
          compact ? 'w-full border-t border-white/10' : 'w-2/5 border-l border-white/10',
        )}
      >
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

export function MarketDetailView({
  detail,
  loading,
  unavailable,
  onBack,
  onInstall,
  layout = 'full',
}: MarketDetailViewProps) {
  const compact = layout !== 'full';
  if (loading) {
    return (
      <div className="relative h-full">
        <button
          type="button"
          onClick={onBack}
          className="absolute top-4 left-4 z-10 inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <DetailSkeleton compact={compact} />
      </div>
    );
  }

  if (unavailable || !detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-lg font-semibold text-slate-300">Listing unavailable</p>
        <p className="text-sm text-slate-500">
          This package may have been removed or is no longer accessible.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-4 py-2 text-sm text-slate-300 hover:bg-white/10 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>
    );
  }

  const rarity = getRarityColor(detail.kind);
  const Icon = KIND_ICON[detail.kind];
  const version = typeof detail.version === 'string' ? detail.version : detail.version.version;

  return (
    <div className={cn('relative flex h-full', compact && 'flex-col overflow-y-auto')}>
      <button
        type="button"
        onClick={onBack}
        className="absolute top-4 left-4 z-10 inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      {/* Left: Hero area */}
      <div className={cn('overflow-y-auto p-8 pt-14', compact ? 'w-full' : 'w-3/5')}>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${rarity.badge}`}
        >
          {Icon && <Icon className="h-4 w-4" />}
          {detail.kind}
        </span>

        <h1 className="mt-4 text-3xl font-bold text-white">{detail.title}</h1>
        <p className="mt-2 text-base text-slate-400">{detail.summary}</p>

        {detail.tags && detail.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {detail.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-white/[0.06] px-3 py-1 text-xs text-slate-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {detail.description && (
          <div className="mt-6 border-t border-white/10 pt-6">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
              Description
            </h2>
            <div className="mt-3 text-sm leading-relaxed text-slate-400 whitespace-pre-wrap">
              {detail.description}
            </div>
          </div>
        )}
      </div>

      {/* Right: Metadata */}
      <div
        className={cn(
          'overflow-y-auto p-8 pt-14',
          compact ? 'w-full border-t border-white/10 pt-8' : 'w-2/5 border-l border-white/10',
        )}
      >
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Version</dt>
            <dd className="mt-1 text-slate-200">{version}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Creator</dt>
            <dd className="mt-1 text-slate-200">@{detail.creator.handle}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Rating</dt>
            <dd className="mt-1 inline-flex items-center gap-1 text-slate-200">
              <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
              {detail.rating.toFixed(1)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Installs</dt>
            <dd className="mt-1 text-slate-200">{formatInstallCount(detail.install_count)}</dd>
          </div>
        </dl>

        {INSTALLABLE_KINDS.has(detail.kind) ? (
          <button
            type="button"
            onClick={() =>
              onInstall(
                detail.listing_id,
                typeof detail.version === 'string' ? detail.version : detail.version.version,
              )
            }
            className={`mt-6 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition-colors ${rarity.accent}`}
          >
            Install
          </button>
        ) : (
          <div className="mt-6 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-center text-sm text-slate-500">
            Install not available for {detail.kind} packages
          </div>
        )}

        <div className="mt-6">
          <PermissionsBlock permissions={detail.permissions} variant="wide" />
        </div>

        {typeof detail.version !== 'string' && detail.version.runtime_range && (
          <div className="mt-6">
            <h3 className="text-xs uppercase tracking-wide text-slate-500">Compatibility</h3>
            <p className="mt-1 text-sm text-slate-300">Runtime: {detail.version.runtime_range}</p>
          </div>
        )}
      </div>
    </div>
  );
}
