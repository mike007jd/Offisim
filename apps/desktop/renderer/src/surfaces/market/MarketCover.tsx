import { Icon } from '@/design-system/icons/Icon.js';
import {
  Book,
  Box,
  Building2,
  LayoutGrid,
  type LucideIcon,
  Package,
  Sparkles,
  UserRound,
} from 'lucide-react';
import type { ListingKind, MarketListing } from './market-data.js';

/** Per-kind cover mini-illustration so the grid reads like a game inventory,
 *  not a SaaS settings list. 1:1 with the prototype `.kv-*` viz family. */
export function MarketCover({ listing }: { listing: MarketListing }) {
  switch (listing.kind) {
    case 'employee':
      return (
        <div className="off-kv off-kv-employee">
          <div
            className="off-kv-avatar"
            style={{ '--av-a': listing.avatarA, '--av-b': listing.avatarB } as React.CSSProperties}
          >
            {listing.initials ?? listing.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="off-kv-tags">
            {(listing.coverTags ?? listing.tags.slice(0, 3)).map((t) => (
              <span key={t} className="off-kv-tag">
                {t}
              </span>
            ))}
          </div>
        </div>
      );
    case 'skill':
      return (
        <div className="off-kv off-kv-skill">
          <div className="off-kv-perm-row">
            <span className={netClass(listing)}>
              <span className="off-kv-pd" />
              NET
            </span>
            <span className={fsClass(listing)}>
              <span className="off-kv-pd" />
              FS
            </span>
            <span className={secClass(listing)}>
              <span className="off-kv-pd" />
              SEC
            </span>
          </div>
          <div className="off-kv-caps">
            {listing.requirements.capabilities.slice(0, 1).map((c) => (
              <span key={c}>
                cap·<b>{c}</b>
              </span>
            ))}
            {listing.requirements.mcps.slice(0, 1).map((m) => (
              <span key={m}>
                <i>·</i>mcp·<b>{m}</b>
              </span>
            ))}
          </div>
        </div>
      );
    case 'sop':
      return (
        <div className="off-kv off-kv-sop">
          <div className="off-kv-pips">
            <span className="off-kv-pip is-done" />
            <span className="off-kv-line is-done" />
            <span className="off-kv-pip is-done" />
            <span className="off-kv-line is-done" />
            <span className="off-kv-pip is-cur" />
            <span className="off-kv-line" />
            <span className="off-kv-pip" />
            <span className="off-kv-line" />
            <span className="off-kv-pip" />
          </div>
          <div className="off-kv-roles">
            <em>PM</em>
            <i>→</i>
            <em>DSGN</em>
            <i>→</i>
            <em>DEV</em>
            <i>→</i>
            <em>QA</em>
            <i>→</i>
            <em>SHIP</em>
          </div>
        </div>
      );
    case 'template':
      return (
        <div className="off-kv off-kv-template">
          <div className="off-kv-ribbon">
            {(
              [
                ['PM', '#6a8dff'],
                ['UX', '#7c4ddb'],
                ['DEV', '#2f9f6a'],
                ['QA', '#e0763f'],
                ['OPS', '#647186'],
              ] as const
            ).map(([role, color]) => (
              <div key={role} className="off-kv-role" style={{ background: color }}>
                {role}
              </div>
            ))}
          </div>
        </div>
      );
    case 'layout':
      return (
        <div className="off-kv off-kv-layout">
          <svg
            viewBox="0 0 228 64"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Office layout preview"
          >
            <rect className="off-rm" x="4" y="5" width="220" height="54" rx="3" />
            <path className="off-wall" d="M82 5 L82 32" />
            <path className="off-wall" d="M150 32 L150 59" />
            <path className="off-wall" d="M82 32 L224 32" />
            {[20, 34, 48, 62].map((cx) => (
              <circle key={`t${cx}`} className="off-seat" cx={cx} cy="18" r="2.5" />
            ))}
            {[20, 34, 48, 62].map((cx) => (
              <circle key={`b${cx}`} className="off-seat" cx={cx} cy="46" r="2.5" />
            ))}
            <rect className="off-seat is-hi" x="100" y="12" width="42" height="14" rx="2" />
            <text className="off-lbl" x="105" y="22">
              Pitch
            </text>
            <rect className="off-seat" x="158" y="10" width="58" height="5" rx="1.5" />
            <rect className="off-seat" x="158" y="20" width="58" height="5" rx="1.5" />
            <rect className="off-seat" x="158" y="42" width="58" height="11" rx="2" />
          </svg>
        </div>
      );
    case 'prefab':
      return (
        <div className="off-kv off-kv-prefab">
          <svg
            viewBox="0 0 228 64"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Prefab preview"
          >
            <g transform="translate(114 32)">
              <circle className="off-ln" cx="0" cy="0" r="4" />
              <path className="off-fill" d="M -58 -16 L -22 -16 L -16 -8 L -52 -8 Z" />
              <path className="off-fill" d="M 22 -16 L 58 -16 L 52 -8 L 16 -8 Z" />
              <path className="off-fill" d="M -58 16 L -22 16 L -16 8 L -52 8 Z" />
              <path className="off-fill" d="M 22 16 L 58 16 L 52 8 L 16 8 Z" />
              <rect className="off-ln" x="-50" y="-23" width="6" height="6" />
              <rect className="off-ln" x="44" y="-23" width="6" height="6" />
              <rect className="off-ln" x="-50" y="17" width="6" height="6" />
              <rect className="off-ln" x="44" y="17" width="6" height="6" />
            </g>
          </svg>
        </div>
      );
    default:
      return (
        <div className="off-kv off-kv-bundle">
          <div className="off-kv-stack">
            <div className="off-kv-stack-item is-e">
              <Icon icon={UserRound} size="md" />
            </div>
            <div className="off-kv-stack-item is-s">
              <Icon icon={Sparkles} size="md" />
            </div>
            <div className="off-kv-stack-item is-o">
              <Icon icon={Book} size="md" />
            </div>
          </div>
        </div>
      );
  }
}

function netClass(l: MarketListing): string {
  return l.permissions.network === 'full'
    ? 'off-kv-perm is-warn'
    : l.permissions.network !== 'none'
      ? 'off-kv-perm is-on'
      : 'off-kv-perm';
}
function fsClass(l: MarketListing): string {
  return l.permissions.filesystem === 'system'
    ? 'off-kv-perm is-warn'
    : l.permissions.filesystem !== 'none'
      ? 'off-kv-perm is-on'
      : 'off-kv-perm';
}
function secClass(l: MarketListing): string {
  return l.permissions.secrets !== 'none' ? 'off-kv-perm is-warn' : 'off-kv-perm';
}

const KIND_ICON: Record<ListingKind, LucideIcon> = {
  employee: UserRound,
  skill: Sparkles,
  sop: Book,
  template: Building2,
  layout: LayoutGrid,
  prefab: Box,
  bundle: Package,
};

export function kindIcon(kind: ListingKind): LucideIcon {
  return KIND_ICON[kind];
}
