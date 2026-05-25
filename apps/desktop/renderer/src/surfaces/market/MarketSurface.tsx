import { useUiState } from '@/app/ui-state.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import {
  SegmentedControl,
  type SegmentedOption,
} from '@/design-system/grammar/SegmentedControl.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { cn } from '@/lib/utils.js';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Box,
  Building2,
  ChevronDown,
  CloudUpload,
  Layers,
  LayoutGrid,
  Loader2,
  Search,
  Sparkles,
  Store,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { InstallDialog } from './InstallDialog.js';
import { MarketCard } from './MarketCard.js';
import { MarketDetail } from './MarketDetail.js';
import { MarketManage } from './MarketManage.js';
import { PublishDialog } from './PublishDialog.js';
import {
  type ListingKind,
  type ManageView,
  type MarketListing,
  useMarketListings,
  usePublishSources,
} from './market-data.js';
import { type SortKey, useMarketUi } from './market-store.js';

type KindFilter = 'all' | ListingKind;

const KIND_FILTERS: ReadonlyArray<SegmentedOption<KindFilter>> = [
  { value: 'all', label: 'All' },
  { value: 'employee', label: 'Employees', icon: <Icon icon={UserRound} size="sm" /> },
  { value: 'skill', label: 'Skills', icon: <Icon icon={Sparkles} size="sm" /> },
  { value: 'template', label: 'Templates', icon: <Icon icon={Building2} size="sm" /> },
  { value: 'layout', label: 'Layouts', icon: <Icon icon={LayoutGrid} size="sm" /> },
  { value: 'prefab', label: 'Prefabs', icon: <Icon icon={Box} size="sm" /> },
];

const SORTS: ReadonlyArray<SegmentedOption<SortKey>> = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'newest', label: 'Newest' },
  { value: 'rating', label: 'Rating' },
  { value: 'installs', label: 'Installs' },
];

const MANAGE_VIEWS: ReadonlyArray<SegmentedOption<ManageView>> = [
  { value: 'installed', label: 'Installed', icon: <Icon icon={Layers} size="sm" /> },
  { value: 'updates', label: 'Updates' },
  { value: 'published', label: 'Published' },
];

const MIN_CARD = 216;
const GAP = 14;
/** Card (200) + the per-row top spacing (sp-7 = 16) used as inter-row rhythm. */
const ROW_HEIGHT = 216;

export function MarketSurface() {
  const listings = useMarketListings();
  const sources = usePublishSources();
  const selectedListingId = useUiState((s) => s.selectedListingId);
  const selectListing = useUiState((s) => s.selectListing);

  const mode = useMarketUi((s) => s.mode);
  const setMode = useMarketUi((s) => s.setMode);
  const manageView = useMarketUi((s) => s.manageView);
  const setManageView = useMarketUi((s) => s.setManageView);
  const sessionInstalledIds = useMarketUi((s) => s.sessionInstalledIds);
  const markInstalled = useMarketUi((s) => s.markInstalled);

  const [kind, setKind] = useState<KindFilter>('all');
  const [sort, setSort] = useState<SortKey>('relevance');
  const [query, setQuery] = useState('');
  const [installTarget, setInstallTarget] = useState<MarketListing | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const isInstalled = (l: MarketListing) => l.installed || sessionInstalledIds.has(l.id);

  const filtered = useMemo(() => {
    let list = listings.data ?? [];
    if (kind !== 'all') list = list.filter((l) => l.kind === kind);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.summary.toLowerCase().includes(q) ||
          l.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    const sorted = [...list];
    if (sort === 'rating') sorted.sort((a, b) => b.rating - a.rating);
    else if (sort === 'installs') sorted.sort((a, b) => b.installs - a.installs);
    else if (sort === 'newest')
      sorted.sort((a, b) => b.publishedLabel.localeCompare(a.publishedLabel));
    return sorted;
  }, [listings.data, kind, sort, query]);

  const selected = (listings.data ?? []).find((l) => l.id === selectedListingId) ?? null;
  const detailOpen = selected !== null && mode === 'explore';

  function resetFilters() {
    setKind('all');
    setQuery('');
    setSort('relevance');
  }

  function openInstall(listing: MarketListing) {
    setInstallTarget(listing);
    setInstallOpen(true);
  }

  return (
    <div className={cn('off-market', detailOpen && 'is-with-detail')}>
      <div className="off-mkt-fbar">
        <div className="off-mkt-fbar-main">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search packages…"
            className="off-mkt-search"
          />
          {mode === 'explore' ? (
            <>
              <SegmentedControl
                options={KIND_FILTERS}
                value={kind}
                onChange={setKind}
                wrap
                ariaLabel="Filter by kind"
              />
              <SegmentedControl options={SORTS} value={sort} onChange={setSort} ariaLabel="Sort" />
            </>
          ) : null}
          <ModeDropdown mode={mode} onChange={setMode} />
          {mode === 'explore' ? (
            <Button
              size="md"
              variant="outline"
              className="ml-auto"
              onClick={() => setPublishOpen(true)}
            >
              <Icon icon={CloudUpload} size="sm" />
              Publish
            </Button>
          ) : null}
        </div>
        {mode === 'manage' ? (
          <div className="off-mkt-fbar-sub">
            <span className="off-mkt-fbar-lbl">View</span>
            <SegmentedControl
              options={MANAGE_VIEWS}
              value={manageView}
              onChange={setManageView}
              ariaLabel="Manage view"
            />
          </div>
        ) : null}
      </div>

      <div className="off-mkt-grid-wrap">
        {mode === 'manage' ? (
          <div className="off-mkt-listing">
            <MarketManage
              view={manageView}
              onBrowseExplore={() => setMode('explore')}
              onPublish={() => setPublishOpen(true)}
            />
          </div>
        ) : listings.isLoading ? (
          <SkeletonGrid />
        ) : listings.isError ? (
          <MarketErrorState onRetry={() => listings.refetch()} />
        ) : filtered.length === 0 ? (
          <MarketEmptyState filtered={query !== '' || kind !== 'all'} onReset={resetFilters} />
        ) : (
          <CardGrid
            listings={filtered}
            selectedId={selectedListingId}
            isInstalled={isInstalled}
            onSelect={(id) => selectListing(id)}
          />
        )}
        {detailOpen && selected ? (
          <MarketDetail
            listing={selected}
            installed={isInstalled(selected)}
            onClose={() => selectListing(null)}
            onInstall={() => openInstall(selected)}
          />
        ) : null}
      </div>

      <InstallDialog
        listing={installTarget}
        open={installOpen}
        onOpenChange={setInstallOpen}
        onInstalled={markInstalled}
      />
      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        sources={sources.data ?? []}
      />
    </div>
  );
}

