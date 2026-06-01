import { reposOrNull } from '@/data/adapters.js';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import { resolveAsync } from '@/lib/platform.js';
import { createTauriVaultFileSystem } from '@/lib/tauri-vault-fs.js';
import { runtimeEventBus } from '@/runtime/repos.js';
import {
  type EmployeeRow,
  bindingStateChanged,
  installStateChanged,
  marketListingInstalled,
} from '@offisim/core/browser';
import {
  type BindingConfirmation,
  type BuildPackageArtifactInput,
  FileImportError,
  type InstallEventEmitter,
  type InstallPlan,
  InstallService,
  type InstalledPackageRow,
  type MaterializeResult,
  type RuntimeEnvironment,
  artifactBytesToBase64,
  buildPackageArtifact,
  readPackageFile,
} from '@offisim/install-core';
import {
  type ListingDetail,
  type ListingSummary,
  type PublishDraft,
  RegistryApiError,
  RegistryClient,
  type VersionSummary,
} from '@offisim/registry-client';
import type { SkillRow } from '@offisim/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Market surface view-model + local query layer. Kept isolated from the shared
 * `@/data` contracts so the Market 1:1 redesign can carry the rich registry
 * shape (install state, permissions, lineage, changelog, drafts) without
 * widening the shared `Listing` type. Browser preview may resolve catalog
 * fixtures; release installed/manage state must come from repositories or show
 * an empty/auth-unavailable state.
 */

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
export type SecretScope = 'none' | 'declared';

export interface ListingPermissions {
  risk: RiskClass;
  filesystem: FsScope;
  network: NetScope;
  secrets: SecretScope;
}

export interface ListingRequirements {
  capabilities: string[];
  mcps: string[];
  models: string[];
  /** Minimum runtime semver, e.g. ">=0.7.0". */
  runtime: string;
  schema: number;
}

export interface ListingLineage {
  /** Origin slug, e.g. "growth-tools/teardown". */
  origin: string;
  /** Version this package was forked from, null when original. */
  forkedFrom: string | null;
}

export type ChangelogEntryKind = 'added' | 'fixed' | 'breaking' | 'note';

