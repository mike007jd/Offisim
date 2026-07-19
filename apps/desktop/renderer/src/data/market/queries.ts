import { reposOrNull } from '@/data/adapters.js';
import { queryKeys } from '@/data/query-keys.js';
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
  type RuntimeEnvironment,
  artifactBytesToBase64,
  buildPackageArtifact,
  isLooseVersionNewer,
  readPackageFile,
} from '@offisim/install-core';
import {
  type ListingDetail,
  type ListingSummary,
  type PublishDraft,
  RegistryApiError,
  type RegistryClient,
  type VersionSummary,
} from '@offisim/registry-client';
import type { SkillRow } from '@offisim/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { registryClient, registryConfig } from './registry-client.js';
import type {
  ConfirmPackageInstallResult,
  FsScope,
  InstallBindingValues,
  InstalledPackage,
  ListingKind,
  ManifestAssetKind,
  MarketListing,
  NetScope,
  PackageManifest,
  PendingPackageInstall,
  PublishPackageRequest,
  PublishSource,
  PublishedDraft,
  PublishedPackageResult,
  RegistryConnectionState,
  RiskClass,
} from './types.js';

/**
 * Market registry, package install, and publish data layer.
 */

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

function packageKindToListingKind(kind: ManifestAssetKind | ListingSummary['kind']): ListingKind {
  if (kind === 'company_template') return 'template';
  if (kind === 'office_layout') return 'layout';
  return kind;
}

function packageRiskToListingRisk(
  risk?: PackageManifest['permissions']['risk_class'] | ListingDetail['permissions']['risk_class'],
): RiskClass {
  if (risk === 'logic_asset') return 'logic';
  if (risk === 'privileged_asset') return 'system';
  return 'data';
}

function packageFsToListingScope(
  scope:
    | PackageManifest['permissions']['filesystem_scope']
    | ListingDetail['permissions']['filesystem_scope']
    | undefined,
  fallback: FsScope,
): FsScope {
  if (scope === 'none') return 'none';
  if (scope === 'workspace' || scope === 'project') return 'workspace';
  if (scope === 'custom_path') return 'system';
  return fallback;
}

function packageNetToListingScope(
  scope:
    | PackageManifest['permissions']['network_scope']
    | ListingDetail['permissions']['network_scope']
    | undefined,
  fallback: NetScope,
): NetScope {
  if (scope === 'none') return 'none';
  if (scope === 'limited') return 'read';
  if (scope === 'unrestricted') return 'full';
  return fallback;
}

function installedAssetKind(manifest: PackageManifest): ListingKind {
  const firstMaterialAsset = manifest.assets.find((asset) => asset.kind !== 'bundle');
  return packageKindToListingKind(firstMaterialAsset?.kind ?? manifest.package.kind);
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
      risk: packageRiskToListingRisk(manifest.permissions.risk_class),
      filesystem: packageFsToListingScope(manifest.permissions.filesystem_scope, 'system'),
      network: packageNetToListingScope(manifest.permissions.network_scope, 'full'),
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
  if (error instanceof FileImportError) {
    if (error.code === 'file_too_large') return 'This file is larger than the 50 MB import limit.';
    if (error.code === 'invalid_extension') return 'Choose a Market export or ZIP archive.';
    return 'The selected file could not be read. Choose it again and retry.';
  }
  return 'The selected item could not be imported. Check the file and try again.';
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
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

const NO_REGISTRY_UPDATE: {
  latestVersion: string | null;
  checkState?: InstalledPackage['checkState'];
} = { latestVersion: null };
const REGISTRY_INSTALL_LOOKUP_CONCURRENCY = 4;

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

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

function registryLookupSlugs(row: InstalledPackageRow): string[] {
  const candidates = uniqueStrings([row.package_id, row.source_ref]);
  return uniqueStrings(candidates.flatMap((value) => [value, value.replace(/\//gu, '.')]));
}

interface RegistryLookupCache {
  listingIds: Map<string, Promise<ListingDetail | null>>;
  slugs: Map<string, Promise<ListingDetail | null>>;
}

function cachedRegistryDetail(
  cache: Map<string, Promise<ListingDetail | null>>,
  key: string,
  load: () => Promise<ListingDetail>,
): Promise<ListingDetail | null> {
  let cached = cache.get(key);
  if (!cached) {
    cached = load().catch(() => null);
    cache.set(key, cached);
  }
  return cached;
}

async function lookupInstalledRegistryDetail(
  client: RegistryClient,
  row: InstalledPackageRow,
  cache: RegistryLookupCache,
): Promise<ListingDetail | null> {
  const listingIds = uniqueStrings([row.origin_listing_id, row.source_ref]);
  for (const listingId of listingIds) {
    const detail = await cachedRegistryDetail(cache.listingIds, listingId, () =>
      client.getListingDetail(listingId),
    );
    if (detail) return detail;
  }

  for (const slug of registryLookupSlugs(row)) {
    const detail = await cachedRegistryDetail(cache.slugs, slug, () =>
      client.getListingBySlug(slug),
    );
    if (detail) return detail;
  }

  return null;
}

async function installedPackageToVmWithRegistry(
  row: InstalledPackageRow,
  client: RegistryClient,
  cache: RegistryLookupCache,
): Promise<InstalledPackage> {
  const base = installedPackageToVm(row);
  if (row.source_type !== 'registry' && !row.origin_listing_id && !row.origin_package_version_id) {
    return base;
  }

  const detail = await lookupInstalledRegistryDetail(client, row, cache);
  if (!detail) return { ...base, checkState: 'error' };
  const latestVersion = detail.version.version;
  return {
    ...base,
    latestVersion: isLooseVersionNewer(latestVersion, row.version) ? latestVersion : null,
    checkState: 'idle',
  };
}

async function mapWithConcurrency<T, U>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index] as T);
      }
    }),
  );
  return results;
}

