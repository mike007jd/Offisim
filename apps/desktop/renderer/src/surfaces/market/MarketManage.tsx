import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { cn, titleizeSlug } from '@/lib/utils.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import { ExternalLink, KeyRound, Loader2, Store, UploadCloud } from 'lucide-react';
import {
  type DraftStatus,
  type InstalledPackage,
  type ManageView,
  type PublishedDraft,
  useInstalledPackages,
  usePublishedDrafts,
  useRegistryConnection,
} from './market-data.js';

/** "com.acme.note-reader" → "Note Reader" — readable card title; the raw id
 *  stays visible on a secondary mono line. */
function humanizePackageId(packageId: string): string {
  const tail = packageId.split('.').pop() ?? packageId;
  return titleizeSlug(tail) || packageId;
}

interface MarketManageProps {
  view: ManageView;
  companyId: string | null;
  onBrowseExplore: () => void;
  onConnectRegistry: () => void;
  onPublish: () => void;
  /** Open the package's origin listing in Browse (review / update). */
  onOpenListing: (listingId: string) => void;
}

export function MarketManage({
  view,
  companyId,
  onBrowseExplore,
  onConnectRegistry,
  onPublish,
  onOpenListing,
}: MarketManageProps) {
  if (view === 'published') {
    return <PublishedList onConnectRegistry={onConnectRegistry} onPublish={onPublish} />;
  }
  return (
    <InstalledList
      view={view}
      companyId={companyId}
      onBrowseExplore={onBrowseExplore}
      onOpenListing={onOpenListing}
    />
  );
}

function InstalledList({
  view,
  companyId,
  onBrowseExplore,
  onOpenListing,
}: {
  view: ManageView;
  companyId: string | null;
  onBrowseExplore: () => void;
  onOpenListing: (listingId: string) => void;
}) {
  const installed = useInstalledPackages(companyId);
  const rows = installed.data ?? [];
  const visible = view === 'updates' ? rows.filter((r) => r.latestVersion) : rows;

  if (installed.isLoading) {
    return (
      <div className="off-mng-loading">
        <Icon icon={Loader2} size="sm" className="off-spin" />
        Loading installed packages…
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={Store}
        title={view === 'updates' ? 'No updates available' : 'No installed packages'}
        description={
          view === 'updates'
            ? 'Everything is up to date.'
            : 'Packages you install appear here.'
        }
      />
    );
  }

  return (
    <div className="off-mkt-scroll">
      {view === 'updates' ? (
        <div className="off-mng-note">Packages with available updates</div>
      ) : null}
      <div className="off-mng-wrap">
        {visible.map((pkg) => (
          <InstalledItem key={pkg.id} pkg={pkg} onOpenListing={onOpenListing} />
        ))}
      </div>
      {view === 'installed' ? (
        <div className="off-mng-browse">
          <Button variant="subtle" size="sm" onClick={onBrowseExplore}>
            Browse marketplace
          </Button>
        </div>
      ) : null}
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
          <div className="off-mng-name">{humanizePackageId(pkg.packageId)}</div>
          <div className="off-mng-id">{pkg.packageId}</div>
          <div className="off-mng-ver">
            v{pkg.version} · {pkg.installedLabel}
          </div>
        </div>
        <span className={cn('off-mng-badge', statusTone)}>{status}</span>
      </div>
      {hasUpdate ? <div className="off-mng-latest">→ latest {pkg.latestVersion}</div> : null}
      {pkg.checkState === 'error' ? <div className="off-mng-err">Update check failed</div> : null}
      {originId ? (
        <div className="off-mng-acts">
          <Button
            size="sm"
            variant={hasUpdate ? 'default' : 'outline'}
            onClick={() => onOpenListing(originId)}
          >
            <Icon icon={ExternalLink} size="sm" />
            {hasUpdate ? 'Update' : 'Open listing'}
          </Button>
        </div>
      ) : null}
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
  onConnectRegistry,
  onPublish,
}: {
  onConnectRegistry: () => void;
  onPublish: () => void;
}) {
  const registry = useRegistryConnection();
  const drafts = usePublishedDrafts(registry.data?.connected === true);
  const unavailableTitle =
    registry.data?.reason === 'registry-config-missing'
      ? 'Registry endpoint not configured'
      : registry.data?.reason === 'creator-missing'
        ? 'Creator profile not registered'
        : registry.data?.reason === 'platform-unreachable'
          ? 'Registry service unreachable'
          : 'Sign in to view your drafts';
  const unavailableDescription =
    registry.data?.reason === 'registry-config-missing'
      ? 'Set the desktop registry base URL before using marketplace publish history.'
      : registry.data?.reason === 'creator-missing'
        ? 'This registry token is valid, but the account does not have a creator profile yet.'
        : registry.data?.reason === 'platform-unreachable'
          ? 'The configured marketplace endpoint did not respond to the desktop app.'
          : 'Publishing requires a marketplace account. Once you connect one, your drafts and published packages will appear here.';

  if (registry.isLoading) {
    return (
      <div className="off-mng-loading">
        <Icon icon={Loader2} size="sm" className="off-spin" />
        Checking registry connection…
      </div>
    );
  }

  if (!registry.data?.connected) {
    const canManageToken =
      registry.data?.reason !== 'registry-config-missing' &&
      registry.data?.reason !== 'desktop-runtime-unavailable';
    return (
      <div className="off-mng-unauth">
        <span className="off-mng-unauth-i">
          <Icon icon={KeyRound} size="md" />
        </span>
        <div className="off-mng-unauth-t">{unavailableTitle}</div>
        <div className="off-mng-unauth-d">{unavailableDescription}</div>
        <span className="off-mng-action-state">
          {registry.data?.reason === 'auth-not-configured'
            ? 'Registry auth unavailable'
            : 'Registry connection unavailable'}
        </span>
        {canManageToken ? (
          <Button size="sm" variant="outline" onClick={onConnectRegistry}>
            {registry.data?.reason === 'auth-not-configured' ? 'Connect registry' : 'Manage token'}
          </Button>
        ) : null}
      </div>
    );
  }

  if (drafts.isLoading) {
    return (
      <div className="off-pub-wrap">
        <div className="off-mkt-sk off-mng-sk" />
        <div className="off-mkt-sk off-mng-sk" />
        <div className="off-mkt-sk off-mng-sk" />
      </div>
    );
  }

  const rows = drafts.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={UploadCloud}
        title="No published packages yet"
        description="Publish an employee or skill to get started."
        action={{ label: 'Publish', onClick: onPublish }}
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