export interface ChangelogVersion {
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

type PackageManifest = InstallPlan['manifest'];
type ManifestAssetKind = PackageManifest['package']['kind'];

export interface RarityTone {
  /** rarity color token reference. */
  rc: string;
  rcs: string;
}

/** 1:1 with prototype getRarityColor(kind). */
export function getRarityTone(kind: ListingKind): RarityTone {
  switch (kind) {
    case 'employee':
      return { rc: 'var(--off-accent)', rcs: 'var(--off-accent-surface)' };
    case 'skill':
      return { rc: 'var(--off-violet)', rcs: 'var(--off-violet-surface)' };
    case 'template':
      return { rc: 'var(--off-violet)', rcs: 'var(--off-violet-surface)' };
    case 'layout':
      return { rc: 'var(--off-danger)', rcs: 'var(--off-danger-surface)' };
    case 'prefab':
      return { rc: 'var(--off-warn)', rcs: 'var(--off-warn-surface)' };
    default:
      return { rc: 'var(--off-ink-3)', rcs: 'var(--off-surface-sunken)' };
  }
}

export function compactInstalls(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function canInstallListing(listing: MarketListing): boolean {
  // Require a usable install route, not just an artifact URL: a registry
  // listing whose artifact lacks a packageVersionId has installSource
  // undefined and the install flow rejects it, so it must render the locked
  // state rather than an Install button that always errors.
  return (
    INSTALLABLE_KINDS.has(listing.kind) &&
    Boolean(listing.installArtifactUrl) &&
    Boolean(listing.installSource)
  );
}

const DESKTOP_INSTALL_ENVIRONMENT: RuntimeEnvironment = {
  runtimeVersion: '1.0.0',
  environment: 'desktop',
  schemaVersion: '2026-03',
};

function createInstallEvents(): InstallEventEmitter {
  return {
    emitInstallState(companyId, txnId, prev, next, packageId, errorCode) {
      runtimeEventBus.emit(
        installStateChanged(companyId, txnId, prev, next, undefined, packageId, errorCode),
      );
    },
    emitBindingState(companyId, bindingId, txnId, type, key, prev, next) {
      runtimeEventBus.emit(bindingStateChanged(companyId, bindingId, txnId, type, key, prev, next));
    },
    emitMarketListingInstalled(companyId, listingId, kind, extras) {
      runtimeEventBus.emit(marketListingInstalled(companyId, listingId, kind, extras));
    },
  };
}

function manifestKindToListingKind(kind: ManifestAssetKind): ListingKind {
  if (kind === 'company_template') return 'template';
  if (kind === 'office_layout') return 'layout';
  return kind;
}

function manifestRiskToListingRisk(risk: PackageManifest['permissions']['risk_class']): RiskClass {
  if (risk === 'logic_asset') return 'logic';
  if (risk === 'privileged_asset') return 'system';
  return 'data';
}

function manifestFsToListingScope(
  scope: PackageManifest['permissions']['filesystem_scope'],
): FsScope {
  if (scope === 'none') return 'none';
  if (scope === 'workspace' || scope === 'project') return 'workspace';
  return 'system';
}

function manifestNetToListingScope(
  scope: PackageManifest['permissions']['network_scope'],
): NetScope {
  if (scope === 'none') return 'none';
  if (scope === 'limited') return 'read';
  return 'full';
}

function installedAssetKind(manifest: PackageManifest): ListingKind {
  const firstMaterialAsset = manifest.assets.find((asset) => asset.kind !== 'bundle');
  return manifestKindToListingKind(firstMaterialAsset?.kind ?? manifest.package.kind);
}

function planToMarketListing(plan: InstallPlan, sourceRef: string): MarketListing {
  const manifest = plan.manifest;
  const pkg = manifest.package;
  const publisher = pkg.publisher;
  const tags = pkg.tags && pkg.tags.length > 0 ? [...pkg.tags] : manifest.assets.map((a) => a.kind);
  const secretCount = manifest.permissions.secret_slots_required?.length ?? 0;
  const recommendedModels = manifest.requirements.recommended_models ?? [];

  return {
    id: `file:${plan.packageHash}`,
    kind: installedAssetKind(manifest),
    slug: pkg.id,
    name: pkg.title,
    summary: pkg.summary ?? 'Local package import',
    description: pkg.summary ?? `${pkg.title} imported from ${sourceRef}.`,
    handle: publisher?.creator_handle ?? 'local',
    creatorName: publisher?.display_name ?? 'Local package',
    verified: false,
    rating: 0,
    installs: 0,
    version: pkg.version,
    versions: [pkg.version],
    publishedLabel: sourceRef,
    tags,
    license: pkg.license,
    initials: pkg.title
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase(),
    coverTags: tags.slice(0, 3),
    installed: false,
    permissions: {
      risk: manifestRiskToListingRisk(manifest.permissions.risk_class),
      filesystem: manifestFsToListingScope(manifest.permissions.filesystem_scope),
      network: manifestNetToListingScope(manifest.permissions.network_scope),
      secrets: manifest.permissions.declares_secrets || secretCount > 0 ? 'declared' : 'none',
    },
    requirements: {
      capabilities: [...manifest.requirements.required_capabilities],
      mcps: [
        ...manifest.requirements.required_mcps,
        ...(manifest.requirements.optional_mcps ?? []),
      ],
      models: recommendedModels.map((model) => model.profile),
      runtime: manifest.compatibility.runtime_range,
      schema: Number(manifest.compatibility.schema_version) || 1,
    },
    lineage: {
      origin: manifest.lineage?.origin_package_id ?? pkg.id,
      forkedFrom: manifest.lineage?.forked_from_version ?? null,
    },
    changelog: [],
    screenshots: [],
    bindings: plan.bindings.map((binding) => ({
      id: binding.bindingKey,
      role: binding.bindingKey.split(':').at(-1) ?? binding.bindingKey,
      hint: binding.hint ?? `${binding.assetKind} model profile`,
      required: binding.required,
      suggestions: [...(binding.providerHints ?? [])],
    })),
    installArtifactUrl: `file://${sourceRef}`,
    installSource: 'file',
  };
}

function bindingValuesToConfirmations(
  plan: InstallPlan,
  values: InstallBindingValues,
): BindingConfirmation[] {
  return plan.bindings
    .map((binding) => {
      const value = values[binding.bindingKey]?.trim();
      if (!value) return null;
      return {
        bindingKey: binding.bindingKey,
        bindingType: binding.bindingType,
        valueJson: JSON.stringify({ providerModel: value }),
      } satisfies BindingConfirmation;
    })
    .filter((value): value is BindingConfirmation => value !== null);
}

export function describeFileImportError(error: unknown): string {
  if (error instanceof FileImportError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function listingPackageIds(listing: MarketListing): Set<string> {
  return new Set([listing.id, listing.slug, listing.lineage.origin].filter(Boolean));
}

function listingIsInstalled(listing: MarketListing, rows: readonly InstalledPackageRow[]): boolean {
  const ids = listingPackageIds(listing);
  return rows.some(
    (row) =>
      ids.has(row.package_id) ||
      (row.origin_listing_id !== null && ids.has(row.origin_listing_id)) ||
      (row.source_ref !== null && ids.has(row.source_ref)),
  );
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  }).format(date);
}

const NO_REGISTRY_UPDATE: {
  latestVersion: string | null;
  checkState?: InstalledPackage['checkState'];
} = { latestVersion: null };

function installedPackageToVm(
  row: InstalledPackageRow,
  update: {
    latestVersion: string | null;
    checkState?: InstalledPackage['checkState'];
  } = NO_REGISTRY_UPDATE,
): InstalledPackage {
  return {
    id: row.installed_package_id,
    packageId: row.package_id,
    version: row.version,
    installedLabel: shortDate(row.installed_at),
    originListingId: row.origin_listing_id,
    latestVersion: update.latestVersion,
    checkState:
      update.checkState ??
      (row.install_state === 'failed' || row.install_state === 'rolled_back' ? 'error' : 'idle'),
  };
}

function comparableVersion(value: string): [number, number, number] | null {
  const match = value.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/u);
  if (!match) return null;
  return [
    Number.parseInt(match[1] ?? '0', 10),
    Number.parseInt(match[2] ?? '0', 10),
    Number.parseInt(match[3] ?? '0', 10),
  ];
}

function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = comparableVersion(latest);
  const currentParts = comparableVersion(current);
  if (!latestParts || !currentParts) return false;
  for (const i of [0, 1, 2] as const) {
    if (latestParts[i] > currentParts[i]) return true;
    if (latestParts[i] < currentParts[i]) return false;
  }
  return false;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

function registryLookupSlugs(row: InstalledPackageRow): string[] {
  const candidates = uniqueStrings([row.package_id, row.source_ref]);
  return uniqueStrings(candidates.flatMap((value) => [value, value.replace(/\//gu, '.')]));
}

async function lookupInstalledRegistryDetail(
  client: RegistryClient,
  row: InstalledPackageRow,
): Promise<ListingDetail | null> {
  const listingIds = uniqueStrings([row.origin_listing_id, row.source_ref]);
  for (const listingId of listingIds) {
    try {
      return await client.getListingDetail(listingId);
    } catch {
      // Try the next durable identifier before surfacing the row as unchecked.
    }
  }

  for (const slug of registryLookupSlugs(row)) {
    try {
      return await client.getListingBySlug(slug);
    } catch {
      // Registry migrations can change either slug or listing id; keep probing.
    }
  }

  return null;
}

async function installedPackageToVmWithRegistry(
  row: InstalledPackageRow,
  client: RegistryClient,
): Promise<InstalledPackage> {
  const base = installedPackageToVm(row);
  if (row.source_type !== 'registry' && !row.origin_listing_id && !row.origin_package_version_id) {
    return base;
  }

  const detail = await lookupInstalledRegistryDetail(client, row);
  if (!detail) return { ...base, checkState: 'error' };
  const latestVersion = detail.version.version;
  return {
    ...base,
    latestVersion: isNewerVersion(latestVersion, row.version) ? latestVersion : null,
    checkState: 'idle',
  };
}

async function installedPackagesToVm(
  rows: readonly InstalledPackageRow[],
): Promise<InstalledPackage[]> {
  const config = registryConfig();
  if (!config) return rows.map((row) => installedPackageToVm(row));
  const client = registryClient(config);
  return Promise.all(rows.map((row) => installedPackageToVmWithRegistry(row, client)));
}

/* ----------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------- */

const SHOT_A = 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=720&q=70';
const SHOT_B = 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=720&q=70';
const SHOT_C = 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=720&q=70';

const marketListings: MarketListing[] = [
  {
    id: 'lst-fe-engineer',
    kind: 'employee',
    slug: 'offisim-labs.frontend-engineer',
    name: 'Senior Frontend Engineer',
    summary: 'React 19 specialist tuned for design-system work and accessibility passes.',
    description:
      'A senior frontend persona that pairs React 19 fluency with rigorous design-system and accessibility discipline. Ships component work with a11y audits baked into every pass.',
    handle: 'offisim-labs',
    creatorName: 'Offisim Labs',
    verified: true,
    rating: 4.8,
    installs: 3200,
    version: '1.2.0',
    versions: ['1.2.0', '1.1.0', '1.0.0'],
    publishedLabel: '4/02/26',
    tags: ['frontend', 'react', 'design-system'],
    license: 'MIT',
    avatarA: UI_DATA_COLORS.blue4,
    avatarB: UI_DATA_COLORS.blue5,
    initials: 'SF',
    coverTags: ['react·19', 'a11y', 'design-sys'],
    installed: true,
    permissions: { risk: 'logic', filesystem: 'workspace', network: 'none', secrets: 'declared' },
    requirements: {
      capabilities: ['code.write', 'code.read'],
      mcps: [],
      models: ['reasoning-pro'],
      runtime: '>=0.7.0',
      schema: 1,
    },
    lineage: { origin: 'offisim-labs/frontend-engineer', forkedFrom: null },
    changelog: [
      {
        version: '1.2.0',
        date: '4/02/26',
        entries: [
          { kind: 'breaking', text: 'filesystem_scope widened from none to workspace' },
          { kind: 'added', text: 'Accessibility audit sub-pass before sign-off' },
          { kind: 'fixed', text: 'React 19 server-component prompt drift' },
        ],
      },
      {
        version: '1.1.0',
        date: '3/01/26',
        entries: [{ kind: 'added', text: 'Design-token review checklist' }],
      },
    ],
    screenshots: [SHOT_A, SHOT_B, SHOT_C],
    bindings: [
      {
        id: 'b-primary',
        role: 'engineer',
        hint: 'Primary reasoning model',
        required: true,
        suggestions: [],
      },
    ],
  },
  {
    id: 'lst-teardown',
    kind: 'skill',
    slug: 'growth-tools.teardown',
    name: 'Competitive Teardown',
    summary: 'Structured market + competitor analysis, graded teardown report.',
    description:
      'Walks a target market, enumerates direct + adjacent competitors, scores each on positioning, pricing, and moat, then renders a severity-graded teardown the boss can act on.',
    handle: 'growth-tools',
    creatorName: 'Growth Tools',
    verified: false,
    rating: 4.6,
    installs: 980,
    version: '0.4.0',
    versions: ['0.4.0', '0.3.0', '0.2.1'],
    publishedLabel: '3/14/26',
    tags: ['analysis', 'growth', 'research'],
    license: 'MIT',
    installed: false,
    permissions: { risk: 'data', filesystem: 'none', network: 'read', secrets: 'none' },
    requirements: {
      capabilities: ['web.search', 'doc.export'],
      mcps: ['context7'],
      models: ['reasoning-pro'],
      runtime: '>=0.7.0',
      schema: 1,
    },
    lineage: { origin: 'growth-tools/teardown', forkedFrom: '0.2.1' },
    changelog: [
      {
        version: '0.4.0',
        date: '3/14/26',
        entries: [
          { kind: 'added', text: 'Adjacent-competitor enumeration pass' },
          { kind: 'fixed', text: 'Pricing-tier extraction misses' },
        ],
      },
    ],
    screenshots: [SHOT_A, SHOT_B, SHOT_C],
    bindings: [
      {
        id: 'b-analyst',
        role: 'analyst',
        hint: 'Primary reasoning model',
        required: true,
        suggestions: [],
      },
      {
        id: 'b-summarizer',
        role: 'summarizer',
        hint: 'Cheap recap pass',
        required: false,
        suggestions: [],
      },
    ],
  },
  {
    id: 'lst-delivery-pipeline',
    kind: 'bundle',
    slug: 'ops-collective.delivery-pipeline',
    name: 'Feature Delivery Pipeline',
    summary: '5-step delivery kit covering requirements, design, build, QA, and release.',
    description:
      'A five-stage delivery kit that routes work from product requirements through design, build, QA, and a release sign-off gate, with role hand-offs connected between each step.',
    handle: 'ops-collective',
    creatorName: 'Ops Collective',
    verified: true,
    rating: 4.9,
    installs: 12000,
    version: '2.0.0',
    versions: ['2.0.0', '1.4.0'],
    publishedLabel: '2/11/26',
    tags: ['workflow', 'delivery', 'release'],
    license: 'Apache-2.0',
    installed: false,
    permissions: { risk: 'data', filesystem: 'none', network: 'none', secrets: 'none' },
    requirements: {
      capabilities: [],
      mcps: [],
      models: [],
      runtime: '>=0.6.0',
      schema: 1,
    },
    lineage: { origin: 'ops-collective/delivery-pipeline', forkedFrom: null },
    changelog: [
      {
        version: '2.0.0',
        date: '2/11/26',
        entries: [{ kind: 'breaking', text: 'Release gate now requires sign-off role' }],
      },
    ],
    screenshots: [SHOT_C, SHOT_A],
    bindings: [],
  },
  {
    id: 'lst-product-studio',
    kind: 'template',
    slug: 'offisim-labs.lean-product-studio',
    name: 'Lean Product Studio',
    summary: '6-role studio blueprint with connected zones and delivery playbooks.',
    description:
      'A ready-to-run product studio: six roles, connected office zones, and delivery playbooks so a new company is productive from the first run.',
    handle: 'offisim-labs',
    creatorName: 'Offisim Labs',
    verified: true,
    rating: 4.7,
    installs: 5400,
    version: '1.3.0',
    versions: ['1.3.0', '1.2.0'],
    publishedLabel: '4/18/26',
    tags: ['studio', 'blueprint', 'product'],
    license: 'MIT',
    installed: false,
    permissions: { risk: 'data', filesystem: 'none', network: 'none', secrets: 'none' },
    requirements: { capabilities: [], mcps: [], models: [], runtime: '>=0.7.0', schema: 1 },
    lineage: { origin: 'offisim-labs/lean-product-studio', forkedFrom: null },
    changelog: [
      {
        version: '1.3.0',
        date: '4/18/26',
        entries: [{ kind: 'added', text: 'Ops role + breakout zone' }],
      },
    ],
    screenshots: [SHOT_C],
    bindings: [],
  },
  {
    id: 'lst-open-loft',
    kind: 'layout',
    slug: 'studio-kits.open-loft-24',
    name: 'Open Loft 24',
    summary: 'Warehouse-style floor plan with breakout zones and a central pitch hall.',
    description:
      'A warehouse-style open floor plan: clustered desks, two breakout zones, and a central pitch hall sized for company-wide demos.',
    handle: 'studio-kits',
    creatorName: 'Studio Kits',
    verified: false,
    rating: 4.3,
    installs: 760,
    version: '1.0.0',
    versions: ['1.0.0'],
    publishedLabel: '1/22/26',
    tags: ['layout', 'open-plan', 'pitch-hall'],
    license: 'CC-BY-4.0',
    installed: false,
    permissions: { risk: 'data', filesystem: 'none', network: 'none', secrets: 'none' },
    requirements: { capabilities: [], mcps: [], models: [], runtime: '>=0.6.0', schema: 1 },
    lineage: { origin: 'studio-kits/open-loft-24', forkedFrom: null },
    changelog: [
      {
        version: '1.0.0',
        date: '1/22/26',
        entries: [{ kind: 'added', text: 'Initial release' }],
      },
    ],
    screenshots: [SHOT_A],
    bindings: [],
  },
  {
    id: 'lst-desk-cluster',
    kind: 'prefab',
    slug: 'props-bay.desk-cluster',
    name: 'Standing Desk Cluster',
    summary: '4-seat standing desk pod prefab with anchor + footprint spatial spec.',
    description:
      'A four-seat standing desk pod prefab with anchor point and footprint spec, ready to drop into any zone in the Studio editor.',
    handle: 'props-bay',
    creatorName: 'Props Bay',
    verified: false,
    rating: 4.1,
    installs: 410,
    version: '0.9.0',
    versions: ['0.9.0'],
    publishedLabel: '1/30/26',
    tags: ['prefab', 'desk', 'pod'],
    license: 'CC-BY-4.0',
    installed: false,
    permissions: { risk: 'data', filesystem: 'none', network: 'none', secrets: 'none' },
    requirements: { capabilities: [], mcps: [], models: [], runtime: '>=0.6.0', schema: 1 },
    lineage: { origin: 'props-bay/desk-cluster', forkedFrom: null },
    changelog: [
      { version: '0.9.0', date: '1/30/26', entries: [{ kind: 'added', text: 'Initial release' }] },
    ],
    screenshots: [SHOT_B],
    bindings: [],
  },
  {
    id: 'lst-indie-kit',
    kind: 'bundle',
    slug: 'indie-maker.launch-kit',
    name: 'Indie Launch Kit',
    summary: 'Bundle pairing a growth employee with a launch checklist for solo founders.',
    description:
      'A starter bundle for solo founders: a growth-focused employee paired with a launch checklist, so a one-person company can run a launch end to end.',
    handle: 'indie-maker',
    creatorName: 'Indie Maker',
    verified: false,
    rating: 3.9,
    installs: 120,
    version: '0.2.0',
    versions: ['0.2.0', '0.1.0'],
    publishedLabel: '5/01/26',
    tags: ['bundle', 'launch', 'indie'],
    license: 'MIT',
    installed: false,
    permissions: { risk: 'logic', filesystem: 'workspace', network: 'read', secrets: 'declared' },
    requirements: { capabilities: [], mcps: [], models: [], runtime: '>=0.7.0', schema: 1 },
    lineage: { origin: 'indie-maker/launch-kit', forkedFrom: null },
    changelog: [
      { version: '0.2.0', date: '5/01/26', entries: [{ kind: 'added', text: 'Launch checklist' }] },
    ],
    screenshots: [SHOT_C],
    bindings: [],
  },
  {
    id: 'lst-qa-lead',
    kind: 'employee',
    slug: 'offisim-labs.qa-automation-lead',
    name: 'QA Automation Lead',
    summary: 'Regression-first QA persona — writes characterization tests before sign-off.',
    description:
      'A regression-first QA lead that writes characterization tests before any sign-off, then drives an accessibility audit pass on top.',
    handle: 'offisim-labs',
    creatorName: 'Offisim Labs',
    verified: true,
    rating: 4.5,
    installs: 2100,
    version: '1.0.0',
    versions: ['1.0.0'],
    publishedLabel: '4/28/26',
    tags: ['qa', 'testing', 'regression'],
    license: 'MIT',
    avatarA: UI_DATA_COLORS.marketGreen,
    avatarB: UI_DATA_COLORS.marketGreen2,
    initials: 'QA',
    coverTags: ['regression', 'char-tests', 'a11y-audit'],
    installed: false,
    permissions: { risk: 'logic', filesystem: 'workspace', network: 'none', secrets: 'none' },
    requirements: {
      capabilities: ['code.read', 'test.run'],
      mcps: [],
      models: ['reasoning-pro'],
      runtime: '>=0.7.0',
      schema: 1,
    },
    lineage: { origin: 'offisim-labs/qa-automation-lead', forkedFrom: null },
    changelog: [
      { version: '1.0.0', date: '4/28/26', entries: [{ kind: 'added', text: 'Initial release' }] },
    ],
    screenshots: [SHOT_B, SHOT_A],
    bindings: [
      {
        id: 'b-qa',
        role: 'qa-engineer',
        hint: 'Primary reasoning model',
        required: true,
        suggestions: [],
      },
    ],
  },
  {
    id: 'lst-pr-review',
    kind: 'skill',
    slug: 'dx-labs.pr-review-pass',
    name: 'PR Review Pass',
    summary: 'Senior-developer-style review with severity tags and a dedup pass.',
    description:
      'A senior-developer-style review skill that reads a diff, flags issues with severity tags, and runs a dedup pass before emitting a review summary.',
    handle: 'dx-labs',
    creatorName: 'DX Labs',
    verified: true,
    rating: 4.4,
    installs: 540,
    version: '0.6.0',
    versions: ['0.6.0', '0.5.0'],
    publishedLabel: '4/05/26',
    tags: ['review', 'code', 'severity'],
    license: 'MIT',
    installed: false,
    permissions: { risk: 'logic', filesystem: 'workspace', network: 'read', secrets: 'none' },
    requirements: {
      capabilities: ['code.read', 'diff.severity'],
      mcps: [],
      models: ['reasoning-pro'],
      runtime: '>=0.7.0',
      schema: 1,
    },
    lineage: { origin: 'dx-labs/pr-review-pass', forkedFrom: null },
    changelog: [
      { version: '0.6.0', date: '4/05/26', entries: [{ kind: 'fixed', text: 'Dedup false hits' }] },
    ],
    screenshots: [SHOT_A, SHOT_C],
    bindings: [
      {
        id: 'b-reviewer',
        role: 'reviewer',
        hint: 'Primary reasoning model',
        required: true,
        suggestions: [],
      },
    ],
  },
  {
    id: 'lst-pitch-stage',
    kind: 'prefab',
    slug: 'props-bay.pitch-hall-stage',
    name: 'Pitch Hall Stage',
    summary: 'Floor-mounted stage + AV rack with a 4-seat front row.',
    description:
      'A floor-mounted pitch stage prefab with an AV rack and a four-seat front row, sized for the central pitch hall in open-plan layouts.',
    handle: 'props-bay',
    creatorName: 'Props Bay',
    verified: false,
    rating: 4.0,
    installs: 230,
    version: '0.3.0',
    versions: ['0.3.0'],
    publishedLabel: '2/28/26',
    tags: ['prefab', 'stage', 'pitch'],
    license: 'CC-BY-4.0',
    installed: false,
    permissions: { risk: 'data', filesystem: 'none', network: 'none', secrets: 'none' },
    requirements: { capabilities: [], mcps: [], models: [], runtime: '>=0.6.0', schema: 1 },
    lineage: { origin: 'props-bay/pitch-hall-stage', forkedFrom: null },
    changelog: [
      { version: '0.3.0', date: '2/28/26', entries: [{ kind: 'added', text: 'AV rack' }] },
    ],
    screenshots: [SHOT_B],
    bindings: [],
  },
];

const installedPackagesFixture: InstalledPackage[] = [
  {
    id: 'inst-fe',
    packageId: 'offisim-labs/frontend-engineer',
    version: '1.1.0',
    installedLabel: '4/02/26',
    originListingId: 'lst-fe-engineer',
    latestVersion: '1.2.0',
    checkState: 'idle',
  },
  {
    id: 'inst-teardown',
    packageId: 'growth-tools/teardown',
    version: '0.4.0',
    installedLabel: '3/20/26',
    originListingId: 'lst-teardown',
    latestVersion: null,
    checkState: 'idle',
  },
  {
    id: 'inst-launch-kit',
    packageId: 'ops-collective/launch-kit',
    version: '2.0.0',
    installedLabel: '2/11/26',
    originListingId: 'lst-indie-kit',
    latestVersion: null,
    checkState: 'idle',
  },
  {
    id: 'inst-desk-cluster',
    packageId: 'props-bay/desk-cluster',
    version: '0.9.0',
    installedLabel: '1/30/26',
    originListingId: 'lst-desk-cluster',
    latestVersion: null,
    checkState: 'error',
  },
  {
    id: 'inst-sideload',
    packageId: 'sideloaded/local-pack',
    version: '0.1.0',
    installedLabel: '5/01/26',
    originListingId: null,
    latestVersion: null,
    checkState: 'idle',
  },
];

const previewPublishedDrafts: PublishedDraft[] = [
  {
    id: 'drf-fe',
    title: 'Senior Frontend Engineer',
    summary: 'React 19 specialist employee package',
    kind: 'employee',
    updatedLabel: '5/12/26',
    status: 'approved',
  },
  {
    id: 'drf-teardown',
    title: 'Competitive Teardown',
    summary: 'Market analysis skill',
    kind: 'skill',
    updatedLabel: '5/09/26',
    status: 'submitted',
  },
  {
    id: 'drf-untitled',
    title: 'Untitled draft',
    summary: null,
    kind: 'employee',
    updatedLabel: '5/14/26',
    status: 'draft',
  },
  {
    id: 'drf-qa',
    title: 'QA Automation Lead',
    summary: 'Regression-first QA persona',
    kind: 'employee',
    updatedLabel: '4/28/26',
    status: 'rejected',
  },
];

const previewPublishSources: PublishSource[] = [
  {
    id: 'src-fe',
    kind: 'employee',
    name: 'Senior Frontend Engineer',
    slug: 'frontend-engineer',
    publishable: true,
  },
  {
    id: 'src-qa',
    kind: 'employee',
    name: 'QA Automation Lead',
    slug: 'qa-automation-lead',
    publishable: true,
  },
  {
    id: 'src-teardown',
    kind: 'skill',
    name: 'Competitive Teardown',
    slug: 'teardown',
    publishable: false,
    unavailableReason: 'Skill publish requires desktop vault content.',
  },
  {
    id: 'src-review',
    kind: 'skill',
    name: 'PR Review Pass',
    slug: 'pr-review-pass',
    publishable: false,
    unavailableReason: 'Skill publish requires desktop vault content.',
  },
];

/* ----------------------------------------------------------------------------
 * Registry client
 * ------------------------------------------------------------------------- */

const MARKETPLACE_TOKEN_STORAGE_KEY = 'offisim.marketplace.apiToken';

interface RegistryConfig {
  baseUrl: string;
  authToken?: string;
}

function trimEnv(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\/$/u, '') : null;
}

function configuredRegistryBaseUrl(): string | null {
  return (
    trimEnv(import.meta.env.VITE_OFFISIM_REGISTRY_BASE_URL) ??
    trimEnv(import.meta.env.VITE_OFFISIM_PLATFORM_BASE_URL)
  );
}

function storedMarketplaceToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage.getItem(MARKETPLACE_TOKEN_STORAGE_KEY)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function marketplaceTokenConfigured(): boolean {
  return storedMarketplaceToken() !== undefined;
}

export function writeMarketplaceToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = token?.trim() ?? '';
    if (trimmed) {
      window.localStorage.setItem(MARKETPLACE_TOKEN_STORAGE_KEY, trimmed);
    } else {
      window.localStorage.removeItem(MARKETPLACE_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable in hardened preview contexts; callers refresh
    // registry state and surface the resulting connection status.
  }
}

function registryConfig(): RegistryConfig | null {
  const baseUrl = configuredRegistryBaseUrl();
  if (!baseUrl) return null;
  return { baseUrl, authToken: storedMarketplaceToken() };
}

function registryClient(config: RegistryConfig): RegistryClient {
  return new RegistryClient({
    baseUrl: config.baseUrl,
    authToken: config.authToken,
    credentials: 'omit',
  });
}

function installReposWithVault<T extends object>(
  repos: T,
): T & {
  vault: ReturnType<typeof createTauriVaultFileSystem>;
} {
  return { ...repos, vault: createTauriVaultFileSystem() };
}

function registryKindToListingKind(kind: ListingSummary['kind']): ListingKind {
  if (kind === 'company_template') return 'template';
  if (kind === 'office_layout') return 'layout';
  return kind;
}

function registryRiskToListingRisk(risk?: ListingDetail['permissions']['risk_class']): RiskClass {
  if (risk === 'logic_asset') return 'logic';
  if (risk === 'privileged_asset') return 'system';
  return 'data';
}

function registryFsToListingScope(
  scope?: ListingDetail['permissions']['filesystem_scope'],
): FsScope {
  if (scope === 'workspace' || scope === 'project') return 'workspace';
  if (scope === 'custom_path') return 'system';
  return 'none';
}

function registryNetToListingScope(
  scope?: ListingDetail['permissions']['network_scope'],
): NetScope {
  if (scope === 'limited') return 'read';
  if (scope === 'unrestricted') return 'full';
  return 'none';
}

function publishRiskToManifestRisk(risk: RiskClass): BuildPackageArtifactInput['riskClass'] {
  if (risk === 'system') return 'privileged_asset';
  if (risk === 'logic') return 'logic_asset';
  return 'data_asset';
}

function packageIdPart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '.')
      .replace(/^\.+|\.+$/gu, '') || 'package'
  );
}

function buildEmployeeAssetBody(source: PublishSource): string {
  const payload = source.payload ?? {};
  return `${JSON.stringify(
    {
      name: source.name,
      role_slug: source.slug,
      ...payload,
    },
    null,
    2,
  )}\n`;
}

function payloadString(source: PublishSource, key: string): string | null {
  const value = source.payload?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

async function buildPublishArtifactInput(
  request: PublishPackageRequest,
  creator: { handle: string; display_name: string },
): Promise<BuildPackageArtifactInput> {
  if (!request.source.publishable) {
    throw new Error(request.source.unavailableReason ?? 'This source cannot be published.');
  }
  const assetId = request.source.slug.replace(/-/gu, '_');
  const creatorPart = packageIdPart(creator.handle);
  if (request.source.kind === 'skill') {
    const vaultPath = payloadString(request.source, 'vault_path');
    if (!vaultPath) throw new Error('Skill publish requires a desktop vault path.');
    const skillMd = await createTauriVaultFileSystem().readFile(vaultPath);
    return {
      packageId: `${creatorPart}.skill.${packageIdPart(request.source.slug)}`,
      assetId,
      kind: 'skill',
      title: request.title,
      summary: request.summary,
      description: request.readme?.trim() || request.source.description || request.summary,
      version: request.version,
      license: request.license,
      tags: request.tags,
      publisher: {
        creatorHandle: creator.handle,
        displayName: creator.display_name,
      },
      riskClass: publishRiskToManifestRisk(request.riskClass),
      filesystemScope: 'workspace',
      networkScope: 'none',
      assetPath: `assets/skills/${assetId}/SKILL.md`,
      assetBody: skillMd,
      materializerPayload: {
        skill_slug: request.source.slug,
        skill_md_content: skillMd,
        name: request.source.name,
        description: request.source.description ?? request.summary,
      },
      customManifest: {
        skill_slug: request.source.slug,
        skill_md_content: skillMd,
      },
    };
  }
  return {
    packageId: `${creatorPart}.${request.source.kind}.${packageIdPart(request.source.slug)}`,
    assetId,
    kind: request.source.kind,
    title: request.title,
    summary: request.summary,
    description: request.readme?.trim() || request.source.description || request.summary,
    version: request.version,
    license: request.license,
    tags: request.tags,
    publisher: {
      creatorHandle: creator.handle,
      displayName: creator.display_name,
    },
    riskClass: publishRiskToManifestRisk(request.riskClass),
    filesystemScope: 'workspace',
    networkScope: 'none',
    assetPath: `assets/employee.${assetId}.json`,
    assetBody: buildEmployeeAssetBody(request.source),
    materializerPayload: {
      name: request.source.name,
      role_slug: request.source.slug,
      ...(request.source.payload ?? {}),
    },
    customManifest: {
      employee_role_slug: request.source.slug,
    },
  };
}

type RegistryListingPayload = ListingDetail | ListingSummary;

function packageVersionIdFor(detail: RegistryListingPayload): string | null {
  return detail.version?.package_version_id ?? detail.artifact?.package_version_id ?? null;
}

function registryListingToVm(
  summary: ListingSummary,
  detail: RegistryListingPayload,
  installedRows: readonly InstalledPackageRow[],
): MarketListing {
  const version: VersionSummary = detail.version ?? {
    package_id: detail.package_id ?? detail.slug,
    version: detail.latest_version,
    runtime_range: '>=0.7.0',
    schema_version: '1',
    environments: [],
    risk_class: detail.permissions?.risk_class ?? 'data_asset',
  };
  const packageVersionId = packageVersionIdFor(detail);
  const tags = detail.tags ?? [];
  const requirements = detail.requirements ?? {};
  const permissions = detail.permissions ?? {};
  const artifact = detail.artifact ?? null;
  return {
    id: detail.listing_id,
    kind: registryKindToListingKind(detail.kind),
    slug: detail.slug,
    name: detail.title,
    summary: detail.summary,
    description: detail.description ?? detail.summary,
    handle: detail.creator.handle,
    creatorName: detail.creator.display_name,
    verified: detail.creator.verification_state !== 'unverified',
    rating: detail.rating,
    installs: detail.install_count,
    version: version.version,
    versions: [version.version],
    publishedLabel: version.published_at ? shortDate(version.published_at) : 'Live',
    tags,
    license: 'Registry',
    initials: detail.title
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase(),
    coverTags: tags.slice(0, 3),
    installed: listingIsInstalled(
      {
        id: detail.listing_id,
        slug: detail.slug,
        lineage: { origin: detail.package_id ?? detail.slug, forkedFrom: null },
      } as MarketListing,
      installedRows,
    ),
    permissions: {
      risk: registryRiskToListingRisk(permissions.risk_class),
      filesystem: registryFsToListingScope(permissions.filesystem_scope),
      network: registryNetToListingScope(permissions.network_scope),
      secrets: permissions.declares_secrets ? 'declared' : 'none',
    },
    requirements: {
      capabilities: [...(requirements.required_capabilities ?? [])],
      mcps: [...(requirements.required_mcps ?? [])],
      models: (requirements.recommended_models ?? []).map((model) => model.profile),
      runtime: version.runtime_range,
      schema: Number(version.schema_version) || 1,
    },
    lineage: {
      origin:
        detail.lineage?.origin_package_id ?? detail.package_id ?? summary.package_id ?? detail.slug,
      forkedFrom: detail.lineage?.forked_from_version ?? null,
    },
    changelog: version.changelog
      ? [
          {
            version: version.version,
            date: version.published_at ? shortDate(version.published_at) : 'Live',
            entries: [{ kind: 'note', text: version.changelog }],
          },
        ]
      : [],
    screenshots: (detail.previews ?? [])
      .filter((preview) => preview.kind === 'image')
      .map((preview) => preview.url),
    bindings: (requirements.recommended_models ?? []).map((model) => ({
      id: model.profile,
      role: model.profile,
      hint: model.reason ?? 'Recommended model profile',
      required: false,
      suggestions: model.provider_hints ?? [],
    })),
    installArtifactUrl: artifact?.artifact_url ?? null,
    installSource: artifact?.artifact_url && packageVersionId ? 'registry' : undefined,
    packageVersionId,
    artifactSha256: artifact?.artifact_sha256 ?? null,
    artifactSizeBytes: artifact?.artifact_size_bytes ?? null,
  };
}

async function loadRegistryListings(
  companyId: string | null | undefined,
): Promise<MarketListing[] | null> {
  const config = registryConfig();
  if (!config) return null;
  const repos = await reposOrNull();
  const installedRows =
    repos && companyId ? await repos.installedPackages.listByCompany(companyId) : [];
  const client = registryClient(config);
  const search = await client.searchListings({ per_page: 48, sort: 'updated' });
  return search.items.map((summary) => registryListingToVm(summary, summary, installedRows));
}

function draftToVm(draft: PublishDraft): PublishedDraft {
  return {
    id: draft.draft_id,
    title: draft.title ?? 'Untitled draft',
    summary: draft.summary ?? null,
    kind: registryKindToListingKind((draft.kind ?? 'employee') as ListingSummary['kind']),
    updatedLabel: shortDate(draft.updated_at),
    status: draft.status,
  };
}

/* ----------------------------------------------------------------------------
 * Hooks
 * ------------------------------------------------------------------------- */

export function useMarketListings(companyId?: string | null) {
  return useQuery({
    queryKey: ['market-listings', companyId ?? 'preview'],
    queryFn: async () => {
      const registryListings = await loadRegistryListings(companyId);
      if (registryListings) return registryListings;
      const repos = await reposOrNull();
      if (!repos || !companyId) return resolveAsync(marketListings);
      const installedRows = await repos.installedPackages.listByCompany(companyId);
      return marketListings.map((listing) => ({
        ...listing,
        installed: listingIsInstalled(listing, installedRows),
      }));
    },
  });
}

export function useInstalledPackages(companyId?: string | null) {
  return useQuery({
    queryKey: ['market-installed', companyId ?? 'preview'],
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos) return resolveAsync(installedPackagesFixture);
      if (!companyId) return [];
      const rows = await repos.installedPackages.listByCompany(companyId);
      return installedPackagesToVm(rows);
    },
  });
}

