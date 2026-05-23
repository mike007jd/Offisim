import type { ListingDetail } from '@offisim/registry-client';
import { Button, Skeleton, cn } from '@offisim/ui-core';
import { ArrowLeft, ChevronLeft, ChevronRight, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { packageInstallKey } from '../../hooks/useInstalledListings.js';
import { PermissionsBlock } from './PermissionsBlock.js';
import { getRarityClasses } from './market-rarity.js';
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

const CAPS_LABEL = 'text-fs-meta font-semibold uppercase tracking-wide text-ink-3';
const CHIP =
  'inline-flex h-5 items-center rounded-r-pill bg-surface-sunken px-2 text-fs-meta font-medium text-ink-3';

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-sp-7">
      <Skeleton className="h-6 w-2/3 rounded-r-xs" />
      <Skeleton className="h-4 w-full rounded-r-xs" />
      <Skeleton className="aspect-video w-full rounded-r-md" />
      <Skeleton className="h-20 w-full rounded-r-md" />
      <Skeleton className="h-9 w-full rounded-r-md" />
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
  const panelBorder = layout === 'panel' ? 'border-l border-line shadow-elev-2' : '';

  if (loading) {
    return (
      <div className={`flex h-full min-h-0 flex-col bg-surface-1 ${panelBorder}`}>
        <DetailHead onBack={onBack} kindChip={null} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DetailSkeleton />
        </div>
      </div>
    );
  }

  if (unavailable || !detail) {
    return (
      <div className={`flex h-full min-h-0 flex-col bg-surface-1 ${panelBorder}`}>
        <DetailHead onBack={onBack} kindChip={null} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-sp-7 text-center">
          <p className="text-fs-lg font-semibold text-ink-1">Listing unavailable</p>
          <p className="text-fs-sm text-ink-3">
            This package may have been removed or is no longer accessible.
          </p>
          <Button type="button" variant="secondary" onClick={onBack} className="gap-1.5">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back
          </Button>
        </div>
      </div>
    );
  }

  const Icon = KIND_ICON[detail.kind];
  const version = typeof detail.version === 'string' ? detail.version : detail.version.version;
  const isInstallable = INSTALLABLE_KINDS.has(detail.kind);
  const versionPackageId =
    typeof detail.version === 'string' ? undefined : detail.version.package_id;
  const installedByPackage = versionPackageId
    ? (installedPackageKeys?.has(packageInstallKey(versionPackageId, version)) ?? false)
    : false;
  const isInstalled =
    isInstallable && ((installedListingIds?.has(detail.listing_id) ?? false) || installedByPackage);
  const verified = detail.creator.verification_state !== 'unverified';
  const rarity = getRarityClasses(detail.kind);

  return (
    <div className={`flex h-full min-h-0 flex-col bg-surface-1 text-ink-1 ${panelBorder}`}>
      <DetailHead
        onBack={onBack}
        kindChip={
          <span
            className={cn(
              'inline-flex h-5 items-center gap-1.5 rounded-r-pill border px-2 text-fs-meta font-bold uppercase tracking-wide',
              rarity.accent,
              rarity.accentBorder,
              rarity.surface,
            )}
          >
            {Icon && <Icon className="size-3" aria-hidden="true" />}
            {detail.kind}
          </span>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-sp-7">
        <div>
          <h1 className="text-fs-lg font-bold text-ink-1">{detail.title}</h1>
          <p className="mt-1 text-fs-sm leading-relaxed text-ink-3">{detail.summary}</p>
          <div className="mt-2 flex items-center gap-1.5 font-mono text-fs-meta text-ink-4">
            {verified && (
              <span
                className="inline-block size-1.5 rounded-full bg-accent"
                title={
                  detail.creator.verification_state === 'trusted'
                    ? 'Trusted creator'
                    : 'Verified creator'
                }
              />
            )}
            <span className="text-ink-3">@{detail.creator.handle}</span>
            <span>·</span>
            <span>{detail.creator.display_name}</span>
          </div>
        </div>

        <ScreenshotCarousel previews={detail.previews} fallbackTitle={detail.title} />

        {detail.tags && detail.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {detail.tags.map((tag) => (
              <span key={tag} className={CHIP}>
                {tag}
              </span>
            ))}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-sp-5 gap-y-2.5 rounded-r-md border border-line-soft bg-surface-2 p-sp-5">
          <MetaRow label="Version" value={version} mono />
          <MetaRow label="Installs" value={formatInstallCount(detail.install_count)} mono />
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className={CAPS_LABEL}>Rating</dt>
            <dd className="flex items-center gap-1 text-fs-sm text-ink-1">
              <Star className="size-3.5 fill-current text-warn" aria-hidden="true" />
              {detail.rating.toFixed(1)}
            </dd>
          </div>
          {detail.version.published_at && (
            <MetaRow
              label="Published"
              value={new Date(detail.version.published_at).toLocaleDateString()}
              mono
            />
          )}
        </dl>

        {isInstallable ? (
          isInstalled ? (
            <Button
              type="button"
              disabled
              variant="secondary"
              className="w-full cursor-not-allowed gap-1.5 rounded-r-md bg-surface-sunken text-fs-sm font-semibold text-ink-4"
            >
              Installed
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => onInstall(detail.listing_id, version)}
              className={cn(
                'w-full gap-1.5 rounded-r-md border-0 text-fs-sm font-semibold text-accent-fg',
                rarity.accentBg,
              )}
            >
              Install
            </Button>
          )
        ) : (
          <div className="rounded-r-md border border-dashed border-line bg-surface-sunken px-3 py-2.5 text-center text-fs-meta text-ink-3">
            Install not supported for {detail.kind}.
          </div>
        )}

        <PermissionsBlock permissions={detail.permissions} variant="wide" />

        {detail.description && (
          <Section title="Description">
            <p className="whitespace-pre-wrap text-fs-sm leading-relaxed text-ink-2">
              {detail.description}
            </p>
          </Section>
        )}

        {detail.version.changelog && (
          <Section title="Changelog">
            <p className="whitespace-pre-wrap text-fs-sm leading-relaxed text-ink-2">
              {detail.version.changelog}
            </p>
          </Section>
        )}

        <RequirementsSection requirements={detail.requirements} />

        <LineageSection lineage={detail.lineage} />

        {typeof detail.version !== 'string' && detail.version.runtime_range && (
          <div className="flex items-center justify-between text-fs-meta text-ink-3">
            <span>Runtime</span>
            <span className="font-mono text-ink-1">{detail.version.runtime_range}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailHead({ onBack, kindChip }: { onBack: () => void; kindChip: ReactNode }) {
  return (
    <header className="flex h-12 flex-none items-center gap-2 border-b border-line px-sp-5">
      <Button
        type="button"
        onClick={onBack}
        variant="ghost"
        size="sm"
        className="gap-1.5 rounded-r-sm text-fs-sm font-medium text-ink-3 hover:bg-surface-sunken hover:text-ink-1"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back
      </Button>
      {kindChip}
    </header>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className={CAPS_LABEL}>{label}</dt>
      <dd className={`truncate text-fs-sm text-ink-1 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-line-soft pt-sp-5">
      <h2 className={CAPS_LABEL}>{title}</h2>
      {children}
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
    <div className="overflow-hidden rounded-r-md border border-line-soft bg-surface-sunken">
      <div className="relative aspect-video w-full">
        <img
          src={active.url}
          alt={active.alt ?? fallbackTitle}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        {images.length > 1 && (
          <>
            <Button
              type="button"
              onClick={goPrev}
              aria-label="Previous screenshot"
              variant="secondary"
              size="icon"
              className="absolute left-2 top-1/2 size-7 -translate-y-1/2 rounded-full bg-surface-1/90 text-ink-1 shadow-elev-1 backdrop-blur"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              onClick={goNext}
              aria-label="Next screenshot"
              variant="secondary"
              size="icon"
              className="absolute right-2 top-1/2 size-7 -translate-y-1/2 rounded-full bg-surface-1/90 text-ink-1 shadow-elev-1 backdrop-blur"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
            <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
              {images.map((preview, i) => (
                <Button
                  key={preview.url}
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setIndex(i)}
                  aria-label={`Show screenshot ${i + 1}`}
                  className={`size-2 rounded-full border-0 p-0 transition-colors ${
                    i === index ? 'bg-white' : 'bg-white/45'
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
      <div className="flex flex-col gap-2">
        {caps.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className={CAPS_LABEL}>Capabilities</span>
            <div className="flex flex-wrap gap-1">
              {caps.map((c) => (
                <span key={c} className={CHIP}>
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
        {mcps.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className={CAPS_LABEL}>MCPs</span>
            <div className="flex flex-wrap gap-1">
              {mcps.map((m) => (
                <span key={m} className={`${CHIP} font-mono text-ink-2`}>
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}
        {models.length > 0 && (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className={CAPS_LABEL}>Models</span>
            <div className="flex flex-wrap gap-1">
              {models.map((m) => (
                <span
                  key={m.profile}
                  className={`${CHIP} font-mono text-ink-2`}
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
  if (
    !origin_package_id &&
    !forked_from_version &&
    (!derivative_of || derivative_of.length === 0)
  ) {
    return null;
  }
  return (
    <Section title="Lineage">
      <div className="flex flex-col gap-1 text-fs-sm leading-relaxed text-ink-2">
        {origin_package_id && (
          <div>
            <span className="text-ink-4">Origin: </span>
            <span className="font-mono text-ink-1">{origin_package_id}</span>
          </div>
        )}
        {forked_from_version && (
          <div>
            <span className="text-ink-4">Forked from: </span>
            <span className="font-mono text-ink-1">{forked_from_version}</span>
          </div>
        )}
        {derivative_of && derivative_of.length > 0 && (
          <div>
            <span className="text-ink-4">Derivative of: </span>
            <span className="font-mono text-ink-1">{derivative_of.join(', ')}</span>
          </div>
        )}
      </div>
    </Section>
  );
}
