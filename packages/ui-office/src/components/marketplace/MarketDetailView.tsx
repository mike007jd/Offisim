import type { ListingDetail } from '@offisim/registry-client';
import { Skeleton, cn } from '@offisim/ui-core';
import { ArrowLeft, ChevronLeft, ChevronRight, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { packageInstallKey } from '../../hooks/useInstalledListings.js';
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
  /**
   * Per-company set of marketplace listing ids that the active company has
   * already installed. Match alongside `installedPackageKeys` (one survives
   * catalog re-seed where listing_id rotates).
   */
  readonly installedListingIds?: ReadonlySet<string>;
  readonly installedPackageKeys?: ReadonlySet<string>;
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
  installedListingIds,
  installedPackageKeys,
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
  const isInstallable = INSTALLABLE_KINDS.has(detail.kind);
  const versionPackageId =
    typeof detail.version === 'string' ? undefined : detail.version.package_id;
  const installedByPackage =
    versionPackageId
      ? (installedPackageKeys?.has(packageInstallKey(versionPackageId, version)) ?? false)
      : false;
  const isInstalled =
    isInstallable &&
    ((installedListingIds?.has(detail.listing_id) ?? false) || installedByPackage);

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

          <ScreenshotCarousel previews={detail.previews} fallbackTitle={detail.title} />

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
            <Section title="Description">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
                {detail.description}
              </div>
            </Section>
          )}

          {detail.version.changelog && (
            <Section title="Changelog">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
                {detail.version.changelog}
              </div>
            </Section>
          )}

          <RequirementsSection requirements={detail.requirements} />

          <LineageSection lineage={detail.lineage} />
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
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-text-muted">Creator</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 text-text-primary">
                <span>{detail.creator.display_name}</span>
                <span className="text-text-muted">@{detail.creator.handle}</span>
                {detail.creator.verification_state !== 'unverified' && (
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full bg-info"
                    title={
                      detail.creator.verification_state === 'trusted'
                        ? 'Trusted creator'
                        : 'Verified creator'
                    }
                  />
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-text-muted">Rating</dt>
              <dd className="mt-0.5 inline-flex items-center gap-1 text-text-primary">
                <Star className="h-3.5 w-3.5 fill-current text-warning" />
                {detail.rating.toFixed(1)}
              </dd>
            </div>
            <MetaRow label="Installs" value={formatInstallCount(detail.install_count)} />
            {detail.version.published_at && (
              <MetaRow
                label="Published"
                value={new Date(detail.version.published_at).toLocaleDateString()}
              />
            )}
          </dl>

          {isInstallable ? (
            isInstalled ? (
              <button
                type="button"
                disabled
                className="mt-5 w-full cursor-not-allowed rounded-lg bg-surface-muted px-4 py-2.5 text-sm font-semibold text-text-muted"
              >
                Installed
              </button>
            ) : (
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
            )
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5 border-t border-border-subtle pt-5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ScreenshotCarousel({
  previews,
  fallbackTitle,
}: {
  previews: ListingDetail['previews'];
  fallbackTitle: string;
}) {
  const [index, setIndex] = useState(0);
  const images = (previews ?? []).filter((p) => p.kind === 'image' || p.kind === 'icon');
  if (images.length === 0) return null;
  const active = images[Math.min(index, images.length - 1)];
  if (!active) return null;
  const goPrev = () => setIndex((i) => (i === 0 ? images.length - 1 : i - 1));
  const goNext = () => setIndex((i) => (i === images.length - 1 ? 0 : i + 1));
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-border-subtle bg-surface-muted">
      <div className="relative aspect-[16/9] w-full">
        <img
          src={active.url}
          alt={active.alt ?? fallbackTitle}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={goPrev}
              aria-label="Previous screenshot"
              className="absolute left-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-surface-elevated/80 text-text-primary backdrop-blur transition hover:bg-surface-elevated"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="Next screenshot"
              className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-surface-elevated/80 text-text-primary backdrop-blur transition hover:bg-surface-elevated"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
              {images.map((preview, i) => (
                <button
                  key={preview.url}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Show screenshot ${i + 1}`}
                  className={`h-1.5 w-1.5 rounded-full transition ${
                    i === index ? 'bg-text-primary' : 'bg-text-muted/40'
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RequirementsSection({
  requirements,
}: {
  requirements: ListingDetail['requirements'];
}) {
  const caps = requirements.required_capabilities ?? [];
  const mcps = requirements.required_mcps ?? [];
  const models = requirements.recommended_models ?? [];
  if (caps.length === 0 && mcps.length === 0 && models.length === 0) return null;
  return (
    <Section title="Requirements">
      <div className="space-y-2 text-sm">
        {caps.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[11px] uppercase tracking-wide text-text-muted">Capabilities</span>
            <div className="flex flex-wrap gap-1">
              {caps.map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-text-secondary"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
        {mcps.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[11px] uppercase tracking-wide text-text-muted">MCPs</span>
            <div className="flex flex-wrap gap-1">
              {mcps.map((m) => (
                <span
                  key={m}
                  className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-text-secondary"
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}
        {models.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[11px] uppercase tracking-wide text-text-muted">Models</span>
            <div className="flex flex-wrap gap-1">
              {models.map((m) => (
                <span
                  key={m.profile}
                  className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-text-secondary"
                  title={m.reason ?? undefined}
                >
                  {m.profile}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function LineageSection({ lineage }: { lineage: ListingDetail['lineage'] }) {
  if (!lineage) return null;
  const { origin_package_id, forked_from_version, derivative_of } = lineage;
  if (!origin_package_id && !forked_from_version && (!derivative_of || derivative_of.length === 0)) {
    return null;
  }
  return (
    <Section title="Lineage">
      <div className="space-y-1 text-sm text-text-secondary">
        {origin_package_id && (
          <div>
            <span className="text-text-muted">Origin: </span>
            <span className="font-mono text-text-primary">{origin_package_id}</span>
          </div>
        )}
        {forked_from_version && (
          <div>
            <span className="text-text-muted">Forked from: </span>
            <span className="font-mono text-text-primary">{forked_from_version}</span>
          </div>
        )}
        {derivative_of && derivative_of.length > 0 && (
          <div>
            <span className="text-text-muted">Derivative of: </span>
            <span className="font-mono text-text-primary">{derivative_of.join(', ')}</span>
          </div>
        )}
      </div>
    </Section>
  );
}
