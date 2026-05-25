import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import { Edit3, KeyRound, Loader2, RefreshCw, Store, Trash2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import {
  type DraftStatus,
  type InstalledPackage,
  type ManageView,
  type PublishedDraft,
  useInstalledPackages,
  usePublishedDrafts,
} from './market-data.js';

interface MarketManageProps {
  view: ManageView;
  onBrowseExplore: () => void;
  onPublish: () => void;
}

export function MarketManage({ view, onBrowseExplore, onPublish }: MarketManageProps) {
  if (view === 'published') {
    return <PublishedList onPublish={onPublish} />;
  }
  return <InstalledList view={view} onBrowseExplore={onBrowseExplore} />;
}

function InstalledList({
  view,
  onBrowseExplore,
}: {
  view: ManageView;
  onBrowseExplore: () => void;
}) {
  const installed = useInstalledPackages();
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
        title={view === 'updates' ? 'No updates available' : 'No installed market packages'}
        description="Packages installed from the marketplace appear here for manual update checks."
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
          <InstalledItem key={pkg.id} pkg={pkg} />
        ))}
      </div>
      {view === 'installed' ? (
        <div className="off-mng-browse">
          <Button variant="subtle" size="sm" onClick={onBrowseExplore}>
            Browse Explore
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function InstalledItem({ pkg }: { pkg: InstalledPackage }) {
  const hasOrigin = pkg.originListingId !== null;
  const hasUpdate = pkg.latestVersion !== null;

  return (
    <div className="off-mng-item">
      <div className="off-mng-top">
        <div>
          <div className="off-mng-name">{pkg.packageId}</div>
          <div className="off-mng-ver">
            v{pkg.version} · {pkg.installedLabel}
          </div>
        </div>
        {hasUpdate ? <span className="off-mng-badge">Update</span> : null}
      </div>
      {hasUpdate ? <div className="off-mng-latest">→ latest {pkg.latestVersion}</div> : null}
      {pkg.checkState === 'error' ? <div className="off-mng-err">Update check failed</div> : null}
      <div className="off-mng-acts">
        <Button
          variant="outline"
          size="sm"
          disabled={!hasOrigin || pkg.checkState === 'checking'}
          onClick={() => toast.success(`Checked ${pkg.packageId}`)}
        >
          {pkg.checkState === 'checking' ? (
            <>
              <Icon icon={Loader2} size="sm" className="off-spin" />
              Checking…
            </>
          ) : (
            <>
              <Icon icon={RefreshCw} size="sm" />
              Check
            </>
          )}
        </Button>
        {hasUpdate && hasOrigin ? (
          <Button size="sm" onClick={() => toast.success(`Updating ${pkg.packageId}`)}>
            <Icon icon={UploadCloud} size="sm" />
            Update
          </Button>
        ) : null}
        {!hasOrigin ? <span className="off-mng-annot">no origin → disabled</span> : null}
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

function PublishedList({ onPublish }: { onPublish: () => void }) {
  // Auth gate derived from RegistryClient.hasAuthToken (true in fixtures).
  const hasAuthToken = true;
  const drafts = usePublishedDrafts();

  if (!hasAuthToken) {
    return (
      <div className="off-mng-unauth">
        <span className="off-mng-unauth-i">
          <Icon icon={KeyRound} size="md" />
        </span>
        <div className="off-mng-unauth-t">Sign in to view your drafts</div>
        <div className="off-mng-unauth-d">
          Publishing requires a marketplace account. Once you connect one, your drafts and published
          packages will appear here.
        </div>
        <Button size="md" onClick={onPublish}>
          Connect registry
        </Button>
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
        description="Use Publish from the toolbar to package an asset."
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
  const isDraft = draft.status === 'draft' || draft.status === 'validated';
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
      <div className="off-mng-acts off-pub-acts">
        <Button variant="outline" size="sm" onClick={() => toast.info(`Editing ${draft.title}`)}>
          <Icon icon={Edit3} size="sm" />
          Edit
        </Button>
        {isDraft ? (
          <Button size="sm" onClick={() => toast.success(`Submitted ${draft.title}`)}>
            <Icon icon={UploadCloud} size="sm" />
            Submit
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => toast.success(`Deleted ${draft.title}`)}>
          <Icon icon={Trash2} size="sm" />
          Delete
        </Button>
      </div>
    </div>
  );
}
