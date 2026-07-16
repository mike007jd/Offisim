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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { cn } from '@/lib/utils.js';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowDownNarrowWide,
  Box,
  Building2,
  ChevronDown,
  CloudUpload,
  Layers,
  LayoutGrid,
  Loader2,
  Search,
  Settings2,
  Sparkles,
  Store,
  Upload,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { InstallDialog } from './InstallDialog.js';
import { MarketCard } from './MarketCard.js';
import { MarketDetail } from './MarketDetail.js';
import { MarketManage } from './MarketManage.js';
import { PublishDialog } from './PublishDialog.js';
import {
  type InstallBindingValues,
  type ListingKind,
  type ManageView,
  type MarketListing,
  type PendingPackageInstall,
  type PublishPackageRequest,
  canInstallListing,
  describeFileImportError,
  useCancelPackageImport,
  useConfirmPackageInstall,
  useImportPackageFile,
  useMarketListings,
  usePrepareRegistryInstall,
  usePublishPackage,
  usePublishSources,
  usePublishedDrafts,
  useRegistryConnection,
} from './market-data.js';
import { marketSearchPlaceholder } from './market-presentation.js';
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

// First option reads "All" so it never duplicates the adjacent top-level
// "Installed" mode tab (value stays 'installed' — store/routing unchanged).
const MANAGE_VIEWS: ReadonlyArray<SegmentedOption<ManageView>> = [
  { value: 'installed', label: 'All', icon: <Icon icon={Layers} size="sm" /> },
  { value: 'updates', label: 'Updates' },
  { value: 'published', label: 'Published' },
];

// Primary Browse/Installed switch — an app-store-style tab pair next to search.
const MODE_TABS: ReadonlyArray<SegmentedOption<'explore' | 'manage'>> = [
  { value: 'explore', label: 'Browse', icon: <Icon icon={Store} size="sm" /> },
  { value: 'manage', label: 'Installed', icon: <Icon icon={Layers} size="sm" /> },
];

const MIN_CARD = 216;
const GAP = 14;
/** Card (180) + the per-row top spacing (sp-7 = 16) used as inter-row rhythm. */
const ROW_HEIGHT = 196;