export function usePublishedDrafts(enabled = true) {
  return useQuery({
    queryKey: ['market-drafts'],
    queryFn: async () => {
      const config = registryConfig();
      if (config?.authToken) {
        const response = await registryClient(config).listMyDrafts();
        return response.drafts.map(draftToVm);
      }
      const repos = await reposOrNull();
      if (!repos) return resolveAsync(previewPublishedDrafts);
      return [];
    },
    enabled,
  });
}

export function useRegistryConnection() {
  return useQuery({
    queryKey: ['market-registry-connection'],
    queryFn: async (): Promise<RegistryConnectionState> => {
      const repos = await reposOrNull();
      const config = registryConfig();
      if (!config) {
        return {
          connected: false,
          reason: repos ? 'registry-config-missing' : 'desktop-runtime-unavailable',
        };
      }
      if (!config.authToken) {
        return { connected: false, reason: 'auth-not-configured', baseUrl: config.baseUrl };
      }
      try {
        const me = await registryClient(config).getMyCreatorProfile();
        return {
          connected: me.creator !== null,
          reason: me.creator ? 'connected' : 'creator-missing',
          baseUrl: config.baseUrl,
        };
      } catch (error) {
        if (error instanceof RegistryApiError && error.status === 401) {
          return { connected: false, reason: 'auth-not-configured', baseUrl: config.baseUrl };
        }
        return { connected: false, reason: 'platform-unreachable', baseUrl: config.baseUrl };
      }
    },
  });
}

