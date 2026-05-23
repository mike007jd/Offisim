import type { AssetKind } from '@offisim/asset-schema';
import type { ListingSummary } from '@offisim/registry-client';
import { cn } from '@offisim/ui-core';
import type { LucideIcon } from 'lucide-react';
import { Book, Box, Building2, LayoutGrid, UserPlus, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { getRarityClasses } from './market-rarity.js';
import { KIND_ICON } from './marketplace-meta.js';

const KINDS_WITH_VIZ = new Set<AssetKind>([
  'employee',
  'skill',
  'sop',
  'company_template',
  'office_layout',
  'prefab',
  'bundle',
]);

export function hasCoverViz(kind: AssetKind): boolean {
  return KINDS_WITH_VIZ.has(kind);
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '..';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return ((words[0]?.[0] ?? '') + (words[words.length - 1]?.[0] ?? '')).toUpperCase();
}

const AVATAR_TONES = ['bg-accent', 'bg-violet', 'bg-ok', 'bg-danger'] as const;
const ROLE_TONES = ['bg-accent', 'bg-violet', 'bg-ok', 'bg-danger', 'bg-ink-3'] as const;
const PERM_ROW = ['NET', 'FS', 'SEC'] as const;

function EmployeeViz({ listing }: { listing: ListingSummary }) {
  const seed = hashString(listing.listing_id);
  const tone = AVATAR_TONES[seed % AVATAR_TONES.length] ?? AVATAR_TONES[0];
  const tags = (listing.tags ?? []).slice(0, 3);
  return (
    <div className="absolute inset-x-3 inset-y-2 flex items-center gap-3">
      <div
        className={cn(
          'grid size-14 flex-none place-items-center rounded-full text-lg font-bold text-white shadow-elev-1',
          tone,
        )}
      >
        {initials(listing.title)}
      </div>
      {tags.length > 0 && (
        <div className="flex max-h-14 min-w-0 flex-1 flex-wrap content-center gap-1 overflow-hidden">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex h-5 items-center whitespace-nowrap rounded-r-xs border border-line-soft bg-surface-1 px-2 font-mono text-fs-meta font-semibold text-ink-2"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SkillViz({ listing }: { listing: ListingSummary }) {
  const seed = hashString(listing.listing_id);
  const onIndex = seed % PERM_ROW.length;
  const tags = (listing.tags ?? []).slice(0, 2);
  const rarity = getRarityClasses(listing.kind);
  return (
    <div className="absolute inset-x-3 inset-y-2 flex flex-col justify-center gap-2">
      <div className="flex gap-1.5">
        {PERM_ROW.map((perm, i) => {
          const on = i === onIndex;
          return (
            <span
              key={perm}
              className={cn(
                'flex h-6 flex-1 items-center gap-1.5 rounded-r-xs border px-2 text-fs-meta font-bold uppercase tracking-wide',
                on
                  ? cn('border-current bg-surface-1', rarity.accent)
                  : 'border-line-soft bg-surface-1 text-ink-4',
              )}
            >
              <span
                className={cn(
                  'size-1.5 flex-none rounded-full',
                  on ? rarity.accentBg : 'bg-ink-4',
                )}
              />
              {perm}
            </span>
          );
        })}
      </div>
      <div className="flex items-center justify-center gap-2 font-mono text-fs-meta text-ink-3">
        {tags.length > 0 ? (
          tags.map((tag, i) => (
            <span key={tag} className="inline-flex items-center gap-1">
              {i > 0 && <i className="not-italic text-ink-4">·</i>}
              cap·<b className={cn('font-bold', rarity.accent)}>{tag}</b>
            </span>
          ))
        ) : (
          <span>capability skill</span>
        )}
      </div>
    </div>
  );
}

function sopPipClass(index: number, current: number, activeTone: string): string {
  if (index === current) return cn('border-current shadow-elev-1', activeTone);
  if (index < current) return 'border-ok bg-ok';
  return 'border-line-strong bg-surface-1';
}

function SopViz({ listing }: { listing: ListingSummary }) {
  const seed = hashString(listing.listing_id);
  const steps = 4 + (seed % 3);
  const current = 1 + (seed % Math.max(1, steps - 1));
  const roles = ['PM', 'DSGN', 'DEV', 'QA', 'SHIP', 'OPS'];
  const rarity = getRarityClasses(listing.kind);
  return (
    <div className="absolute inset-x-4 inset-y-2 flex flex-col justify-center gap-2.5">
      <div className="flex h-4 items-center">
        {Array.from({ length: steps }).map((_, i) => (
          <span key={`pip-${listing.listing_id}-${i}`} className="contents">
            <span
              className={cn(
                'size-3 flex-none rounded-full border-2',
                sopPipClass(i, current, rarity.accentBg),
              )}
            />
            {i < steps - 1 && (
              <span className={cn('h-0.5 flex-1', i < current - 1 ? 'bg-ok' : 'bg-line-strong')} />
            )}
          </span>
        ))}
      </div>
      <div className="flex items-center justify-center gap-1 font-mono text-fs-meta font-bold uppercase tracking-wide text-ink-3">
        {roles.slice(0, steps).map((role, i) => (
          <span key={role} className="contents">
            {i > 0 && <i className="not-italic text-ink-4">→</i>}
            <em className={cn('not-italic font-bold', rarity.accent)}>{role}</em>
          </span>
        ))}
      </div>
    </div>
  );
}

function TemplateViz({ listing }: { listing: ListingSummary }) {
  const seed = hashString(listing.listing_id);
  const count = 4 + (seed % 3);
  const roles = ['PM', 'UX', 'DEV', 'QA', 'OPS', 'GROW'];
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="flex gap-1">
        {roles.slice(0, count).map((role, i) => (
          <div
            key={role}
            className={cn(
              'grid h-14 w-9 place-items-center rounded-r-xs border border-white/20 text-xs font-bold text-white shadow-elev-1',
              ROLE_TONES[i % ROLE_TONES.length],
            )}
          >
            {role}
          </div>
        ))}
      </div>
    </div>
  );
}

function SvgVizFrame({ children, kind }: { children: ReactNode; kind: AssetKind }) {
  const rarity = getRarityClasses(kind);
  return (
    <div className={cn('absolute inset-0 flex items-center justify-center px-3 py-1', rarity.accent)}>
      <svg
        viewBox="0 0 228 64"
        preserveAspectRatio="xMidYMid meet"
        className="block h-16 w-full max-w-xs"
        aria-hidden="true"
      >
        {children}
      </svg>
    </div>
  );
}

function LayoutViz({ kind }: { kind: AssetKind }) {
  return (
    <SvgVizFrame kind={kind}>
      <rect x="4" y="5" width="220" height="54" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.75" />
      <path d="M82 5 L82 32" stroke="currentColor" strokeWidth="1" opacity="0.45" />
      <path d="M150 32 L150 59" stroke="currentColor" strokeWidth="1" opacity="0.45" />
      <path d="M82 32 L224 32" stroke="currentColor" strokeWidth="1" opacity="0.45" />
      {[20, 34, 48, 62].map((cx) => (
        <circle key={`t-${cx}`} cx={cx} cy="18" r="2.5" fill="currentColor" opacity="0.55" />
      ))}
      {[20, 34, 48, 62].map((cx) => (
        <circle key={`b-${cx}`} cx={cx} cy="46" r="2.5" fill="currentColor" opacity="0.55" />
      ))}
      <rect x="100" y="12" width="42" height="14" rx="2" fill="currentColor" opacity="0.9" />
      <text x="105" y="22" fill="currentColor" fontSize="7.5" fontFamily="var(--mono)" fontWeight="700">
        PITCH
      </text>
      <rect x="158" y="10" width="58" height="5" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="158" y="20" width="58" height="5" rx="1.5" fill="currentColor" opacity="0.55" />
      <rect x="158" y="42" width="58" height="11" rx="2" fill="currentColor" opacity="0.55" />
    </SvgVizFrame>
  );
}

function PrefabViz({ kind }: { kind: AssetKind }) {
  return (
    <SvgVizFrame kind={kind}>
      <g transform="translate(114 32)" stroke="currentColor" strokeLinejoin="round" strokeLinecap="round">
        <circle cx="0" cy="0" r="4" fill="none" strokeWidth="1.5" opacity="0.85" />
        {[
          'M -58 -16 L -22 -16 L -16 -8 L -52 -8 Z',
          'M 22 -16 L 58 -16 L 52 -8 L 16 -8 Z',
          'M -58 16 L -22 16 L -16 8 L -52 8 Z',
          'M 22 16 L 58 16 L 52 8 L 16 8 Z',
        ].map((d) => (
          <path key={d} d={d} fill="currentColor" strokeWidth="1.2" opacity="0.18" />
        ))}
        <rect x="-50" y="-23" width="6" height="6" fill="none" strokeWidth="1.5" opacity="0.85" />
        <rect x="44" y="-23" width="6" height="6" fill="none" strokeWidth="1.5" opacity="0.85" />
        <rect x="-50" y="17" width="6" height="6" fill="none" strokeWidth="1.5" opacity="0.85" />
        <rect x="44" y="17" width="6" height="6" fill="none" strokeWidth="1.5" opacity="0.85" />
      </g>
    </SvgVizFrame>
  );
}

const BUNDLE_STACK: Array<{ icon: LucideIcon; tone: string; offset: string }> = [
  { icon: UserPlus, tone: 'text-accent', offset: '' },
  { icon: Zap, tone: 'text-violet', offset: '-ml-3' },
  { icon: Book, tone: 'text-warn', offset: '-ml-3' },
];

function BundleViz() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="flex">
        {BUNDLE_STACK.map(({ icon: Icon, tone, offset }) => (
          <div
            key={tone}
            className={cn(
              'grid size-12 place-items-center rounded-r-sm border border-line bg-surface-1 shadow-elev-1',
              tone,
              offset,
            )}
          >
            <Icon className="size-6" aria-hidden="true" />
          </div>
        ))}
      </div>
    </div>
  );
}

const ICON_ONLY_FALLBACK: Record<AssetKind, LucideIcon> = {
  employee: UserPlus,
  skill: Zap,
  sop: Book,
  company_template: Building2,
  office_layout: LayoutGrid,
  prefab: Box,
  bundle: Box,
};

export interface MarketCoverVizProps {
  readonly listing: ListingSummary;
}

export function MarketCoverViz({ listing }: MarketCoverVizProps) {
  switch (listing.kind) {
    case 'employee':
      return <EmployeeViz listing={listing} />;
    case 'skill':
      return <SkillViz listing={listing} />;
    case 'sop':
      return <SopViz listing={listing} />;
    case 'company_template':
      return <TemplateViz listing={listing} />;
    case 'office_layout':
      return <LayoutViz kind={listing.kind} />;
    case 'prefab':
      return <PrefabViz kind={listing.kind} />;
    case 'bundle':
      return <BundleViz />;
    default:
      return <CoverIconTile kind={listing.kind} />;
  }
}

export function CoverIconTile({ kind }: { kind: AssetKind }) {
  const Icon = ICON_ONLY_FALLBACK[kind] ?? KIND_ICON[kind];
  const rarity = getRarityClasses(kind);
  return (
    <div
      className={cn(
        'absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-r-sm border border-line bg-surface-1 shadow-elev-1',
        rarity.accent,
      )}
    >
      {Icon && <Icon className="size-6" aria-hidden="true" />}
    </div>
  );
}