export function MarketSurface() {
  const companyId = useUiState((s) => s.companyId);
  const openSettings = useUiState((s) => s.openSettings);
  const listings = useMarketListings(companyId);
  const sources = usePublishSources(companyId);
  const registryConnection = useRegistryConnection();
  const publishedDrafts = usePublishedDrafts(registryConnection.data?.connected === true);
  const publishPackage = usePublishPackage();
  const importPackageFile = useImportPackageFile(companyId);
  const prepareRegistryInstall = usePrepareRegistryInstall(companyId);
  const confirmPackageInstall = useConfirmPackageInstall(companyId);
  const cancelPackageImport = useCancelPackageImport();
  const selectedListingId = useUiState((s) => s.selectedListingId);
  const selectListing = useUiState((s) => s.selectListing);

  const mode = useMarketUi((s) => s.mode);
  const setMode = useMarketUi((s) => s.setMode);
  const manageView = useMarketUi((s) => s.manageView);
  const setManageView = useMarketUi((s) => s.setManageView);

  const [kind, setKind] = useState<KindFilter>('all');
  const [sort, setSort] = useState<SortKey>('relevance');
  const [query, setQuery] = useState('');
  const [installTarget, setInstallTarget] = useState<MarketListing | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [pendingPackageInstall, setPendingPackageInstall] = useState<PendingPackageInstall | null>(
    null,
  );
  const [publishOpen, setPublishOpen] = useState(false);
  const [detailListingId, setDetailListingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const registryInstallAbortRef = useRef<AbortController | null>(null);

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

  const detailListing = (listings.data ?? []).find((l) => l.id === detailListingId) ?? null;
  const detailOpen = detailListing !== null && mode === 'explore';

  function resetFilters() {
    setKind('all');
    setQuery('');
    setSort('relevance');
  }

  async function openInstall(listing: MarketListing) {
    if (!canInstallListing(listing)) return;
    if (listing.installSource === 'registry') {
      registryInstallAbortRef.current?.abort();
      const controller = new AbortController();
      registryInstallAbortRef.current = controller;
      try {
        const pending = await prepareRegistryInstall.mutateAsync({
          listing,
          signal: controller.signal,
        });
        setPendingPackageInstall(pending);
        setInstallTarget(pending.listing);
        setInstallOpen(true);
      } catch {
        if (controller.signal.aborted) return;
        toast.error('Download failed', {
          description: 'The item could not be prepared for installation. Try again.',
        });
      } finally {
        if (registryInstallAbortRef.current === controller) {
          registryInstallAbortRef.current = null;
        }
      }
      return;
    }
    setPendingPackageInstall(null);
    setInstallTarget(listing);
    setInstallOpen(true);
  }

  function openDetail(listing: MarketListing) {
    selectListing(listing.id);
    setDetailListingId(listing.id);
  }

  async function handlePackageFile(file: File | null | undefined) {
    if (!file) return;
    try {
      const pending = await importPackageFile.mutateAsync(file);
      setPendingPackageInstall(pending);
      setInstallTarget(pending.listing);
      setInstallOpen(true);
      toast.success('Ready to install', {
        description: `Review ${pending.listing.name}, then confirm the installation.`,
      });
    } catch (error) {
      toast.error('Import failed', {
        description: describeFileImportError(error),
      });
    }
  }

  function handleInstallOpenChange(open: boolean) {
    setInstallOpen(open);
    if (open) return;

    registryInstallAbortRef.current?.abort();
    registryInstallAbortRef.current = null;

    if (pendingPackageInstall) {
      void cancelPackageImport.mutateAsync(pendingPackageInstall).catch(() => undefined);
      setPendingPackageInstall(null);
    }
    setInstallTarget(null);
  }

  async function handleInstall(listing: MarketListing, values: InstallBindingValues) {
    if (!pendingPackageInstall || listing.id !== pendingPackageInstall.listing.id) {
      throw new Error('This item is not ready to install. Try importing it again.');
    }
    const result = await confirmPackageInstall.mutateAsync({
      pending: pendingPackageInstall,
      values,
    });
    setPendingPackageInstall(null);
    if (result.installReceiptError) {
      toast.error('Installed, but online sync failed', {
        description: 'The item is available locally. Online history will sync after reconnection.',
      });
      return;
    }
    toast.success('Installed', {
      description: `${listing.name} is now available in this company.`,
    });
  }

  async function handlePublish(request: PublishPackageRequest) {
    const result = await publishPackage.mutateAsync(request);
    toast.success('Submitted for review', {
      description:
        result.status === 'pending_review'
          ? `${request.title} is waiting for review.`
          : `${request.title} is queued for review.`,
    });
    setPublishOpen(false);
    setMode('manage');
    setManageView('published');
  }

  // Abort any in-flight registry artifact download if the surface unmounts.
  useEffect(
    () => () => {
      registryInstallAbortRef.current?.abort();
      registryInstallAbortRef.current = null;
    },
    [],
  );

  // Missing endpoint keeps online browsing unavailable, while local installed
  // items and file imports stay fully usable.
  const registryNotConnected = registryConnection.data?.reason === 'registry-config-missing';

  return (
    <div className={cn('off-market', detailOpen && 'is-detail-mode')}>
      <div className="off-mkt-fbar">
        <div className="off-mkt-fbar-main">
          <SegmentedControl
            options={MODE_TABS}
            value={mode}
            onChange={setMode}
            ariaLabel="Marketplace mode"
          />
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={marketSearchPlaceholder(mode, manageView)}
            className="off-mkt-search"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".offisimpkg,.zip"
            hidden
            tabIndex={-1}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              void handlePackageFile(file).finally(() => {
                event.currentTarget.value = '';
              });
            }}
          />
          {/* Sort (explore only) collapses into a dropdown, pushed right. */}
          {mode === 'explore' && !registryNotConnected ? (
            <SortMenu sort={sort} onChange={setSort} className="ml-auto" />
          ) : (
            <span className="ml-auto" />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="md" variant="outline">
                <Icon icon={CloudUpload} size="sm" />
                Add or publish
                <Icon icon={ChevronDown} size="sm" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => fileInputRef.current?.click()}
                disabled={importPackageFile.isPending}
              >
                <Icon icon={importPackageFile.isPending ? Loader2 : Upload} size="sm" />
                Import from computer…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPublishOpen(true)}>
                <Icon icon={CloudUpload} size="sm" />
                Publish for review…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {mode === 'manage' ? (
          <div className="off-mkt-fbar-sub">
            <SegmentedControl
              options={MANAGE_VIEWS}
              value={manageView}
              onChange={setManageView}
              ariaLabel="Installed and publishing views"
            />
          </div>
        ) : mode === 'explore' && !registryNotConnected ? (
          <div className="off-mkt-fbar-sub">
            <SegmentedControl
              options={KIND_FILTERS}
              value={kind}
              onChange={setKind}
              wrap
              ariaLabel="Filter by kind"
            />
          </div>
        ) : null}
      </div>

      <div className="off-mkt-grid-wrap">
        {/* Underlay stays mounted beneath the detail overlay (scroll position
            survives); inert keeps its covered controls out of tab order. */}
        <div className="off-mkt-underlay" inert={detailOpen && detailListing != null}>
          {mode === 'manage' ? (
            <div className="off-mkt-listing">
              <MarketManage
                view={manageView}
                companyId={companyId}
                query={query}
                onClearSearch={() => setQuery('')}
                onBrowseExplore={() => setMode('explore')}
                onOpenConnectionSettings={() => openSettings('advanced')}
                onPublish={() => setPublishOpen(true)}
                onOpenListing={(id) => {
                  setMode('explore');
                  const listing = (listings.data ?? []).find((l) => l.id === id);
                  if (listing) openDetail(listing);
                }}
              />
            </div>
          ) : listings.isLoading ? (
            <SkeletonGrid />
          ) : listings.isError ? (
            <MarketErrorState error={listings.error} onRetry={() => listings.refetch()} />
          ) : registryNotConnected ? (
            // No registry configured (the default desktop build): show an honest
            // not-connected state with local import, not a fabricated storefront.
            <MarketNotConnected
              onImport={() => fileInputRef.current?.click()}
              onViewInstalled={() => setMode('manage')}
              onOpenConnectionSettings={() => openSettings('advanced')}
              importing={importPackageFile.isPending}
            />
          ) : filtered.length === 0 ? (
            <MarketEmptyState filtered={query !== '' || kind !== 'all'} onReset={resetFilters} />
          ) : (
            <CardGrid
              listings={filtered}
              selectedId={selectedListingId}
              onSelect={(listing) => selectListing(listing.id)}
              onOpen={openDetail}
            />
          )}
        </div>
        <AnimatePresence initial={false}>
          {detailOpen && detailListing ? (
            <MarketDetail
              key="market-detail"
              listing={detailListing}
              installed={detailListing.installed}
              onClose={() => setDetailListingId(null)}
              onInstall={() => void openInstall(detailListing)}
            />
          ) : null}
        </AnimatePresence>
      </div>

      <InstallDialog
        listing={installTarget}
        open={installOpen}
        onOpenChange={handleInstallOpenChange}
        onInstall={handleInstall}
      />
      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        sources={sources.data ?? []}
        registry={registryConnection.data ?? null}
        drafts={publishedDrafts.data ?? []}
        draftsLoading={publishedDrafts.isLoading && registryConnection.data?.connected === true}
        publishing={publishPackage.isPending}
        onOpenConnectionSettings={() => openSettings('advanced')}
        onPublish={handlePublish}
      />
    </div>
  );
}

