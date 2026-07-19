import {
  useInstalledPackages,
  usePublishedDrafts,
  useRegistryConnection,
} from '@/data/market/queries.js';
import type {
  DraftStatus,
  InstalledPackage,
  ManageView,
  PublishedDraft,
} from '@/data/market/types.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { cn } from '@/lib/utils.js';
import { EmptyState, ErrorState, errorDetail } from '@/surfaces/shared/SurfaceStates.js';
import { ExternalLink, Loader2, Settings2, Store, UploadCloud } from 'lucide-react';
import {
  filterInstalledPackages,
  filterPublishedDrafts,
  installedDisplayName,
  marketConnectionCopy,
} from './market-presentation.js';

interface MarketManageProps {
  view: ManageView;
  companyId: string | null;
  query: string;
  onClearSearch: () => void;
  onBrowseExplore: () => void;
  onOpenConnectionSettings: () => void;
  onPublish: () => void;
  /** Open the package's origin listing in Browse (review / update). */
  onOpenListing: (listingId: string) => void;
}

export function MarketManage({
  view,
  companyId,
  query,
  onClearSearch,
  onBrowseExplore,
  onOpenConnectionSettings,
  onPublish,
  onOpenListing,
}: MarketManageProps) {
  if (view === 'published') {
    return (
      <PublishedList
        query={query}
        onClearSearch={onClearSearch}
        onOpenConnectionSettings={onOpenConnectionSettings}
        onPublish={onPublish}
      />
    );
  }
  return (
    <InstalledList
      view={view}
      companyId={companyId}
      query={query}
      onClearSearch={onClearSearch}
      onBrowseExplore={onBrowseExplore}
      onOpenListing={onOpenListing}
    />
  );
}

function InstalledList({
  view,
  companyId,
  query,
  onClearSearch,
  onBrowseExplore,
  onOpenListing,
}: {
  view: ManageView;
  companyId: string | null;
  query: string;
  onClearSearch: () => void;
  onBrowseExplore: () => void;
  onOpenListing: (listingId: string) => void;
}) {
  const installed = useInstalledPackages(companyId);
  const rows = installed.data ?? [];
  const visible = filterInstalledPackages(rows, query, view === 'updates');

  if (installed.isLoading) {
    return <MarketManageSkeleton label="Loading installed items…" />;
  }

  if (installed.isError) {
    return (
      <ErrorState
        title="Couldn't load installed items"
        detail={errorDetail(installed.error, 'The local installed-items list could not be read.')}
        onRetry={() => void installed.refetch()}
      />
    );
  }

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={Store}
        title={
          query.trim()
            ? 'No installed items match your search'
            : view === 'updates'
              ? 'No updates available'
              : 'No installed items'
        }
        description={
          query.trim()
            ? 'Try another name or clear the search.'
            : view === 'updates'
              ? 'Everything is up to date.'
              : 'Items you install or import appear here.'
        }
        action={query.trim() ? { label: 'Clear search', onClick: onClearSearch } : undefined}
      />
    );
  }

  return (
    <div className="off-mkt-scroll">
      {view === 'updates' ? <div className="off-mng-note">Updates ready to review</div> : null}
      <div className={cn('off-mng-wrap', view === 'updates' && 'is-rows')}>
        {visible.map((pkg) => (
          <InstalledItem key={pkg.id} pkg={pkg} onOpenListing={onOpenListing} />
        ))}
        {view === 'installed' ? (
          <button
            type="button"
            className="off-mng-item is-cta off-focusable"
            onClick={onBrowseExplore}
          >
            <Icon icon={Store} size="sm" />
            Browse Market
          </button>
        ) : null}
      </div>
    </div>
  );
}

function InstalledItem({
  pkg,
  onOpenListing,
}: {
  pkg: InstalledPackage;
  onOpenListing: (listingId: string) => void;
}) {
  const originId = pkg.originListingId;
  const hasUpdate = pkg.latestVersion !== null;
  const status = !originId ? 'Sideloaded' : hasUpdate ? 'Update available' : 'Up to date';
  const statusTone = !originId ? 'is-muted' : hasUpdate ? 'is-update' : 'is-ok';

  return (
    <div className="off-mng-item">
      <div className="off-mng-top">
        <div className="off-mng-id-wrap">
          <div className="off-mng-name">{installedDisplayName(pkg.packageId)}</div>
          <div className="off-mng-ver">
            v{pkg.version} · {pkg.installedLabel}
          </div>
        </div>
        <span className={cn('off-mng-badge', statusTone)}>{status}</span>
      </div>
      {hasUpdate ? (
        <div className="off-mng-latest">Version {pkg.latestVersion} is available</div>
      ) : null}
      {pkg.checkState === 'error' ? (
        <div className="off-mng-err">Couldn't check for updates</div>
      ) : null}
      {/* Always render the action slot so equal-height grid cards keep their
          bottom row aligned; sideloaded packages state why there is no action. */}
      <div className="off-mng-acts">
        {originId ? (
          <Button
            size="sm"
            variant={hasUpdate ? 'default' : 'outline'}
            onClick={() => onOpenListing(originId)}
          >
            <Icon icon={ExternalLink} size="sm" />
            {hasUpdate ? 'Update' : 'Open listing'}
          </Button>
        ) : (
          <span className="off-mng-action-state">Imported from computer</span>
        )}
      </div>
    </div>
  );
}

