import { useUiState } from '@/app/ui-state.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import {
  SegmentedControl,
  type SegmentedOption,
} from '@/design-system/grammar/SegmentedControl.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog.js';
import { Input } from '@/design-system/primitives/input.js';
import { cn } from '@/lib/utils.js';
import { useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Box,
  Building2,
  CloudUpload,
  KeyRound,
  Layers,
  LayoutGrid,
  Loader2,
  Search,
  Sparkles,
  Store,
  Upload,
  UserRound,
  WifiOff,
} from 'lucide-react';
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
  marketplaceTokenConfigured,
  useCancelPackageImport,
  useConfirmPackageInstall,
  useImportPackageFile,
  useMarketListings,
  usePrepareRegistryInstall,
  usePublishPackage,
  usePublishSources,
  usePublishedDrafts,
  useRegistryConnection,
  writeMarketplaceToken,
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

// Primary Browse/Installed switch — an app-store-style tab pair next to search.
const MODE_TABS: ReadonlyArray<SegmentedOption<'explore' | 'manage'>> = [
  { value: 'explore', label: 'Browse', icon: <Icon icon={Store} size="sm" /> },
  { value: 'manage', label: 'Installed', icon: <Icon icon={Layers} size="sm" /> },
];

const MIN_CARD = 216;
const GAP = 14;
/** Card (200) + the per-row top spacing (sp-7 = 16) used as inter-row rhythm. */
const ROW_HEIGHT = 216;

export function MarketSurface() {
  const queryClient = useQueryClient();
  const companyId = useUiState((s) => s.companyId);
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
  const [registryTokenOpen, setRegistryTokenOpen] = useState(false);
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
      } catch (error) {
        if (controller.signal.aborted) return;
        toast.error('Registry install failed', {
          description: error instanceof Error ? error.message : String(error),
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
      toast.success('Package verified', {
        description: `${pending.listing.name} is ready for install review.`,
      });
    } catch (error) {
      toast.error('Package import failed', {
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
      throw new Error('This package does not have a prepared local install transaction.');
    }
    const result = await confirmPackageInstall.mutateAsync({
      pending: pendingPackageInstall,
      values,
    });
    setPendingPackageInstall(null);
    if (result.installReceiptError) {
      toast.error('Package installed locally; registry receipt failed', {
        description: result.installReceiptError,
      });
      return;
    }
    toast.success('Package installed', {
      description: result.installReceiptId
        ? `${listing.name} is available and the registry receipt was recorded.`
        : `${listing.name} is now available in this company.`,
    });
  }

  async function handlePublish(request: PublishPackageRequest) {
    const result = await publishPackage.mutateAsync(request);
    toast.success('Package submitted', {
      description: `Registry moderation job ${result.moderationJobId} is ${result.status}.`,
    });
    setPublishOpen(false);
    setMode('manage');
    setManageView('published');
  }

  function refreshRegistryQueries() {
    void queryClient.invalidateQueries({ queryKey: ['market-registry-connection'] });
    void queryClient.invalidateQueries({ queryKey: ['market-drafts'] });
    void queryClient.invalidateQueries({ queryKey: ['market-listings'] });
    void queryClient.invalidateQueries({ queryKey: ['market-installed'] });
  }

  function handleRegistryTokenSave(token: string | null) {
    writeMarketplaceToken(token);
    refreshRegistryQueries();
    toast.success(token ? 'Registry token connected' : 'Registry token cleared', {
      description: token
        ? 'Market publish, drafts, and install receipts will use this token.'
        : 'Market publish and receipt calls now require a new token.',
    });
  }

  // Abort any in-flight registry artifact download if the surface unmounts.
  useEffect(
    () => () => {
      registryInstallAbortRef.current?.abort();
      registryInstallAbortRef.current = null;
    },
    [],
  );

  return (
    <div className={cn('off-market', detailOpen && 'is-detail-mode')}>
      <div className="off-mkt-fbar">
        <div className="off-mkt-fbar-main">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search employees, skills, templates…"
            className="off-mkt-search"
          />
          <SegmentedControl
            options={MODE_TABS}
            value={mode}
            onChange={setMode}
            ariaLabel="Marketplace mode"
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".offisimpkg,.aicspkg,.zip"
            hidden
            tabIndex={-1}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              void handlePackageFile(file).finally(() => {
                event.currentTarget.value = '';
              });
            }}
          />
          <Button
            size="md"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={importPackageFile.isPending}
          >
            {importPackageFile.isPending ? (
              <Icon icon={Loader2} size="sm" className="animate-spin" />
            ) : (
              <Icon icon={Upload} size="sm" />
            )}
            Import
          </Button>
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
        {detailOpen && detailListing ? (
          <MarketDetail
            listing={detailListing}
            installed={detailListing.installed}
            onClose={() => setDetailListingId(null)}
            onInstall={() => void openInstall(detailListing)}
          />
        ) : mode === 'manage' ? (
          <div className="off-mkt-listing">
            <MarketManage
              view={manageView}
              companyId={companyId}
              onBrowseExplore={() => setMode('explore')}
              onConnectRegistry={() => setRegistryTokenOpen(true)}
              onPublish={() => setPublishOpen(true)}
            />
          </div>
        ) : listings.isLoading ? (
          <SkeletonGrid />
        ) : listings.isError ? (
          <MarketErrorState error={listings.error} onRetry={() => listings.refetch()} />
        ) : filtered.length === 0 ? (
          <MarketEmptyState filtered={query !== '' || kind !== 'all'} onReset={resetFilters} />
        ) : (
          <CardGrid listings={filtered} selectedId={selectedListingId} onOpen={openDetail} />
        )}
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
        onConnectRegistry={() => setRegistryTokenOpen(true)}
        onPublish={handlePublish}
      />
      <RegistryTokenDialog
        open={registryTokenOpen}
        connected={registryConnection.data?.connected === true}
        configured={marketplaceTokenConfigured()}
        onOpenChange={setRegistryTokenOpen}
        onSave={handleRegistryTokenSave}
      />
    </div>
  );
}

