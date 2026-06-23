/**
 * Materializer — create runtime entities from an install plan.
 *
 * Materialization creates:
 * 1. installed_packages row
 * 2. For each supported asset: installed_assets + kind-specific local entity rows
 * 3. asset_bindings rows (status: 'satisfied')
 *
 * Returns all created entity IDs for rollback tracking.
 */

import type { AssetKind, ManifestAsset, PackageManifest } from '@offisim/asset-schema';
import { MATERIALIZER_PAYLOADS_KEY } from '@offisim/asset-schema';
import type {
  AssetBindingRow,
  BindingConfirmation,
  InstallPlan,
  InstallProvenance,
  InstallRepositories,
  InstalledAssetRow,
  InstalledPackageRow,
  NewEmployee,
  NewInstalledCompanyTemplate,
  NewInstalledOfficeLayout,
  NewSkill,
} from './types.js';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/** All entity IDs created during materialization, for rollback tracking. */
export interface MaterializeResult {
  readonly installedPackageId: string;
  readonly installedAssetIds: string[];
  readonly employeeIds: string[];
  readonly skillIds: string[];
  readonly skillVaultPaths: string[];
  readonly companyTemplateIds: string[];
  readonly officeLayoutIds: string[];
  readonly prefabInstanceIds: string[];
  readonly bindingIds: string[];
}

/** A skill vault file deferred for post-commit writing (see deferVaultWrites). */
interface PendingVaultWrite {
  readonly vaultPath: string;
  readonly content: string;
}

export interface MaterializeOptions {
  readonly provenance?: InstallProvenance;
  readonly transact?: <T>(fn: () => T) => T;
  readonly asyncTransact?: <T>(fn: (txRepos?: InstallRepositories) => Promise<T>) => Promise<T>;
  /**
   * Internal: set by the `asyncTransact` branch. When present, skill `SKILL.md`
   * vault writes are COLLECTED here instead of written immediately, so they can
   * be flushed by the caller AFTER the DB transaction commits. This closes the
   * FS-after-DB hazard: under the deferred-write transaction, `repos.skills.insert`
   * is buffered until flush, but `repos.vault.writeFile` hits disk at once — so a
   * flush failure (e.g. duplicate slug) or a crash before commit used to leave a
   * SKILL.md on disk with no committed row (an invisible orphan; the in-transaction
   * rollback never sees flush failures). Deferring the write means no file exists
   * until the row is durable.
   */
  readonly deferVaultWrites?: PendingVaultWrite[];
}

