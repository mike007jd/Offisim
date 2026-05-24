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
        'group relative h-market-listing-card overflow-hidden rounded-r-md bg-surface-1 p-0 shadow-elev-1 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-line-strong hover:shadow-elev-2',
        rarityClassName(listing.kind),
        featured && 'col-span-2',
        selected ? 'market-rarity-border' : 'border-line-soft',
      )}
    >
      <CardButton
        aria-label={`Open ${listing.title}`}
        onClick={() => onClick(listing.listing_id)}
        selected={selected}
      />

      <div className="pointer-events-none flex h-full flex-col overflow-hidden">
        <span
          className="market-rarity-stripe pointer-events-none absolute inset-x-0 top-0 z-elevated h-1 opacity-90"
          aria-hidden="true"
        />

        <div className="market-card-cover relative h-market-card-cover border-b border-line-soft">
          <div className="absolute inset-x-3 bottom-2 top-3">
            <KindPreview listing={listing} />
          </div>
          {showInstalled && (
            <Badge
              variant="success"
              size="xs"
              className="absolute left-2 top-2 z-elevated h-5 shrink-0 rounded-r-pill px-2 font-bold uppercase tracking-wide"
            >
              Installed
            </Badge>
          )}
          <Badge
            variant="outline"
            size="xs"
            className="market-rarity-chip absolute right-2 top-2 z-elevated h-5 max-w-32 shrink-0 gap-1 truncate rounded-r-pill px-2 font-bold uppercase tracking-wide"
            title={kindLabel}
          >
            {Icon && <Icon className="size-3" aria-hidden="true" />}
            {kindLabel}
          </Badge>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2.5">
          <div className="min-w-0">
            <div
              className="truncate text-fs-md font-bold leading-tight text-ink-1"
              title={listing.title}
            >
              {listing.title}
            </div>
            <div className="mt-0.5 truncate font-mono text-fs-meta font-semibold text-ink-4">
              @{listing.creator.handle}
            </div>
          </div>
          <p className="line-clamp-2 text-fs-sm leading-snug text-ink-3">{listing.summary}</p>

          <div className="mt-auto flex items-center gap-1.5 border-t border-line-soft pt-2">
            <Badge
              variant="warning"
              size="xs"
              className="h-5 shrink-0 gap-1 rounded-r-xs px-2 font-semibold tabular-nums"
            >
              <Star className="size-3 fill-current" aria-hidden="true" />
              {listing.rating.toFixed(1)}
            </Badge>
            <Badge
              variant="secondary"
              size="xs"
              className="h-5 shrink-0 gap-1 rounded-r-xs border-transparent bg-surface-sunken px-2 font-mono font-semibold tabular-nums text-ink-2"
            >
              <Download className="size-3 text-ink-4" aria-hidden="true" />
              {formatInstallCount(listing.install_count)}
            </Badge>
            <span className="ml-auto inline-flex min-w-0 items-center gap-1 truncate pl-1 font-mono text-fs-meta font-semibold text-ink-4">
              {verified && (
                <span
                  className="inline-block size-1.5 flex-none rounded-full bg-accent"
                  title={formatCreatorVerificationLabel(verification)}
                />
              )}
              <span className="truncate">
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
  const tags = listing.tags?.slice(0, 4) ?? [];
  return (
    <div className="flex h-full items-center gap-3">
      <div className="market-rarity-tile grid size-14 shrink-0 place-items-center rounded-full border bg-surface-1 text-fs-lg font-bold">
        {initialsForTitle(listing.title)}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap content-center gap-1">
        {tags.map((tag) => (
          <span
            key={tag}
            className="max-w-full truncate rounded-r-xs border border-line-soft bg-surface-1 px-2 py-0.5 font-mono text-fs-meta font-semibold text-ink-3"
          >
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
    <div className="flex h-full flex-col justify-center gap-2">
      <div className="grid grid-cols-3 gap-1.5">
        {['NET', 'FS', 'SEC'].map((label, index) => (
          <span
            key={label}
            className={cn(
              'flex h-6 items-center gap-1.5 rounded-r-xs border border-line-soft bg-surface-1 px-2 font-mono text-fs-meta font-bold text-ink-4',
              index === 0 && 'market-rarity-chip',
            )}
          >
            <span className="size-1.5 rounded-full bg-current" />
            {label}
          </span>
        ))}
      </div>
      <div className="flex justify-center gap-2 font-mono text-fs-meta text-ink-3">
        {(caps.length > 0 ? caps : ['capability']).map((cap) => (
          <span key={cap} className="truncate">
            cap·<b className="market-rarity-tile font-bold">{cap}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function SopPreview() {
  return (
    <div className="flex h-full flex-col justify-center gap-3 px-1">
      <div className="flex items-center">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="flex flex-1 items-center last:flex-none">
            <span
              className={cn(
                'size-3 rounded-full border border-line-strong bg-surface-1',
                index < 2 && 'bg-success',
                index === 2 && 'market-rarity-cta shadow-overlay',
              )}
            />
            {index < 4 && (
              <span className={cn('h-0.5 flex-1 bg-line-strong', index < 2 && 'bg-success')} />
            )}
          </div>
        ))}
      </div>
      <div className="text-center font-mono text-fs-meta font-bold uppercase tracking-wide text-ink-3">
        PM → Dsgn → Dev → QA → Ship
      </div>
    </div>
  );
}

function TemplatePreview() {
  return (
    <div className="flex h-full items-center justify-center gap-1.5">
      {[
        ['PM', 'bg-accent'],
        ['UX', 'bg-violet'],
        ['DEV', 'bg-success'],
        ['QA', 'bg-danger'],
        ['OPS', 'bg-text-secondary'],
      ].map(([label, className]) => (
        <span
          key={label}
          className={cn(
            'market-template-seat grid place-items-center rounded-r-xs text-fs-sm font-bold text-white shadow-elev-1',
            className,
          )}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function LayoutPreview() {
  return (
    <div className="grid h-full place-items-center">
      <div className="grid-market-layout-preview grid h-14 w-full gap-1 rounded-r-sm border border-current p-1 text-current opacity-80">
        <div className="rounded-r-xs border border-current p-1">
          <div className="grid grid-cols-4 gap-1">
            {Array.from({ length: 8 }).map((_, index) => (
              <span key={index} className="h-1.5 rounded-full bg-current opacity-55" />
            ))}
          </div>
        </div>
        <div className="grid gap-1">
          <span className="rounded-r-xs bg-current opacity-25" />
          <span className="rounded-r-xs bg-current opacity-45" />
        </div>
      </div>
    </div>
  );
}

function PrefabPreview() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex items-center gap-2 text-current opacity-80">
        <span className="market-prefab-wing skew-x-12 rounded-r-xs bg-current opacity-20" />
        <span className="size-3 rounded-full border-2 border-current" />
        <span className="market-prefab-wing -skew-x-12 rounded-r-xs bg-current opacity-20" />
      </div>
    </div>
  );
}

function BundlePreview() {
  const IconSet = [UserPlus, Zap, BookTemplate, Package];
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex">
        {IconSet.map((StackIcon, index) => (
          <span
            key={StackIcon.displayName ?? index}
            className="-ml-2 grid size-12 first:ml-0 place-items-center rounded-r-sm border border-line-soft bg-surface-1 shadow-elev-1"
          >
            <StackIcon className="market-rarity-tile size-5" aria-hidden="true" />
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
