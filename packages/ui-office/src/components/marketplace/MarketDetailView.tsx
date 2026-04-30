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
          compact ? 'w-full border-t border-border-subtle' : 'w-2/5 border-l border-border-subtle',
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
          className="absolute left-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-muted px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
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
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-surface text-text-primary">
        <p className="text-lg font-semibold text-text-primary">Listing unavailable</p>
        <p className="text-sm text-text-secondary">
          This package may have been removed or is no longer accessible.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-surface-muted px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
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
    <div
      className={cn('flex h-full flex-col bg-surface text-text-primary', compact && 'overflow-y-auto')}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-6 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${rarity.badge}`}
        >
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {detail.kind}
        </span>
      </header>

      <div className={cn('flex min-h-0 flex-1', compact && 'flex-col overflow-y-auto')}>
        {/* Left: Hero area */}
        <div className={cn('overflow-y-auto px-8 py-6', compact ? 'w-full' : 'w-3/5')}>
          <h1 className="text-2xl font-semibold text-text-primary">{detail.title}</h1>
          <p className="mt-1.5 text-sm text-text-secondary">{detail.summary}</p>

          {detail.tags && detail.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {detail.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-surface-muted px-2.5 py-0.5 text-[11px] text-text-secondary"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {detail.description && (
            <div className="mt-5 border-t border-border-subtle pt-5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                Description
              </h2>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
                {detail.description}
              </div>
            </div>
          )}
        </div>

        {/* Right: Metadata */}
        <div
          className={cn(
            'overflow-y-auto px-8 py-6',
            compact ? 'w-full border-t border-border-subtle' : 'w-2/5 border-l border-border-subtle',
          )}
        >
          <dl className="space-y-3 text-sm">
            <MetaRow label="Version" value={version} />
            <MetaRow label="Creator" value={`@${detail.creator.handle}`} />
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-text-muted">Rating</dt>
              <dd className="mt-0.5 inline-flex items-center gap-1 text-text-primary">
                <Star className="h-3.5 w-3.5 fill-current text-warning" />
                {detail.rating.toFixed(1)}
              </dd>
            </div>
            <MetaRow label="Installs" value={formatInstallCount(detail.install_count)} />
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
              className={`mt-5 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${rarity.accent}`}
            >
              Install
            </button>
          ) : (
            <p className="mt-5 text-center text-xs text-text-muted">
              Install not supported for {detail.kind}.
            </p>
          )}

          <div className="mt-5">
            <PermissionsBlock permissions={detail.permissions} variant="wide" />
          </div>

          {typeof detail.version !== 'string' && detail.version.runtime_range && (
            <div className="mt-5 text-xs">
              <span className="text-text-muted">Runtime · </span>
              <span className="text-text-secondary">{detail.version.runtime_range}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-text-primary">{value}</dd>
    </div>
  );
}