type MutableMaterializeResult = {
  installedPackageId: string;
  installedAssetIds: string[];
  employeeIds: string[];
  skillIds: string[];
  skillVaultPaths: string[];
  companyTemplateIds: string[];
  officeLayoutIds: string[];
  prefabInstanceIds: string[];
  bindingIds: string[];
};

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function generateId(): string {
  return globalThis.crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

function nowMsString(): string {
  return String(Date.now());
}

function buildInstalledEmployeePersona(plan: InstallPlan): string | undefined {
  const summary = plan.manifest.package.summary?.trim();
  if (!summary) return undefined;
  return JSON.stringify({
    expertise: summary,
  });
}

function booleanField(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): boolean | undefined {
  const value = payload[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return undefined;
}

function buildEmployeeFromPayload(
  plan: InstallPlan,
  asset: ManifestAsset,
  payload: Readonly<Record<string, unknown>>,
  companyId: string,
  employeeId: string | undefined,
): NewEmployee {
  return {
    ...(employeeId ? { employee_id: employeeId } : {}),
    company_id: companyId,
    name: stringField(payload, 'name') ?? plan.manifest.package.title,
    role_slug: stringField(payload, 'role_slug') ?? asset.asset_id,
    source_asset_id: asset.asset_id,
    source_package_id: plan.manifest.package.id,
    persona_json: stringField(payload, 'persona_json') ?? buildInstalledEmployeePersona(plan),
    config_json: stringField(payload, 'config_json') ?? undefined,
    is_external: booleanField(payload, 'is_external'),
    a2a_url: stringField(payload, 'a2a_url'),
    a2a_token: stringField(payload, 'a2a_token'),
    a2a_agent_id: stringField(payload, 'a2a_agent_id'),
    brand_key: stringField(payload, 'brand_key'),
    agent_card_json: stringField(payload, 'agent_card_json'),
  };
}

const ASSET_MATERIALIZER_ORDER: readonly AssetKind[] = [
  'employee',
  'skill',
  'company_template',
  'office_layout',
  'prefab',
];

const SUPPORTED_ASSET_KINDS = new Set<AssetKind>(ASSET_MATERIALIZER_ORDER);

function assertSupportedAssetKind(kind: string): asserts kind is AssetKind {
  if (!SUPPORTED_ASSET_KINDS.has(kind as AssetKind)) {
    throw new Error(`Unsupported asset kind '${kind}'`);
  }
}

function orderedAssets(assets: readonly ManifestAsset[]): ManifestAsset[] {
  return [...assets].sort(
    (a, b) => ASSET_MATERIALIZER_ORDER.indexOf(a.kind) - ASSET_MATERIALIZER_ORDER.indexOf(b.kind),
  );
}

function customRecord(manifest: PackageManifest): Readonly<Record<string, unknown>> {
  return manifest.custom ?? {};
}

function payloadForAsset(
  manifest: PackageManifest,
  asset: ManifestAsset,
): Readonly<Record<string, unknown>> {
  const payloads = customRecord(manifest)[MATERIALIZER_PAYLOADS_KEY];
  if (!payloads || typeof payloads !== 'object') return {};
  const payload = (payloads as Record<string, unknown>)[asset.asset_id];
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}

function stringField(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function jsonField(payload: Readonly<Record<string, unknown>>, key: string): unknown {
  return payload[key];
}

function stringifyJson(value: unknown, fallback: unknown): string {
  return JSON.stringify(value ?? fallback);
}

function skillSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (!slug) throw new Error('Skill asset is missing a valid slug');
  return slug;
}

function skillMdContent(
  manifest: PackageManifest,
  payload: Readonly<Record<string, unknown>>,
  asset: ManifestAsset,
): string {
  const content =
    stringField(payload, 'skill_md_content') ??
    stringField(customRecord(manifest), 'skill_md_content');
  if (!content) {
    throw new Error(`Skill asset '${asset.asset_id}' is missing skill_md_content`);
  }
  return content;
}

function skillVaultPath(companyId: string, slug: string): string {
  return `companies/${companyId}/skills/${slug}/SKILL.md`;
}

function buildSkillFromPayload(
  manifest: PackageManifest,
  asset: ManifestAsset,
  payload: Readonly<Record<string, unknown>>,
  companyId: string,
  skillId: string,
  vaultPath: string,
  now: string,
): NewSkill {
  const custom = customRecord(manifest);
  const slug = skillSlug(
    stringField(payload, 'skill_slug') ?? stringField(custom, 'skill_slug') ?? asset.asset_id,
  );
  return {
    skill_id: skillId,
    company_id: companyId,
    employee_id: null,
    scope: 'company',
    slug,
    name: stringField(payload, 'name') ?? manifest.package.title,
    description: stringField(payload, 'description') ?? manifest.package.summary ?? '',
    version: manifest.package.version,
    source_kind: 'installed',
    source_ref: manifest.package.id,
    vault_path: vaultPath,
    created_at: now,
    updated_at: now,
  };
}

function sourceMetadata(plan: InstallPlan, asset: ManifestAsset): Record<string, unknown> {
  return {
    sourcePackageId: plan.manifest.package.id,
    sourceAssetId: asset.asset_id,
    sourcePackageVersion: plan.manifest.package.version,
    assetPath: asset.path,
  };
}

function validateCompanyTemplatePayload(
  template: unknown,
  asset: ManifestAsset,
): asserts template is Readonly<Record<string, unknown>> {
  if (!template || typeof template !== 'object') {
    throw new Error(`Company template asset '${asset.asset_id}' is missing a template object`);
  }
  const record = template as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.name !== 'string' ||
    typeof record.description !== 'string' ||
    !Array.isArray(record.employees)
  ) {
    throw new Error(`Company template asset '${asset.asset_id}' has an invalid template shape`);
  }
}

function companyTemplateFromPayload(
  payload: Readonly<Record<string, unknown>>,
  asset: ManifestAsset,
): Readonly<Record<string, unknown>> {
  const templateJson = stringField(payload, 'template_json');
  const template = templateJson ? parseJsonPayload(templateJson, asset, 'template_json') : payload;
  validateCompanyTemplatePayload(template, asset);
  return template;
}

function parseJsonPayload(json: string, asset: ManifestAsset, field: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw new Error(`Asset '${asset.asset_id}' has invalid ${field}`);
  }
}

