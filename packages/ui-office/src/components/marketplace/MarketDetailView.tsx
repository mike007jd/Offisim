import type { ListingDetail } from '@offisim/registry-client';
import { Button, Skeleton, cn } from '@offisim/ui-core';
import { ArrowLeft, ChevronLeft, ChevronRight, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { packageInstallKey } from '../../hooks/useInstalledListings.js';
import { PermissionsBlock } from './PermissionsBlock.js';
import { rarityClassName } from './market-rarity.js';
import {
  INSTALLABLE_KINDS,
  KIND_ICON,
  formatCreatorVerificationLabel,
  formatInstallCount,
  formatMarketKindLabel,
  isVerifiedCreator,
} from './marketplace-meta.js';

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

const CAPS_LABEL = 'market-detail-label';
const CHIP = 'market-detail-chip';

function DetailSkeleton() {
  return (
    <div className="market-detail-skeleton">
      <Skeleton className="market-detail-skeleton-line" data-size="title" />
      <Skeleton className="market-detail-skeleton-line" data-size="full" />
      <Skeleton className="market-detail-skeleton-shot" />
      <Skeleton className="market-detail-skeleton-block" />
      <Skeleton className="market-detail-skeleton-cta" />
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
  const isPanel = layout === 'panel';

  if (loading) {
    return (
      <div className={cn('market-detail-view', isPanel && 'market-detail-view-panel')}>
        <DetailHead onBack={onBack} kindChip={null} />
        <div className="market-detail-scroll">
          <DetailSkeleton />
        </div>
      </div>
    );
  }

  if (unavailable || !detail) {
    return (
      <div className={cn('market-detail-view', isPanel && 'market-detail-view-panel')}>
        <DetailHead onBack={onBack} kindChip={null} />
        <div className="market-detail-unavailable">
          <p className="market-detail-unavailable-title">Listing unavailable</p>
          <p className="market-detail-unavailable-copy">
            This package may have been removed or is no longer accessible.
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={onBack}
            className="market-detail-back-cta"
          >
            <ArrowLeft data-icon="back" aria-hidden="true" />
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
  const verified = isVerifiedCreator(detail.creator.verification_state);

  return (
    <div
      className={cn(
        'market-detail-view',
        isPanel && 'market-detail-view-panel',
        rarityClassName(detail.kind),
      )}
    >
      <DetailHead
        onBack={onBack}
        kindChip={
          <span className="market-detail-kind-chip market-rarity-chip">
            {Icon && <Icon data-icon="kind" aria-hidden="true" />}
            {formatMarketKindLabel(detail.kind)}
          </span>
        }
      />

      <div className="market-detail-body">
        <div className="market-detail-intro">
          <h1 className="market-detail-title">{detail.title}</h1>
          <p className="market-detail-summary">{detail.summary}</p>
          <div className="market-detail-creator">
            {verified && (
              <span
                className="market-detail-verified"
                title={formatCreatorVerificationLabel(detail.creator.verification_state)}
              />
            )}
            <span className="market-detail-handle">@{detail.creator.handle}</span>
            <span>·</span>
            <span>{detail.creator.display_name}</span>
          </div>
        </div>

        <ScreenshotCarousel previews={detail.previews} fallbackTitle={detail.title} />

        {detail.tags && detail.tags.length > 0 && (
          <div className="market-detail-tags">
            {detail.tags.map((tag) => (
              <span key={tag} className={CHIP}>
                {tag}
              </span>
            ))}
          </div>
        )}

        <dl className="market-detail-meta">
          <MetaRow label="Version" value={version} mono />
          <MetaRow label="Installs" value={formatInstallCount(detail.install_count)} mono />
          <div className="market-detail-meta-row">
            <dt className={CAPS_LABEL}>Rating</dt>
            <dd className="market-detail-rating">
              <Star data-icon="rating" aria-hidden="true" />
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
              className="market-detail-install market-detail-install-disabled"
            >
              Installed
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => onInstall(detail.listing_id, version)}
              className="market-detail-install market-rarity-cta"
            >
              Install
            </Button>
          )
        ) : (
          <div className="market-detail-unsupported">Install not supported for {detail.kind}.</div>
        )}

        <PermissionsBlock permissions={detail.permissions} variant="wide" />

        {detail.description && (
          <Section title="Description">
            <p className="market-detail-prose">{detail.description}</p>
          </Section>
        )}

        {detail.version.changelog && (
          <Section title="Changelog">
            <p className="market-detail-prose">{detail.version.changelog}</p>
          </Section>
        )}

        <RequirementsSection requirements={detail.requirements} />

        <LineageSection lineage={detail.lineage} />

        {typeof detail.version !== 'string' && detail.version.runtime_range && (
          <div className="market-detail-runtime">
            <span>Runtime</span>
            <span>{detail.version.runtime_range}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailHead({ onBack, kindChip }: { onBack: () => void; kindChip: ReactNode }) {
  return (
    <header className="market-detail-head">
      <Button
        type="button"
        onClick={onBack}
        variant="ghost"
        size="sm"
        className="market-detail-back"
      >
        <ArrowLeft data-icon="back" aria-hidden="true" />
        Back
      </Button>
      {kindChip}
    </header>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="market-detail-meta-row">
      <dt className={CAPS_LABEL}>{label}</dt>
      <dd className={cn('market-detail-meta-value', mono && 'market-detail-mono')}>{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="market-detail-section">
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
    <div className="market-detail-shot">
      <div className="market-detail-shot-frame">
        <img
          src={active.url}
          alt={active.alt ?? fallbackTitle}
          className="market-detail-shot-image"
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
              className="market-detail-shot-nav market-detail-shot-nav-prev"
            >
              <ChevronLeft data-icon="shot-nav" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              onClick={goNext}
              aria-label="Next screenshot"
              variant="secondary"
              size="icon"
              className="market-detail-shot-nav market-detail-shot-nav-next"
            >
              <ChevronRight data-icon="shot-nav" aria-hidden="true" />
            </Button>
            <div className="market-detail-shot-dots">
              {images.map((preview, i) => (
                <Button
                  key={preview.url}
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setIndex(i)}
                  aria-label={`Show screenshot ${i + 1}`}
                  className={cn(
                    'market-detail-shot-dot',
                    i === index && 'market-detail-shot-dot-active',
                  )}
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
          <div className="market-detail-requirement-row">
            <span className={CAPS_LABEL}>Capabilities</span>
            <div className="market-detail-chip-row">
              {caps.map((c) => (
                <span key={c} className={CHIP}>
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
        {mcps.length > 0 && (
          <div className="market-detail-requirement-row">
            <span className={CAPS_LABEL}>MCPs</span>
            <div className="market-detail-chip-row">
              {mcps.map((m) => (
                <span key={m} className={cn(CHIP, 'market-detail-mono')}>
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}
        {models.length > 0 && (
          <div className="market-detail-requirement-row">
            <span className={CAPS_LABEL}>Models</span>
            <div className="market-detail-chip-row">
              {models.map((m) => (
                <span
                  key={m.profile}
                  className={cn(CHIP, 'market-detail-mono')}
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
      <div className="market-detail-lineage">
        {origin_package_id && (
          <div>
            <span>Origin: </span>
            <span className="market-detail-mono">{origin_package_id}</span>
          </div>
        )}
        {forked_from_version && (
          <div>
            <span>Forked from: </span>
            <span className="market-detail-mono">{forked_from_version}</span>
          </div>
        )}
        {derivative_of && derivative_of.length > 0 && (
          <div>
            <span>Derivative of: </span>
            <span className="market-detail-mono">{derivative_of.join(', ')}</span>
          </div>
        )}
      </div>
    </Section>
  );
}