export function usePublishPackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: PublishPackageRequest): Promise<PublishedPackageResult> => {
      const config = registryConfig();
      if (!config) {
        throw new Error('Set the desktop registry base URL before publishing.');
      }
      if (!config.authToken) {
        throw new Error('Connect a marketplace registry token before publishing.');
      }
      const client = registryClient(config);
      const profile = await client.getMyCreatorProfile();
      if (!profile.creator) {
        throw new Error('Publishing requires a marketplace creator profile.');
      }

      const artifact = await buildPackageArtifact(
        await buildPublishArtifactInput(request, profile.creator),
      );
      const draft = await client.createPublishDraft({
        kind: request.source.kind,
        title: request.title,
        summary: request.summary,
        artifact_upload_mode: 'registry_object',
      });
      await client.putDraftManifest(draft.draft_id, {
        manifest_json: artifact.manifest as unknown as Record<string, unknown>,
        artifact: {
          storage_backend: 'registry_object',
          sha256: artifact.packageSha256,
          size_bytes: artifact.sizeBytes,
          bytes_base64: artifactBytesToBase64(artifact.zipBytes),
        },
      });
      const submitted = await client.submitPublishDraft({
        draft_id: draft.draft_id,
        submit_message: `Publish ${request.title} ${request.version}`,
      });
      return {
        draftId: submitted.draft_id,
        moderationJobId: submitted.moderation_job_id,
        status: submitted.status,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['market-drafts'] });
      void queryClient.invalidateQueries({ queryKey: ['market-listings'] });
    },
  });
}