function packagePrefabAssetIds(manifest: PackageManifest): Set<string> {
  return new Set(
    manifest.assets.filter((asset) => asset.kind === 'prefab').map((asset) => asset.asset_id),
  );
}

function validateOfficeLayoutPayload(
  packagePrefabs: ReadonlySet<string>,
  payload: Readonly<Record<string, unknown>>,
  asset: ManifestAsset,
): void {
  const layout = jsonField(payload, 'layout');
  if (!layout || typeof layout !== 'object') {
    throw new Error(`Office layout asset '${asset.asset_id}' is missing layout JSON`);
  }
  const prefabs = (layout as Record<string, unknown>).prefabs;
  if (prefabs === undefined) return;
  if (!Array.isArray(prefabs)) {
    throw new Error(`Office layout asset '${asset.asset_id}' has invalid prefabs JSON`);
  }
  for (const [index, prefab] of prefabs.entries()) {
    if (!prefab || typeof prefab !== 'object') {
      throw new Error(`Office layout asset '${asset.asset_id}' prefab ${index} is not an object`);
    }
    const prefabId =
      (prefab as Record<string, unknown>).prefab_id ?? (prefab as Record<string, unknown>).prefabId;
    if (typeof prefabId !== 'string' || !prefabId.trim()) {
      throw new Error(
        `Office layout asset '${asset.asset_id}' prefab ${index} is missing prefab id`,
      );
    }
    const isPackagePrefab = packagePrefabs.has(prefabId);
    const isBuiltinPrefab = !prefabId.startsWith('pkg:') && !prefabId.startsWith('package:');
    if (!isPackagePrefab && !isBuiltinPrefab) {
      throw new Error(
        `Office layout asset '${asset.asset_id}' references unavailable prefab '${prefabId}'`,
      );
    }
  }
}

function validatePrefabPayload(
  payload: Readonly<Record<string, unknown>>,
  asset: ManifestAsset,
): void {
  const prefabId = stringField(payload, 'prefab_id') ?? asset.asset_id;
  if (!prefabId.trim()) throw new Error(`Prefab asset '${asset.asset_id}' is missing prefab id`);
  const category = stringField(payload, 'category');
  if (category && !/^[a-z][a-z0-9_-]*$/u.test(category)) {
    throw new Error(`Prefab asset '${asset.asset_id}' has invalid category '${category}'`);
  }
  const bindings = jsonField(payload, 'bindings');
  if (bindings !== undefined && !Array.isArray(bindings)) {
    throw new Error(`Prefab asset '${asset.asset_id}' has invalid bindings JSON`);
  }
}