function ModeDropdown({
  mode,
  onChange,
}: {
  mode: 'explore' | 'manage';
  onChange: (m: 'explore' | 'manage') => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="off-mkt-drop off-focusable" aria-label="Marketplace mode">
          {mode === 'explore' ? 'Explore' : 'Manage'}
          <Icon icon={ChevronDown} size="sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => onChange('explore')}>Explore</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange('manage')}>Manage</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Virtualized responsive card grid. Columns are derived from container width
 *  (auto-fill minmax(216px,1fr)); TanStack Virtual virtualizes the rows so a
 *  long registry stays smooth. */
function CardGrid({
  listings,
  selectedId,
  isInstalled,
  onSelect,
}: {
  listings: MarketListing[];
  selectedId: string | null;
  isInstalled: (l: MarketListing) => boolean;
  onSelect: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(3);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const compute = () => {
      const inner = el.clientWidth - GAP * 2;
      const next = Math.max(1, Math.floor((inner + GAP) / (MIN_CARD + GAP)));
      setCols(next);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowCount = Math.ceil(listings.length / cols);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });

  // Re-measure when column count changes the row layout.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cols is the intended trigger — the body re-measures the virtualizer whenever the column count changes.
  useEffect(() => {
    virtualizer.measure();
  }, [cols, virtualizer]);

  return (
    <div className="off-mkt-scroll" ref={scrollRef}>
      <div
        className="off-mkt-vgrid"
        style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const start = row.index * cols;
          const items = listings.slice(start, start + cols);
          return (
            <div
              key={row.key}
              className="off-mkt-vrow"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                transform: `translateY(${row.start}px)`,
              }}
            >
              {items.map((listing) => (
                <MarketCard
                  key={listing.id}
                  listing={listing}
                  installed={isInstalled(listing)}
                  selected={listing.id === selectedId}
                  onSelect={() => onSelect(listing.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="off-mkt-scroll">
      <div className="off-mkt-skel-grid">
        {Array.from({ length: 8 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          <div key={i} className="off-mkt-skel">
            <div className="off-mkt-skel-cover" />
            <div className="off-mkt-skel-body">
              <div className="off-mkt-sk" style={{ height: 11, width: '60%' }} />
              <div className="off-mkt-sk" style={{ height: 13, width: '80%' }} />
              <div className="off-mkt-sk" style={{ height: 11, width: '100%' }} />
              <div className="off-mkt-sk" style={{ height: 11, width: '60%' }} />
              <div className="off-mkt-skel-stats">
                <div className="off-mkt-sk" style={{ height: 11, width: 30 }} />
                <div className="off-mkt-sk" style={{ height: 11, width: 46 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarketErrorState({ onRetry }: { onRetry: () => void }) {
  const setSurface = useUiState((s) => s.setSurface);
  return (
    <div className="off-mkt-scroll off-mkt-hero-wrap">
      <div className="off-mkt-hero">
        <span className="off-mkt-hero-i is-danger">
          <Icon icon={WifiOff} size="md" />
        </span>
        <div className="off-mkt-hero-t">Market is unavailable</div>
        <div className="off-mkt-hero-d">
          Couldn't reach the marketplace service. The platform may be offline.
        </div>
        <div className="off-mkt-hero-tech">503 Service Unavailable — platform :4100</div>
        <div className="off-mkt-hero-a">
          <Button size="md" onClick={onRetry}>
            <Icon icon={Loader2} size="sm" />
            Retry
          </Button>
          <Button variant="outline" size="md" onClick={() => setSurface('office')}>
            Back to Office
          </Button>
        </div>
      </div>
    </div>
  );
}

function MarketEmptyState({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  return (
    <div className="off-mkt-scroll off-mkt-hero-wrap">
      <div className="off-mkt-hero">
        <span className="off-mkt-hero-i">
          <Icon icon={filtered ? Search : Store} size="md" />
        </span>
        <div className="off-mkt-hero-t">{filtered ? 'No packages found' : 'Market is empty'}</div>
        <div className="off-mkt-hero-d">
          {filtered
            ? 'Try adjusting your search or filters to find what you need.'
            : 'Published employees, skills, and templates will appear here.'}
        </div>
        {filtered ? (
          <div className="off-mkt-hero-a">
            <Button size="md" onClick={onReset}>
              Reset filters
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