/** Sort control collapsed into a dropdown — secondary to Browse/Installed and
 *  the kind filter, so it reads as a refinement rather than a primary tab row. */
function SortMenu({
  sort,
  onChange,
  className,
}: {
  sort: SortKey;
  onChange: (s: SortKey) => void;
  className?: string;
}) {
  const current = SORTS.find((option) => option.value === sort)?.label ?? 'Sort';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="md" variant="outline" className={className}>
          <Icon icon={ArrowDownNarrowWide} size="sm" />
          {current}
          <Icon icon={ChevronDown} size="sm" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sort} onValueChange={(value) => onChange(value as SortKey)}>
          {SORTS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
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
  onSelect,
  onOpen,
}: {
  listings: MarketListing[];
  selectedId: string | null;
  onSelect: (listing: MarketListing) => void;
  onOpen: (listing: MarketListing) => void;
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
                  installed={listing.installed}
                  selected={listing.id === selectedId}
                  onSelect={() => onSelect(listing)}
                  onOpen={() => onOpen(listing)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const MARKET_LOADING_CARD_KEYS = Array.from({ length: 8 }, (_, index) => `market-loading-${index}`);

function SkeletonGrid() {
  return (
    <div className="off-mkt-scroll">
      <div className="off-mkt-skel-grid">
        {MARKET_LOADING_CARD_KEYS.map((key) => (
          <div key={key} className="off-mkt-skel">
            <div className="off-mkt-skel-cover" />
            <div className="off-mkt-skel-body">
              <div className="off-mkt-sk is-title" />
              <div className="off-mkt-sk is-name" />
              <div className="off-mkt-sk is-line" />
              <div className="off-mkt-sk is-title" />
              <div className="off-mkt-skel-stats">
                <div className="off-mkt-sk is-rating" />
                <div className="off-mkt-sk is-installs" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarketErrorState({ error: _error, onRetry }: { error: unknown; onRetry: () => void }) {
  const openSettings = useUiState((s) => s.openSettings);
  return (
    <div className="off-mkt-scroll off-mkt-hero-wrap">
      <div className="off-mkt-hero">
        <span className="off-mkt-hero-i is-danger">
          <Icon icon={WifiOff} size="md" />
        </span>
        <div className="off-mkt-hero-t">Online catalog unavailable</div>
        <div className="off-mkt-hero-d">
          Installed items remain available. Retry now or review the connection settings.
        </div>
        <div className="off-mkt-hero-a">
          <Button size="md" onClick={onRetry}>
            <Icon icon={Loader2} size="sm" />
            Retry
          </Button>
          <Button variant="outline" size="md" onClick={() => openSettings('advanced')}>
            Connection settings
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
        <div className="off-mkt-hero-t">{filtered ? 'No items found' : 'Market is empty'}</div>
        <div className="off-mkt-hero-d">
          {filtered
            ? 'Try a different search or clear filters.'
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

function MarketNotConnected({
  onImport,
  onViewInstalled,
  onOpenConnectionSettings,
  importing,
}: {
  onImport: () => void;
  onViewInstalled: () => void;
  onOpenConnectionSettings: () => void;
  importing: boolean;
}) {
  return (
    <div className="off-mkt-scroll off-mkt-hero-wrap">
      <div className="off-mkt-hero">
        <span className="off-mkt-hero-i">
          <Icon icon={Store} size="md" />
        </span>
        <div className="off-mkt-hero-t">Browse offline</div>
        <div className="off-mkt-hero-d">
          The online catalog is not connected. You can still search installed items or import from
          your computer.
        </div>
        <div className="off-mkt-hero-a">
          <Button size="md" onClick={onImport} disabled={importing}>
            <Icon icon={importing ? Loader2 : Upload} size="sm" />
            Import from computer…
          </Button>
          <Button variant="outline" size="md" onClick={onViewInstalled}>
            <Icon icon={Layers} size="sm" />
            View installed
          </Button>
          <Button variant="ghost" size="md" onClick={onOpenConnectionSettings}>
            <Icon icon={Settings2} size="sm" />
            Connection settings
          </Button>
        </div>
      </div>
    </div>
  );
}