function finiteNumberField(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  asset: ManifestAsset,
): number {
  const raw = payload[key] ?? 0;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Prefab asset '${asset.asset_id}' has invalid ${key}`);
  }
  return value;
}

function buildInstalledPackageRow(
  plan: InstallPlan,
  companyId: string,
  installedPackageId: string,
  now: string,
  provenance?: InstallProvenance,
): InstalledPackageRow {
  const manifest = plan.manifest;
  return {
    installed_package_id: installedPackageId,
    company_id: companyId,
    package_id: manifest.package.id,
    package_kind: manifest.package.kind,
    version: manifest.package.version,
    source_type: provenance ? 'registry' : 'file',
    source_ref: provenance?.originListingId ?? null,
    manifest_hash: plan.manifestHash,
    package_hash: plan.packageHash,
    install_state: 'installed',
    enabled: 1,
    origin_listing_id: provenance?.originListingId ?? null,
    origin_package_version_id: provenance?.originPackageVersionId ?? null,
    installed_at: now,
    updated_at: now,
  };
}

function buildInstalledAssetRow(
  plan: InstallPlan,
  asset: ManifestAsset,
  payload: Readonly<Record<string, unknown>>,
  installedAssetId: string,
  installedPackageId: string,
  now: string,
): InstalledAssetRow {
  return {
    installed_asset_id: installedAssetId,
    installed_package_id: installedPackageId,
    asset_id: asset.asset_id,
    asset_kind: asset.kind,
    local_instance_id: null,
    entrypoint: asset.entrypoint ?? null,
    enabled: asset.default_enabled !== false ? 1 : 0,
    override_json: JSON.stringify({
      ...sourceMetadata(plan, asset),
      payload,
    }),
    created_at: now,
    updated_at: now,
  };
}

function buildInstalledCompanyTemplateRow(
  plan: InstallPlan,
  asset: ManifestAsset,
  template: Readonly<Record<string, unknown>>,
  companyTemplateAssetId: string,
  companyId: string,
): NewInstalledCompanyTemplate {
  const manifest = plan.manifest;
  return {
    company_template_asset_id: companyTemplateAssetId,
    company_id: companyId,
    template_id: stringField(template, 'id') ?? asset.asset_id,
    name: stringField(template, 'name') ?? manifest.package.title,
    description: stringField(template, 'description') ?? manifest.package.summary ?? '',
    template_json: stringifyJson(template, {
      source: sourceMetadata(plan, asset),
    }),
    source_package_id: manifest.package.id,
    source_asset_id: asset.asset_id,
    version: manifest.package.version,
  };
}

function buildInstalledOfficeLayoutRow(
  plan: InstallPlan,
  asset: ManifestAsset,
  payload: Readonly<Record<string, unknown>>,
  layoutId: string,
  companyId: string,
): NewInstalledOfficeLayout {
  const manifest = plan.manifest;
  return {
    layout_id: layoutId,
    company_id: companyId,
    name: stringField(payload, 'name') ?? manifest.package.title,
    layout_json: stringifyJson(jsonField(payload, 'layout'), {
      source: sourceMetadata(plan, asset),
      zones: [],
      prefabs: [],
    }),
    is_active: 0,
  };
}

function buildInstalledPrefabRow(
  plan: InstallPlan,
  asset: ManifestAsset,
  payload: Readonly<Record<string, unknown>>,
  instanceId: string,
  zoneId: string,
  companyId: string,
  now: string,
) {
  const config = jsonField(payload, 'config');
  return {
    instance_id: instanceId,
    company_id: companyId,
    prefab_id: stringField(payload, 'prefab_id') ?? asset.asset_id,
    zone_id: zoneId,
    position_x: finiteNumberField(payload, 'position_x', asset),
    position_y: finiteNumberField(payload, 'position_y', asset),
    rotation: (payload.rotation === 90 || payload.rotation === 180 || payload.rotation === 270
      ? payload.rotation
      : 0) as 0 | 90 | 180 | 270,
    bindings_json: stringifyJson(jsonField(payload, 'bindings'), []),
    config_json: stringifyJson(
      {
        ...(config && typeof config === 'object' ? (config as Record<string, unknown>) : {}),
        source: sourceMetadata(plan, asset),
      },
      { source: sourceMetadata(plan, asset) },
    ),
    enabled: asset.default_enabled !== false ? 1 : 0,
    created_at: now,
    updated_at: now,
  };
}

function buildAssetBindingRow(
  req: InstallPlan['bindings'][number],
  confirmation: BindingConfirmation | undefined,
  bindingId: string,
  installedAssetId: string | null,
  installTxnId: string,
  now: string,
): AssetBindingRow {
  return {
    binding_id: bindingId,
    installed_asset_id: installedAssetId,
    install_txn_id: installTxnId,
    binding_type: req.bindingType,
    binding_key: req.bindingKey,
    binding_value_json: confirmation?.valueJson ?? null,
    status: confirmation ? 'satisfied' : req.required ? 'pending' : 'skipped',
    created_at: now,
    updated_at: now,
  };
}

function createEmptyResult(installedPackageId = ''): MutableMaterializeResult {
  return {
    installedPackageId,
    installedAssetIds: [],
    employeeIds: [],
    skillIds: [],
    skillVaultPaths: [],
    companyTemplateIds: [],
    officeLayoutIds: [],
    prefabInstanceIds: [],
    bindingIds: [],
  };
}

type AssetMaterializeContext = {
  plan: InstallPlan;
  asset: ManifestAsset;
  payload: Readonly<Record<string, unknown>>;
  installedAssetId: string;
  installedPackageId: string;
  companyId: string;
  now: string;
  packagePrefabs: ReadonlySet<string>;
  result: MutableMaterializeResult;
  partialResult?: MutableMaterializeResult;
};

type ResultListKey = Exclude<keyof MutableMaterializeResult, 'installedPackageId'>;

function pushCreated(
  context: Pick<AssetMaterializeContext, 'result' | 'partialResult'>,
  key: ResultListKey,
  value: string,
): void {
  context.result[key].push(value);
  context.partialResult?.[key].push(value);
}

function pushFinalOnly(
  context: Pick<AssetMaterializeContext, 'result'>,
  key: ResultListKey,
  value: string,
): void {
  context.result[key].push(value);
}

function materializeAssetSync(repos: InstallRepositories, context: AssetMaterializeContext): void {
  const {
    plan,
    asset,
    payload,
    installedAssetId,
    installedPackageId,
    companyId,
    now,
    packagePrefabs,
  } = context;
  const assetRow = buildInstalledAssetRow(
    plan,
    asset,
    payload,
    installedAssetId,
    installedPackageId,
    now,
  );
  void repos.installedAssets.create(assetRow);
  pushCreated(context, 'installedAssetIds', installedAssetId);

  switch (asset.kind) {
    case 'employee': {
      const employeeId = generateId();
      const empData = buildEmployeeFromPayload(plan, asset, payload, companyId, employeeId);
      void repos.employees.create(empData);
      pushCreated(context, 'employeeIds', employeeId);
      return;
    }
    case 'skill':
      throw new Error('skill materialization requires an asyncTransact-capable backend');
    case 'company_template': {
      if (!repos.companyTemplates) {
        throw new Error('Company template materializer repository is unavailable');
      }
      const template = companyTemplateFromPayload(payload, asset);
      const companyTemplateAssetId = `company_template_${generateId()}`;
      const row = buildInstalledCompanyTemplateRow(
        plan,
        asset,
        template,
        companyTemplateAssetId,
        companyId,
      );
      void repos.companyTemplates.create(row);
      pushCreated(context, 'companyTemplateIds', companyTemplateAssetId);
      return;
    }
    case 'office_layout': {
      if (!repos.officeLayouts) {
        throw new Error('Office layout materializer repository is unavailable');
      }
      validateOfficeLayoutPayload(packagePrefabs, payload, asset);
      const layoutId = `layout_${generateId()}`;
      const row = buildInstalledOfficeLayoutRow(plan, asset, payload, layoutId, companyId);
      void repos.officeLayouts.create(row);
      pushCreated(context, 'officeLayoutIds', layoutId);
      return;
    }
    case 'prefab': {
      if (!repos.prefabInstances) {
        throw new Error('Prefab materializer repository is unavailable');
      }
      validatePrefabPayload(payload, asset);
      const zoneId = stringField(payload, 'zone_id');
      if (!zoneId) throw new Error(`Prefab asset '${asset.asset_id}' is missing zone_id`);
      const instanceId = `prefab_${generateId()}`;
      const row = buildInstalledPrefabRow(plan, asset, payload, instanceId, zoneId, companyId, now);
      void repos.prefabInstances.create(row);
      pushCreated(context, 'prefabInstanceIds', instanceId);
      return;
    }
    default:
      assertSupportedAssetKind(asset.kind);
  }
}

async function materializeAssetAsync(
  repos: InstallRepositories,
  context: AssetMaterializeContext,
  options: MaterializeOptions,
): Promise<void> {
  const {
    plan,
    asset,
    payload,
    installedAssetId,
    installedPackageId,
    companyId,
    now,
    packagePrefabs,
  } = context;
  const manifest = plan.manifest;
  const assetRow = buildInstalledAssetRow(
    plan,
    asset,
    payload,
    installedAssetId,
    installedPackageId,
    now,
  );
  await repos.installedAssets.create(assetRow);
  pushCreated(context, 'installedAssetIds', installedAssetId);

  switch (asset.kind) {
    case 'employee': {
      const empData = buildEmployeeFromPayload(plan, asset, payload, companyId, undefined);
      const { employee_id } = await repos.employees.create(empData);
      pushCreated(context, 'employeeIds', employee_id);
      return;
    }
    case 'skill': {
      if (!repos.skills) {
        throw new Error('Skill materializer repository is unavailable');
      }
      const deferredVaultWrites = options.deferVaultWrites;
      const vault = repos.vault;
      if (!deferredVaultWrites && !vault) {
        throw new Error('Skill materializer vault is unavailable');
      }
      const custom = customRecord(manifest);
      const slug = skillSlug(
        stringField(payload, 'skill_slug') ?? stringField(custom, 'skill_slug') ?? asset.asset_id,
      );
      const skillId = generateId();
      const vaultPath = skillVaultPath(companyId, slug);
      const skillNow = nowMsString();
      const row = buildSkillFromPayload(
        manifest,
        asset,
        payload,
        companyId,
        skillId,
        vaultPath,
        skillNow,
      );
      await repos.skills.insert(row);
      const skillContent = skillMdContent(manifest, payload, asset);
      if (deferredVaultWrites) {
        deferredVaultWrites.push({ vaultPath, content: skillContent });
      } else if (vault) {
        await vault.writeFile(vaultPath, skillContent);
        pushCreated(context, 'skillVaultPaths', vaultPath);
      } else {
        throw new Error('Skill materializer vault is unavailable');
      }
      pushCreated(context, 'skillIds', skillId);
      if (deferredVaultWrites) {
        pushFinalOnly(context, 'skillVaultPaths', vaultPath);
      }
      return;
    }
    case 'company_template': {
      if (!repos.companyTemplates) {
        throw new Error('Company template materializer repository is unavailable');
      }
      const template = companyTemplateFromPayload(payload, asset);
      const companyTemplateAssetId = `company_template_${generateId()}`;
      const row = buildInstalledCompanyTemplateRow(
        plan,
        asset,
        template,
        companyTemplateAssetId,
        companyId,
      );
      await repos.companyTemplates.create(row);
      pushCreated(context, 'companyTemplateIds', companyTemplateAssetId);
      return;
    }
    case 'office_layout': {
      if (!repos.officeLayouts) {
        throw new Error('Office layout materializer repository is unavailable');
      }
      validateOfficeLayoutPayload(packagePrefabs, payload, asset);
      const layoutId = `layout_${generateId()}`;
      const row = buildInstalledOfficeLayoutRow(plan, asset, payload, layoutId, companyId);
      await repos.officeLayouts.create(row);
      pushCreated(context, 'officeLayoutIds', layoutId);
      return;
    }
    case 'prefab': {
      if (!repos.prefabInstances) {
        throw new Error('Prefab materializer repository is unavailable');
      }
      validatePrefabPayload(payload, asset);
      const zoneId = stringField(payload, 'zone_id');
      if (!zoneId) throw new Error(`Prefab asset '${asset.asset_id}' is missing zone_id`);
      const instanceId = `prefab_${generateId()}`;
      const row = buildInstalledPrefabRow(plan, asset, payload, instanceId, zoneId, companyId, now);
      await repos.prefabInstances.create(row);
      pushCreated(context, 'prefabInstanceIds', instanceId);
      return;
    }
    default:
      assertSupportedAssetKind(asset.kind);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Materialize a validated install plan into runtime entities.
 *
 * @param plan - The install plan from createInstallPlan().
 * @param bindings - User-confirmed binding values.
 * @param repos - Install repositories for persistence.
 * @param companyId - Target company ID.
 * @param installTxnId - Install transaction ID for traceability.
 * @param transact - Optional DB transaction wrapper (provided by Drizzle repos).
 *   When present, all writes are wrapped in a single SQLite transaction so that
 *   a failure mid-way rolls back every prior write atomically.
 *   Memory repos (tests) do not provide this — they fall back to plain async execution.
 * @returns MaterializeResult with all created entity IDs.
 */
export async function materialize(
  plan: InstallPlan,
  bindings: BindingConfirmation[],
  repos: InstallRepositories,
  companyId: string,
  installTxnId: string,
  options: MaterializeOptions = {},
): Promise<MaterializeResult> {
  const now = nowIso();
  const manifest = plan.manifest;
  const packagePrefabs = packagePrefabAssetIds(manifest);
  const { provenance, transact, asyncTransact } = options;
  const hasSkillAssets = manifest.assets.some((asset) => asset.kind === 'skill');

  // Skill materialization writes SKILL.md files to the vault outside the DB
  // transaction; staying atomic requires the post-commit vault flush in the
  // asyncTransact branch below. A sync-only `transact` backend can wrap the DB
  // rows but cannot defer + flush vault writes, so a skill package handed only
  // `transact` would silently fall through to the non-transactional memory path
  // and break the documented "skill materialization is transactional" invariant.
  // Enforce the invariant instead of assuming it.
  if (hasSkillAssets && transact && !asyncTransact) {
    throw new Error('skill materialization requires an asyncTransact-capable backend');
  }

  if (asyncTransact && hasSkillAssets) {
    if (!repos.vault) {
      throw new Error('Skill materializer vault is unavailable');
    }
    const vault = repos.vault;
    // Collect skill vault writes during the transaction, then flush them only
    // AFTER the DB has committed — so a flush failure or crash can never leave a
    // SKILL.md on disk without its committed row.
    const pendingVaultWrites: PendingVaultWrite[] = [];
    const result = await asyncTransact((txRepos) =>
      materialize(plan, bindings, txRepos ?? repos, companyId, installTxnId, {
        provenance,
        deferVaultWrites: pendingVaultWrites,
      }),
    );

    // DB committed. Write the vault files now. If a write fails post-commit,
    // compensate by deleting the just-committed skill rows (and removing any
    // files already written) so we never leave a row pointing at a missing file.
    try {
      for (const pending of pendingVaultWrites) {
        await vault.writeFile(pending.vaultPath, pending.content);
      }
    } catch (err) {
      // Post-commit vault flush failed. Roll back the ENTIRE committed install
      // (bindings → assets → employees → skills → vault files → package, in
      // FK-safe order) rather than deleting only the skill rows — the latter
      // left orphaned installed_package / installed_asset / binding rows behind
      // a missing skill file. rollback() also removes any files already written
      // (it clears every result.skillVaultPaths) and swallows per-entity errors.
      const { rollback, recordVaultRepairMarker } = await import('./rollback.js');
      // Double failure = the flush failed AND the compensating rollback did NOT
      // fully clean up (either it threw, or it reported per-entity failures). In
      // that case the install is left inconsistent (committed rows + partially-
      // written vault files), so record a DURABLE repair marker instead of
      // dropping the inconsistency on the floor — a recovery pass can finish it.
      let rollbackError: string | null = null;
      try {
        const outcome = await rollback(result, repos);
        if (outcome.errors.length > 0) {
          rollbackError = outcome.errors.join('; ');
        }
      } catch (caught) {
        rollbackError = caught instanceof Error ? caught.message : String(caught);
      }
      if (rollbackError !== null) {
        await recordVaultRepairMarker(repos.vault, {
          kind: 'install-rollback-failure',
          installTxnId,
          recordedAt: nowIso(),
          flushError: err instanceof Error ? err.message : String(err),
          rollbackError,
          orphaned: result,
        });
      }
      throw err;
    }

    return result;
  }

  if (transact && !hasSkillAssets) {
    // ── Drizzle / better-sqlite3 path ─────────────────────────────────────
    // All repo .run() calls are synchronous under better-sqlite3.
    // We pre-generate all IDs so we never need to await a create() result.
    // The async Promise wrappers resolve immediately (no I/O yield), so
    // the transaction scope holds for every write inside this callback.
    //
    // INVARIANT (H/I6): every `void repos.X.create(...)` below assumes the
    // underlying repo runs its INSERT synchronously inside `transact(fn)`. If
    // a future repo implementation actually yields between begin/commit, the
    // transaction scope collapses and these writes happen outside the tx.
    // Any new backend wired into the sync path MUST run its writes
    // synchronously; if you need an async backend, route the call through
    // the `asyncTransact` branch above instead.
    return transact((): MaterializeResult => {
      // 1. Create installed_packages row
      const installedPackageId = generateId();
      const pkgRow = buildInstalledPackageRow(plan, companyId, installedPackageId, now, provenance);
      void repos.installedPackages.create(pkgRow);

      // 2. Create assets and kind-specific runtime rows.
      const result = createEmptyResult(installedPackageId);

      for (const asset of orderedAssets(manifest.assets)) {
        assertSupportedAssetKind(asset.kind);
        const installedAssetId = generateId();
        const payload = payloadForAsset(manifest, asset);
        materializeAssetSync(repos, {
          plan,
          asset,
          payload,
          installedAssetId,
          installedPackageId,
          companyId,
          now,
          packagePrefabs,
          result,
        });
      }

      // 3. Create asset_bindings rows
      const bindingLookup = new Map(bindings.map((b) => [b.bindingKey, b]));

      for (const req of plan.bindings) {
        const bindingId = generateId();
        const confirmation = bindingLookup.get(req.bindingKey);
        const bindingRow = buildAssetBindingRow(
          req,
          confirmation,
          bindingId,
          result.installedAssetIds[0] ?? null,
          installTxnId,
          now,
        );
        void repos.assetBindings.create(bindingRow);
        result.bindingIds.push(bindingId);
      }

      return result;
    });
  }

  if (asyncTransact) {
    return asyncTransact((txRepos) =>
      materialize(plan, bindings, txRepos ?? repos, companyId, installTxnId, { provenance }),
    );
  }

  // ── Memory-repos / fallback async path ──────────────────────────────────
  // Used in tests and browser environments where transact is not available.

  const partial = createEmptyResult();
  const result = createEmptyResult();

  try {
    // 1. Create installed_packages row
    const installedPackageId = generateId();
    partial.installedPackageId = installedPackageId;
    result.installedPackageId = installedPackageId;
    const pkgRow = buildInstalledPackageRow(plan, companyId, installedPackageId, now, provenance);
    await repos.installedPackages.create(pkgRow);

    // 2. Create assets and kind-specific runtime rows.
    for (const asset of orderedAssets(manifest.assets)) {
      assertSupportedAssetKind(asset.kind);
      const installedAssetId = generateId();
      const payload = payloadForAsset(manifest, asset);
      await materializeAssetAsync(
        repos,
        {
          plan,
          asset,
          payload,
          installedAssetId,
          installedPackageId,
          companyId,
          now,
          packagePrefabs,
          result,
          partialResult: partial,
        },
        options,
      );
    }

    // 3. Create asset_bindings rows
    const bindingLookup = new Map(bindings.map((b) => [b.bindingKey, b]));

    for (const req of plan.bindings) {
      const bindingId = generateId();
      const confirmation = bindingLookup.get(req.bindingKey);

      const bindingRow = buildAssetBindingRow(
        req,
        confirmation,
        bindingId,
        result.installedAssetIds[0] ?? null,
        installTxnId,
        now,
      );
      await repos.assetBindings.create(bindingRow);
      result.bindingIds.push(bindingId);
      partial.bindingIds.push(bindingId);
    }

    return result;
  } catch (err) {
    const { rollback } = await import('./rollback.js');
    await rollback(partial, repos);
    throw err;
  }
}
