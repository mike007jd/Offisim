import { INSTALLABLE_KINDS, type MarketListing } from '@/data/market/types.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { Download, Star } from 'lucide-react';
import type { CSSProperties } from 'react';
import { MarketCover, kindIcon } from './MarketCover.js';
import { compactInstalls, getRarityTone } from './market-presentation.js';

interface MarketCardProps {
  listing: MarketListing;
  installed: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}

export function MarketCard({ listing, installed, selected, onSelect, onOpen }: MarketCardProps) {
  const tone = getRarityTone(listing.kind);
  const badgeIcon = kindIcon(listing.kind);
  const showInstalledPip = installed && INSTALLABLE_KINDS.has(listing.kind);

  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onOpen();
        }
      }}
      aria-pressed={selected}
      className={cn('off-mkt-card off-focusable', selected && 'is-selected')}
      style={{ '--rc': tone.rc, '--rcs': tone.rcs } as CSSProperties}
    >
      <div className="off-mc-cover">
        <MarketCover listing={listing} />
        {showInstalledPip ? <span className="off-mc-installed">Installed</span> : null}
        <span className="off-mc-badge">
          <Icon icon={badgeIcon} size="sm" />
          {listing.kind}
        </span>
      </div>
      <div className="off-mc-body">
        <div className="off-mc-handle">
          <span className="off-mc-handle-h">@{listing.handle}</span>
          {listing.verified ? <span className="off-mc-vdot" title="Verified publisher" /> : null}
        </div>
        <div className="off-mc-title">{listing.name}</div>
        <p className="off-mc-summary">{listing.summary}</p>
        <div className="off-mc-stats">
          <span className="off-mc-stat-chip is-stars">
            <Icon icon={Star} size="sm" className="off-icon-fill" />
            {listing.rating.toFixed(1)}
          </span>
          <span className="off-mc-stat-chip is-installs">
            <Icon icon={Download} size="sm" />
            {compactInstalls(listing.installs)}
          </span>
        </div>
      </div>
    </button>
  );
}
