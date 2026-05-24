import type { ListingSummary } from '@offisim/registry-client';
import { Badge, Card, CardButton, cn } from '@offisim/ui-core';
import { BookTemplate, Download, Package, Star, UserPlus, Zap } from 'lucide-react';
import { rarityClassName } from './market-rarity.js';
import {
  INSTALLABLE_KINDS,
  KIND_ICON,
  formatCreatorVerificationLabel,
  formatInstallCount,
  formatMarketKindLabel,
  isVerifiedCreator,
} from './marketplace-meta.js';

export interface MarketListingCardProps {
  readonly listing: ListingSummary;
  readonly onClick: (listingId: string) => void;
  readonly installed?: boolean;
  readonly selected?: boolean;
  readonly featured?: boolean;
}

const TEMPLATE_ROLES = ['PM', 'UX', 'DEV', 'QA', 'OPS'] as const;
const BUNDLE_ICONS = [UserPlus, Zap, BookTemplate, Package] as const;

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
  const verified = isVerifiedCreator(verification);
  const kindLabel = formatMarketKindLabel(listing.kind);

  return (
    <Card
      className={cn(
        'market-listing-card',
        rarityClassName(listing.kind),
        featured && 'market-listing-card-featured',
        selected && 'market-listing-card-selected',
      )}
      data-kind={listing.kind}
    >
      <CardButton
        aria-label={`Open ${listing.title}`}
        onClick={() => onClick(listing.listing_id)}
        selected={selected}
      />

      <div className="market-listing-card-shell">
        <div className="market-listing-cover">
          <KindPreview listing={listing} />

          {showInstalled && (
            <Badge variant="success" size="xs" className="market-listing-installed">
              Installed
            </Badge>
          )}

          <Badge variant="outline" size="xs" className="market-listing-kind" title={kindLabel}>
            {Icon && <Icon data-icon="kind" aria-hidden="true" />}
            {kindLabel}
          </Badge>
        </div>

        <div className="market-listing-body">
          <div className="market-listing-heading">
            <div className="market-listing-title" title={listing.title}>
              {listing.title}
            </div>
            <div className="market-listing-handle">@{listing.creator.handle}</div>
          </div>

          <p className="market-listing-summary">{listing.summary}</p>

          <div className="market-listing-stats">
            <Badge variant="warning" size="xs" className="market-listing-stat" data-stat="rating">
              <Star data-icon="rating" aria-hidden="true" />
              {listing.rating.toFixed(1)}
            </Badge>
            <Badge
              variant="secondary"
              size="xs"
              className="market-listing-stat"
              data-stat="installs"
            >
              <Download data-icon="installs" aria-hidden="true" />
              {formatInstallCount(listing.install_count)}
            </Badge>
            <span className="market-listing-creator">
              {verified && (
                <span
                  className="market-listing-verified"
                  title={formatCreatorVerificationLabel(verification)}
                />
              )}
              <span className="market-listing-creator-label">
                {verified
                  ? formatCreatorVerificationLabel(verification)
                  : `@${listing.creator.handle}`}
              </span>
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function KindPreview({ listing }: { listing: ListingSummary }) {
  switch (listing.kind) {
    case 'employee':
      return <EmployeePreview listing={listing} />;
    case 'skill':
      return <SkillPreview listing={listing} />;
    case 'sop':
      return <SopPreview />;
    case 'company_template':
      return <TemplatePreview />;
    case 'office_layout':
      return <LayoutPreview />;
    case 'prefab':
      return <PrefabPreview />;
    case 'bundle':
      return <BundlePreview />;
    default:
      return <BundlePreview />;
  }
}

function EmployeePreview({ listing }: { listing: ListingSummary }) {
  const tags = listing.tags?.slice(0, 3) ?? [];
  return (
    <div className="market-kind-preview" data-kind="employee">
      <div className="market-kind-avatar">{initialsForTitle(listing.title)}</div>
      <div className="market-kind-tags">
        {tags.map((tag) => (
          <span key={tag} className="market-kind-tag">
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

function SkillPreview({ listing }: { listing: ListingSummary }) {
  const caps = (listing.tags ?? []).slice(0, 2);
  return (
    <div className="market-kind-preview" data-kind="skill">
      <div className="market-kind-permissions">
        {['NET', 'FS', 'SEC'].map((label, index) => (
          <span key={label} className="market-kind-permission" data-active={index === 0}>
            <span className="market-kind-permission-dot" />
            {label}
          </span>
        ))}
      </div>
      <div className="market-kind-caps">
        {(caps.length > 0 ? caps : ['capability']).map((cap) => (
          <span key={cap} className="market-kind-cap">
            cap·<b>{cap}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function SopPreview() {
  return (
    <div className="market-kind-preview" data-kind="sop">
      <div className="market-kind-pipeline">
        {[0, 1, 2, 3, 4].map((index) => (
          <span key={index} className="market-kind-pipeline-step">
            <span className="market-kind-pipeline-dot" data-state={index < 2 ? 'done' : 'idle'} />
            {index < 4 && (
              <span
                className="market-kind-pipeline-line"
                data-state={index < 2 ? 'done' : 'idle'}
              />
            )}
          </span>
        ))}
      </div>
      <div className="market-kind-roles">
        <span>PM</span>
        <span>DSGN</span>
        <span>DEV</span>
        <span>QA</span>
        <span>SHIP</span>
      </div>
    </div>
  );
}

function TemplatePreview() {
  return (
    <div className="market-kind-preview" data-kind="company_template">
      <div className="market-kind-role-strip">
        {TEMPLATE_ROLES.map((role) => (
          <span key={role} className="market-kind-role" data-role={role.toLowerCase()}>
            {role}
          </span>
        ))}
      </div>
    </div>
  );
}

function LayoutPreview() {
  return (
    <div className="market-kind-preview" data-kind="office_layout">
      <span className="market-kind-layout-zone" data-zone="team" />
      <span className="market-kind-layout-zone" data-zone="focus" />
      <span className="market-kind-layout-zone" data-zone="meeting" />
      <span className="market-kind-layout-zone" data-zone="support" />
    </div>
  );
}

function PrefabPreview() {
  return (
    <div className="market-kind-preview" data-kind="prefab">
      <span className="market-kind-prefab-piece" data-piece="desk" />
      <span className="market-kind-prefab-piece" data-piece="anchor" />
      <span className="market-kind-prefab-piece" data-piece="desk" />
    </div>
  );
}

function BundlePreview() {
  return (
    <div className="market-kind-preview" data-kind="bundle">
      <div className="market-kind-bundle-stack">
        {BUNDLE_ICONS.map((StackIcon, index) => (
          <span key={StackIcon.displayName ?? index} className="market-kind-bundle-item">
            <StackIcon data-icon="bundle-item" aria-hidden="true" />
          </span>
        ))}
      </div>
    </div>
  );
}

function initialsForTitle(title: string): string {
  return title
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