export interface PrepareRegistryInstallInput {
  listing: MarketListing;
  /** Aborts the artifact download when the install dialog is closed. */
  signal?: AbortSignal;
}

export function usePrepareRegistryInstall(companyId?: string | null) {
  return useMutation({
    mutationFn: async ({
      listing,
      signal,
    }: PrepareRegistryInstallInput): Promise<PendingPackageInstall> => {
      if (!companyId) {
        throw new Error('Select or create a company before installing a registry package.');
      }
      if (listing.installSource !== 'registry' || !listing.installArtifactUrl) {
        throw new Error('Registry artifact metadata is missing for this listing.');
      }
      const repos = await reposOrNull();
      if (!repos) {
        throw new Error('Registry install requires the desktop runtime and local database.');
      }

      const response = await fetch(listing.installArtifactUrl, { credentials: 'omit', signal });
      if (!response.ok) {
        throw new Error(`Registry artifact download failed with HTTP ${response.status}.`);
      }
      const archiveBytes = new Uint8Array(await response.arrayBuffer());
      const service = new InstallService({
        repos: installReposWithVault(repos),
        events: createInstallEvents(),
        companyId,
        environment: DESKTOP_INSTALL_ENVIRONMENT,
        asyncTransact: repos.asyncTransact?.bind(repos),
      });
      const result = await service.importFile(archiveBytes, {
        sourceType: 'registry',
        sourceRef: listing.id,
        targetPackageId: listing.slug,
        targetVersion: listing.version,
        descriptor: {
          listing_id: listing.id,
          package_version_id: listing.packageVersionId ?? undefined,
        },
        expectedArtifactSha256: listing.artifactSha256 ?? undefined,
        idempotencyKey: `registry:${listing.packageVersionId ?? listing.id}:${listing.version}`,
      });

      if (!result.plan) {
        throw new Error(
          result.error ?? 'Registry package failed before a review plan was created.',
        );
      }

      return {
        installTxnId: result.installTxnId,
        plan: result.plan,
        listing,
        service,
      };
    },
  });
}

