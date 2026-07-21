import type { InstallPlan, InstallService, MaterializeResult } from '@offisim/install-core';

export type ListingKind = 'employee' | 'skill' | 'template' | 'layout' | 'prefab' | 'bundle';

/** Only employees and skills can be installed; other kinds are catalog-only. */
export const INSTALLABLE_KINDS = new Set<ListingKind>(['employee', 'skill']);

/** Marketplace mode: browse the registry vs. manage local packages/drafts. */
export type MarketMode = 'explore' | 'manage';
/** Manage sub-view. */
export type ManageView = 'installed' | 'updates' | 'published';

export type RiskClass = 'data' | 'logic' | 'system';
export type FsScope = 'none' | 'workspace' | 'system';
export type NetScope = 'none' | 'read' | 'full';
type SecretScope = 'none' | 'declared';

interface ListingPermissions {
  risk: RiskClass;
  filesystem: FsScope;
  network: NetScope;
  secrets: SecretScope;
}

interface ListingRequirements {
  capabilities: string[];
  mcps: string[];
  models: string[];
  /** Minimum runtime semver, e.g. ">=0.7.0". */
  runtime: string;
  schema: number;
}

interface ListingLineage {
  /** Origin slug, e.g. "growth-tools/teardown". */
  origin: string;
  /** Version this package was forked from, null when original. */
  forkedFrom: string | null;
}

type ChangelogEntryKind = 'added' | 'fixed' | 'breaking' | 'note';

interface ChangelogVersion {
  version: string;
  date: string;
  entries: Array<{ kind: ChangelogEntryKind; text: string }>;
}

/** One required model-profile binding slot surfaced in the install flow. */
export interface BindingSlot {
  id: string;
  /** Role label, e.g. "analyst". */
  role: string;
  hint: string;
  required: boolean;
  suggestions: string[];
}

export type InstallBindingValues = Record<string, string | undefined>;

export interface MarketListing {
  id: string;
  kind: ListingKind;
  /** Package slug, e.g. "growth-tools.teardown". */
  slug: string;
  name: string;
  summary: string;
  description: string;
  /** "@handle" creator (without the @). */
  handle: string;
  creatorName: string;
  /** Publisher is verified by the registry. */
  verified: boolean;
  rating: number;
  installs: number;
  version: string;
  /** All published versions, newest first. */
  versions: string[];
  publishedLabel: string;
  tags: string[];
  license: string;
  /** Avatar gradient endpoints for employee covers. */
  avatarA?: string;
  avatarB?: string;
  /** Two-letter initials for employee covers. */
  initials?: string;
  /** Tag glyphs for the employee cover viz. */
  coverTags?: string[];
  /** Whether the package is installed in the active company. */
  installed: boolean;
  permissions: ListingPermissions;
  requirements: ListingRequirements;
  lineage: ListingLineage;
  changelog: ChangelogVersion[];
  /** Screenshot URLs for the detail carousel. */
  screenshots: string[];
  /** Binding slots for the install Configure step. */
  bindings: BindingSlot[];
  /**
   * Real registry artifact URL for installable packages. Fixture/catalog rows
   * intentionally leave this unset so the UI cannot fake a successful install.
   */
  installArtifactUrl?: string | null;
  installSource?: 'registry' | 'file';
  packageVersionId?: string | null;
  artifactSha256?: string | null;
  artifactSizeBytes?: number | null;
}

/** A locally installed package row (Manage · Installed). */
export interface InstalledPackage {
  id: string;
  /** Package id slug, e.g. "offisim-labs/frontend-engineer". */
  packageId: string;
  version: string;
  installedLabel: string;
  /** Origin listing id; null for sideloaded packages shown as local-only state. */
  originListingId: string | null;
  /** Latest available version when an update exists. */
  latestVersion: string | null;
  /** Update-check lifecycle. */
  checkState: 'idle' | 'checking' | 'error';
}

export type DraftStatus = 'draft' | 'validated' | 'submitted' | 'approved' | 'rejected';

/** A published / draft package row (Manage · Published). */
export interface PublishedDraft {
  id: string;
  title: string;
  summary: string | null;
  kind: ListingKind;
  updatedLabel: string;
  status: DraftStatus;
}

/** A company asset that can be packaged for publish (employee or skill). */
export interface PublishSource {
  id: string;
  kind: 'employee' | 'skill';
  /** Display name, e.g. "Senior Frontend Engineer". */
  name: string;
  /** Slug used to seed the package id, e.g. "frontend-engineer". */
  slug: string;
  description?: string;
  payload?: Readonly<Record<string, unknown>>;
  publishable: boolean;
  unavailableReason?: string;
}

export interface PublishPackageRequest {
  source: PublishSource;
  title: string;
  version: string;
  summary: string;
  readme?: string;
  license: string;
  riskClass: RiskClass;
  tags: string[];
}

export interface PublishedPackageResult {
  draftId: string;
  moderationJobId: string;
  status: 'queued' | 'pending_review';
}

export interface ConfirmPackageInstallResult extends MaterializeResult {
  installReceiptId?: string;
  installReceiptError?: string;
}

export interface RegistryConnectionState {
  connected: boolean;
  reason:
    | 'connected'
    | 'registry-config-missing'
    | 'auth-not-configured'
    | 'creator-missing'
    | 'platform-unreachable'
    | 'desktop-runtime-unavailable';
  baseUrl?: string;
}

export interface PendingPackageInstall {
  installTxnId: string;
  plan: InstallPlan;
  listing: MarketListing;
  service: InstallService;
}

export type PackageManifest = InstallPlan['manifest'];
export type ManifestAssetKind = PackageManifest['package']['kind'];