function RegistryTokenDialog({
  open,
  connected,
  configured,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  connected: boolean;
  configured: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (token: string | null) => void;
}) {
  const [token, setToken] = useState('');

  useEffect(() => {
    if (open) setToken('');
  }, [open]);

  function saveToken() {
    const next = token.trim();
    if (!next) {
      toast.error('Registry token required', {
        description: 'Paste an offisim API token or clear the current token.',
      });
      return;
    }
    onSave(next);
    onOpenChange(false);
  }

  function clearToken() {
    onSave(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="off-mkt-dialog">
        <DialogHeader>
          <DialogTitle>Registry Token</DialogTitle>
          <DialogDescription>
            Connect a marketplace API token for drafts, publishing, and install receipts.
          </DialogDescription>
        </DialogHeader>
        <div className="off-token-dialog">
          <div className="off-token-status">
            <Icon icon={KeyRound} size="sm" />
            <span>{connected ? 'Connected' : configured ? 'Token saved' : 'No token saved'}</span>
          </div>
          <Input
            type="password"
            value={token}
            autoComplete="off"
            placeholder="offisim_..."
            aria-label="Registry API token"
            onChange={(event) => setToken(event.currentTarget.value)}
          />
          <div className="off-token-actions">
            {configured ? (
              <Button size="md" variant="outline" type="button" onClick={clearToken}>
                Clear token
              </Button>
            ) : null}
            <Button size="md" variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="md" type="button" onClick={saveToken}>
              Save token
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Virtualized responsive card grid. Columns are derived from container width
 *  (auto-fill minmax(216px,1fr)); TanStack Virtual virtualizes the rows so a
 *  long registry stays smooth. */
function CardGrid({
  listings,
  selectedId,
  onOpen,
}: {
  listings: MarketListing[];
  selectedId: string | null;
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

function MarketErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const setSurface = useUiState((s) => s.setSurface);
  const reason =
    error instanceof Error && error.message
      ? error.message
      : 'No response from the marketplace data source.';
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
        <div className="off-mkt-hero-tech">{reason}</div>
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