export function usePublishSources(companyId?: string | null) {
  return useQuery({
    queryKey: ['market-publish-sources', companyId ?? 'preview'],
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos) return resolveAsync(previewPublishSources);
      if (!companyId) return [];
      const [employeeRows, skillRows] = await Promise.all([
        repos.employees.findByCompany(companyId),
        repos.skills ? repos.skills.listByCompany(companyId) : [],
      ]);
      return [...employeeRows.map(employeeToPublishSource), ...skillRows.map(skillToPublishSource)];
    },
  });
}

function employeeToPublishSource(row: EmployeeRow): PublishSource {
  return {
    id: row.employee_id,
    kind: 'employee',
    name: row.name,
    slug: sourceSlug(row.name || row.role_slug || row.employee_id),
    description: row.persona_json ?? undefined,
    payload: {
      name: row.name,
      role_slug: row.role_slug,
      persona_json: row.persona_json,
      config_json: row.config_json,
      is_external: row.is_external === 1,
      a2a_url: row.a2a_url,
      a2a_token: row.a2a_token,
      a2a_agent_id: row.a2a_agent_id,
      brand_key: row.brand_key,
      agent_card_json: row.agent_card_json,
    },
    publishable: true,
  };
}

function skillToPublishSource(row: SkillRow): PublishSource {
  const hasVaultPath = row.vault_path.trim().length > 0;
  return {
    id: row.skill_id,
    kind: 'skill',
    name: row.name,
    slug: row.slug || sourceSlug(row.name || row.skill_id),
    description: row.description,
    payload: {
      skill_id: row.skill_id,
      vault_path: row.vault_path,
      scope: row.scope,
      employee_id: row.employee_id,
      version: row.version,
    },
    publishable: hasVaultPath,
    unavailableReason: hasVaultPath ? undefined : 'Skill publish requires desktop vault content.',
  };
}

function sourceSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return slug || 'package';
}

export function useImportPackageFile(companyId?: string | null) {
  return useMutation({
    mutationFn: async (file: File): Promise<PendingPackageInstall> => {
      if (!companyId) {
        throw new Error('Select or create a company before importing a package.');
      }
      const repos = await reposOrNull();
      if (!repos) {
        throw new Error('Package import requires the desktop runtime and local database.');
      }

      const service = new InstallService({
        repos: installReposWithVault(repos),
        events: createInstallEvents(),
        companyId,
        environment: DESKTOP_INSTALL_ENVIRONMENT,
        asyncTransact: repos.asyncTransact?.bind(repos),
      });
      const archiveBytes = await readPackageFile(file);
      const result = await service.importFile(archiveBytes, {
        sourceType: 'file',
        sourceRef: file.name,
        idempotencyKey: `file:${file.name}:${file.size}:${file.lastModified}`,
      });

      if (!result.plan) {
        throw new Error(result.error ?? 'Package import failed before a review plan was created.');
      }

      return {
        installTxnId: result.installTxnId,
        plan: result.plan,
        listing: planToMarketListing(result.plan, file.name),
        service,
      };
    },
  });
}

async function reportRegistryInstallReceipt(
  pending: PendingPackageInstall,
): Promise<{ installReceiptId?: string; installReceiptError?: string }> {
  const packageVersionId = pending.listing.packageVersionId;
  if (pending.listing.installSource !== 'registry' || !packageVersionId) return {};

  const config = registryConfig();
  if (!config?.authToken) return {};

  try {
    const receipt = await registryClient(config).reportInstall({
      listing_id: pending.listing.id,
      package_version_id: packageVersionId,
      install_source: 'registry',
    });
    return { installReceiptId: receipt.install_receipt_id };
  } catch (error) {
    return {
      installReceiptError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function useConfirmPackageInstall(companyId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      pending,
      values,
    }: {
      pending: PendingPackageInstall;
      values: InstallBindingValues;
    }): Promise<ConfirmPackageInstallResult> => {
      const materialized = await pending.service.confirmBindings(
        pending.installTxnId,
        bindingValuesToConfirmations(pending.plan, values),
      );
      const receipt = await reportRegistryInstallReceipt(pending);
      return {
        ...materialized,
        installReceiptId: receipt.installReceiptId,
        installReceiptError: receipt.installReceiptError,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['market-listings', companyId ?? 'preview'] });
      void queryClient.invalidateQueries({
        queryKey: ['market-installed', companyId ?? 'preview'],
      });
      if (companyId) {
        void queryClient.invalidateQueries({ queryKey: ['employees', companyId] });
        void queryClient.invalidateQueries({ queryKey: ['office-layout', companyId] });
      }
      void queryClient.invalidateQueries({ queryKey: ['company-templates'] });
      void queryClient.invalidateQueries({ queryKey: ['office-scene'] });
    },
  });
}

export function useCancelPackageImport() {
  return useMutation({
    mutationFn: async (pending: PendingPackageInstall): Promise<void> => {
      await pending.service.cancel(pending.installTxnId);
    },
  });
}
