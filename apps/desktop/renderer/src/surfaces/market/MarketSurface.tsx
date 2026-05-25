import { useUiState } from '@/app/ui-state.js';
import { useListings } from '@/data/queries.js';
import type { Listing, ListingKind } from '@/data/types.js';
import { Chip } from '@/design-system/grammar/Chip.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import {
  SegmentedControl,
  type SegmentedOption,
} from '@/design-system/grammar/SegmentedControl.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { cn } from '@/lib/utils.js';
import { EmptyState, ErrorState, SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import {
  Box,
  Building2,
  Download,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Sparkles,
  Star,
  Store,
  UserRound,
  Workflow,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { type CSSProperties, useMemo, useState } from 'react';

const RARITY: Record<ListingKind, { rc: string; rcs: string; icon: LucideIcon }> = {
  employee: { rc: 'var(--off-accent)', rcs: 'var(--off-accent-surface)', icon: UserRound },
  skill: { rc: 'var(--off-violet)', rcs: 'var(--off-violet-surface)', icon: Sparkles },
  sop: { rc: 'var(--off-warn)', rcs: 'var(--off-warn-surface)', icon: Workflow },
  template: { rc: 'var(--off-violet)', rcs: 'var(--off-violet-surface)', icon: Building2 },
  layout: { rc: 'var(--off-danger)', rcs: 'var(--off-danger-surface)', icon: LayoutDashboard },
  prefab: { rc: 'var(--off-warn)', rcs: 'var(--off-warn-surface)', icon: Box },
  bundle: { rc: 'var(--off-ink-3)', rcs: 'var(--off-surface-sunken)', icon: Package },
};

type KindFilter = 'all' | ListingKind;
const KIND_FILTERS: ReadonlyArray<SegmentedOption<KindFilter>> = [
  { value: 'all', label: 'All' },
  { value: 'employee', label: 'People' },
  { value: 'skill', label: 'Skills' },
  { value: 'sop', label: 'SOPs' },
  { value: 'template', label: 'Templates' },
];

type SortKey = 'installs' | 'rating' | 'name';

function cardStyle(kind: ListingKind): CSSProperties {
  const r = RARITY[kind];
  return { '--rc': r.rc, '--rcs': r.rcs } as CSSProperties;
}

function compactInstalls(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function MarketDetail({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const rarity = RARITY[listing.kind];
  return (
    <motion.aside
      className="off-mkt-detail"
      style={cardStyle(listing.kind)}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="off-mkt-detail-head">
        <span className="off-mkt-cover-icon" style={{ width: 30, height: 30 }}>
          <Icon icon={rarity.icon} size="sm" />
        </span>
        <span className="off-mkt-kind">{listing.kind}</span>
        <span className="ml-auto">
          <IconButton icon={X} label="Close" variant="ghost" size="iconSm" onClick={onClose} />
        </span>
      </header>
      <div className="off-mkt-detail-scroll">
        <div>
          <div className="off-mkt-detail-title">{listing.name}</div>
          <div className="off-mkt-detail-summary">{listing.summary}</div>
        </div>
        <Button size="lg" style={{ background: rarity.rc }}>
          <Icon icon={Download} size="sm" />
          Install · {compactInstalls(listing.installs)} installs
        </Button>
        <div className="off-mkt-meta-grid">
          <div className="off-mkt-meta">
            <span className="off-mkt-meta-label">Version</span>
            <span className="off-mkt-meta-value">{listing.version}</span>
          </div>
          <div className="off-mkt-meta">
            <span className="off-mkt-meta-label">Rating</span>
            <span className="off-mkt-meta-value">{listing.rating.toFixed(1)}</span>
          </div>
          <div className="off-mkt-meta">
            <span className="off-mkt-meta-label">Installs</span>
            <span className="off-mkt-meta-value">{listing.installs.toLocaleString()}</span>
          </div>
          <div className="off-mkt-meta">
            <span className="off-mkt-meta-label">Creator</span>
            <span className="off-mkt-meta-value">@{listing.creator}</span>
          </div>
        </div>
        <div className="off-mkt-tags">
          {listing.tags.map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
        </div>
      </div>
    </motion.aside>
  );
}

export function MarketSurface() {
  const listings = useListings();
  const selectedListingId = useUiState((s) => s.selectedListingId);
  const selectListing = useUiState((s) => s.selectListing);
  const [kind, setKind] = useState<KindFilter>('all');
  const [sort, setSort] = useState<SortKey>('installs');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    let list = listings.data ?? [];
    if (kind !== 'all') list = list.filter((l) => l.kind === kind);
    const q = query.trim().toLowerCase();
    if (q)
      list = list.filter(
        (l) => l.name.toLowerCase().includes(q) || l.tags.some((t) => t.includes(q)),
      );
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'rating') return b.rating - a.rating;
      return b.installs - a.installs;
    });
  }, [listings.data, kind, sort, query]);

  const selected = listings.data?.find((l) => l.id === selectedListingId) ?? null;

  return (
    <div className="off-market">
      <div className="off-mkt-bar">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search market"
          className="off-mkt-search"
        />
        <SegmentedControl
          options={KIND_FILTERS}
          value={kind}
          onChange={setKind}
          ariaLabel="Filter by kind"
        />
        <span className="ml-auto" />
        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          options={[
            { value: 'installs', label: 'Most installed' },
            { value: 'rating', label: 'Top rated' },
            { value: 'name', label: 'Name' },
          ]}
        />
        <Button size="md">
          <Icon icon={Store} size="sm" />
          Publish
        </Button>
      </div>

      <div className="off-mkt-grid-wrap">
        <div className="off-mkt-scroll">
          {listings.isLoading ? (
            <SkeletonRows rows={8} className="p-[var(--off-sp-7)]" />
          ) : listings.isError ? (
            <ErrorState
              title="Market unavailable"
              detail="Couldn't reach the registry. The platform may be offline."
              onRetry={() => listings.refetch()}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Store}
              title={query || kind !== 'all' ? 'No matching listings' : 'Market is empty'}
              description={
                query || kind !== 'all'
                  ? 'Adjust your filters or search term.'
                  : 'Published employees, skills, and SOPs will appear here.'
              }
            />
          ) : (
            <div className="off-mkt-grid">
              {filtered.map((listing) => {
                const rarity = RARITY[listing.kind];
                return (
                  <button
                    type="button"
                    key={listing.id}
                    className={cn(
                      'off-mkt-card off-focusable',
                      listing.id === selectedListingId && 'is-active',
                    )}
                    style={cardStyle(listing.kind)}
                    onClick={() => selectListing(listing.id)}
                  >
                    <div className="off-mkt-cover">
                      <span className="off-mkt-cover-icon">
                        <Icon icon={rarity.icon} size="md" />
                      </span>
                      <span className="off-mkt-kind">{listing.kind}</span>
                    </div>
                    <div className="off-mkt-body">
                      <span className="off-mkt-name">{listing.name}</span>
                      <span className="off-mkt-summary">{listing.summary}</span>
                      <span className="off-mkt-stats">
                        <span className="off-mkt-stat is-rating">
                          <Icon icon={Star} size="sm" />
                          {listing.rating.toFixed(1)}
                        </span>
                        <span className="off-mkt-stat">
                          <Icon icon={Download} size="sm" />
                          <span className="off-mkt-mono">{compactInstalls(listing.installs)}</span>
                        </span>
                        <span className="off-mkt-creator">@{listing.creator}</span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {selected ? <MarketDetail listing={selected} onClose={() => selectListing(null)} /> : null}
      </div>
    </div>
  );
}