async function installedPackagesToVm(
  rows: readonly InstalledPackageRow[],
): Promise<InstalledPackage[]> {
  const config = await registryConfig();
  if (!config) return rows.map((row) => installedPackageToVm(row));
  const client = registryClient(config);
  const cache: RegistryLookupCache = { listingIds: new Map(), slugs: new Map() };
  return mapWithConcurrency(rows, REGISTRY_INSTALL_LOOKUP_CONCURRENCY, (row) =>
    installedPackageToVmWithRegistry(row, client, cache),
  );
}

/* ----------------------------------------------------------------------------
 * Registry client
 * ------------------------------------------------------------------------- */

function installReposWithVault<T extends object>(
  repos: T,
): T & {
  vault: ReturnType<typeof createTauriVaultFileSystem>;
} {
  return { ...repos, vault: createTauriVaultFileSystem() };
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
    kind: packageKindToListingKind(detail.kind),
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
      risk: packageRiskToListingRisk(permissions.risk_class),
      filesystem: packageFsToListingScope(permissions.filesystem_scope, 'none'),
      network: packageNetToListingScope(permissions.network_scope, 'none'),
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
  const config = await registryConfig();
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
    kind: packageKindToListingKind((draft.kind ?? 'employee') as ListingSummary['kind']),
    updatedLabel: shortDate(draft.updated_at),
    status: draft.status,
  };
}

/* ----------------------------------------------------------------------------
 * Hooks
 * ------------------------------------------------------------------------- */

export function useMarketListings(companyId?: string | null) {
  return useQuery({
    queryKey: queryKeys.marketListings(companyId),
    queryFn: async () => {
      const registryListings = await loadRegistryListings(companyId);
      if (registryListings) return registryListings;
      return [] as MarketListing[];
    },
  });
}

export function useInstalledPackages(companyId?: string | null) {
  return useQuery({
    queryKey: queryKeys.marketInstalled(companyId),
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos) return [];
      if (!companyId) return [];
      const rows = await repos.installedPackages.listByCompany(companyId);
      return installedPackagesToVm(rows);
    },
  });
}

export function usePublishedDrafts(enabled = true) {
  return useQuery({
    queryKey: queryKeys.marketDrafts(),
    queryFn: async () => {
      const config = await registryConfig();
      if (config?.authToken) {
        const response = await registryClient(config).listMyDrafts();
        return response.drafts.map(draftToVm);
      }
      return [];
    },
    enabled,
  });
}

export function useRegistryConnection() {
  return useQuery({
    queryKey: queryKeys.marketRegistryConnection(),
    queryFn: async (): Promise<RegistryConnectionState> => {
      const repos = await reposOrNull();
      const config = await registryConfig();
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
      const config = await registryConfig();
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.marketDrafts() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.marketListingsAll() });
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
        asyncTransact: repos.asyncTransact.bind(repos),
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
    queryKey: queryKeys.marketPublishSources(companyId),
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos) return [];
      if (!companyId) return [];
      const [employeeRows, skillRows] = await Promise.all([
        repos.employees.findByCompany(companyId),
        repos.skills.listByCompany(companyId),
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
      // Never publish the publisher's live A2A bearer token into the package
      // artifact / registry payload — the installer configures their own. (S3:
      // the column is sealed at rest; this strips it from the publish path too.)
      a2a_token: null,
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
        asyncTransact: repos.asyncTransact.bind(repos),
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

  const config = await registryConfig();
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.marketListings(companyId) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.marketInstalled(companyId),
      });
      if (companyId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.employees(companyId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.officeLayout(companyId) });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.companyTemplates() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.officeScene() });
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