const STATUS_TONE: Record<DraftStatus, { cls: string; label: string }> = {
  draft: { cls: 'off-pst-draft', label: 'Draft' },
  validated: { cls: 'off-pst-info', label: 'Validated' },
  submitted: { cls: 'off-pst-info', label: 'Submitted' },
  approved: { cls: 'off-pst-ok', label: 'Approved' },
  rejected: { cls: 'off-pst-err', label: 'Rejected' },
};

function PublishedList({
  query,
  onClearSearch,
  onOpenConnectionSettings,
  onPublish,
}: {
  query: string;
  onClearSearch: () => void;
  onOpenConnectionSettings: () => void;
  onPublish: () => void;
}) {
  const registry = useRegistryConnection();
  const drafts = usePublishedDrafts(registry.data?.connected === true);
  const unavailable = marketConnectionCopy(registry.data);

  if (registry.isLoading) {
    return <MarketManageSkeleton label="Checking publishing access…" />;
  }

  if (!registry.data?.connected) {
    return (
      <div className="off-mng-unauth">
        <span className="off-mng-unauth-i">
          <Icon icon={Settings2} size="md" />
        </span>
        <div className="off-mng-unauth-t">{unavailable.title}</div>
        <div className="off-mng-unauth-d">{unavailable.description}</div>
        <Button size="sm" variant="outline" onClick={onOpenConnectionSettings}>
          Connection settings
        </Button>
      </div>
    );
  }

  if (drafts.isLoading) {
    return <MarketManageSkeleton label="Loading submissions…" />;
  }

  if (drafts.isError) {
    return (
      <ErrorState
        title="Couldn't load submissions"
        detail={errorDetail(drafts.error, 'Publishing history could not be loaded.')}
        onRetry={() => void drafts.refetch()}
      />
    );
  }

  const rows = filterPublishedDrafts(drafts.data ?? [], query);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={UploadCloud}
        title={query.trim() ? 'No submissions match your search' : 'Nothing submitted yet'}
        description={
          query.trim()
            ? 'Try another title or clear the search.'
            : 'Publish an employee or skill when it is ready for review.'
        }
        action={
          query.trim()
            ? { label: 'Clear search', onClick: onClearSearch }
            : { label: 'Publish for review', onClick: onPublish }
        }
      />
    );
  }

  return (
    <div className="off-mkt-scroll">
      <div className="off-pub-wrap">
        {rows.map((draft) => (
          <DraftItem key={draft.id} draft={draft} />
        ))}
      </div>
    </div>
  );
}

function MarketManageSkeleton({ label }: { label: string }) {
  return (
    <div className="off-mng-loading" aria-label={label}>
      <span>
        <Icon icon={Loader2} size="sm" className="off-spin" />
        {label}
      </span>
      <div className="off-pub-wrap" aria-hidden="true">
        <div className="off-mkt-sk off-mng-sk" />
        <div className="off-mkt-sk off-mng-sk" />
        <div className="off-mkt-sk off-mng-sk" />
      </div>
    </div>
  );
}

function DraftItem({ draft }: { draft: PublishedDraft }) {
  const tone = STATUS_TONE[draft.status];
  return (
    <div className="off-pub-item">
      <div className="off-pub-top">
        <div className="off-pub-id">
          <div className="off-pub-pt">{draft.title}</div>
          {draft.summary ? <div className="off-pub-ps">{draft.summary}</div> : null}
          <div className="off-pub-meta">
            <span className="off-chip">{draft.kind}</span>
            <span>Updated {draft.updatedLabel}</span>
          </div>
        </div>
        <span className={`off-pub-status ${tone.cls}`}>{tone.label}</span>
      </div>
    </div>
  );
}
