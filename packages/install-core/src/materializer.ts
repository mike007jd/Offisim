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

import type {
  AssetKind,
  ManifestAsset,
  PackageManifest,
} from '@offisim/asset-schema';
import { MATERIALIZER_PAYLOADS_KEY } from '@offisim/asset-schema';
import type {
  AssetBindingRow,
  BindingConfirmation,
  InstallPlan,
  InstallProvenance,
  InstallRepositories,
  InstalledAssetRow,
  InstalledPackageRow,
  NewInstalledCompanyTemplate,
  NewEmployee,
  NewInstalledOfficeLayout,
  NewInstalledSopTemplate,
} from './types.js';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/** All entity IDs created during materialization, for rollback tracking. */
export interface MaterializeResult {
  readonly installedPackageId: string;
  readonly installedAssetIds: string[];
  readonly employeeIds: string[];
  readonly sopTemplateIds: string[];
  readonly companyTemplateIds: string[];
  readonly officeLayoutIds: string[];
  readonly prefabInstanceIds: string[];
  readonly bindingIds: string[];
}

export interface MaterializeOptions {
  readonly provenance?: InstallProvenance;
  readonly transact?: <T>(fn: () => T) => T;
  readonly asyncTransact?: <T>(fn: () => Promise<T>) => Promise<T>;
}

type MutableMaterializeResult = {
  installedPackageId: string;
  installedAssetIds: string[];
  employeeIds: string[];
  sopTemplateIds: string[];
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

function buildInstalledEmployeePersona(plan: InstallPlan): string | undefined {
  const summary = plan.manifest.package.summary?.trim();
  if (!summary) return undefined;
  return JSON.stringify({
    expertise: summary,
  });
}

const ASSET_MATERIALIZER_ORDER: readonly AssetKind[] = [
  'employee',
  'sop',
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
    (a, b) =>
      ASSET_MATERIALIZER_ORDER.indexOf(a.kind) - ASSET_MATERIALIZER_ORDER.indexOf(b.kind),
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

function sourceMetadata(plan: InstallPlan, asset: ManifestAsset): Record<string, unknown> {
  return {
    sourcePackageId: plan.manifest.package.id,
    sourceAssetId: asset.asset_id,
    sourcePackageVersion: plan.manifest.package.version,
    assetPath: asset.path,
  };
}

function validateSopDefinitionPayload(definition: unknown, asset: ManifestAsset): void {
  if (!definition || typeof definition !== 'object') {
    throw new Error(`SOP asset '${asset.asset_id}' is missing a definition object`);
  }
  const record = definition as Record<string, unknown>;
  if (
    typeof record.sop_id !== 'string' ||
    typeof record.name !== 'string' ||
    typeof record.description !== 'string' ||
    !Array.isArray(record.steps)
  ) {
    throw new Error(`SOP asset '${asset.asset_id}' has an invalid definition shape`);
  }
  for (const [index, step] of record.steps.entries()) {
    if (!step || typeof step !== 'object') {
      throw new Error(`SOP asset '${asset.asset_id}' step ${index} is not an object`);
    }
    const row = step as Record<string, unknown>;
    if (
      typeof row.step_id !== 'string' ||
      typeof row.label !== 'string' ||
      typeof row.role_slug !== 'string' ||
      typeof row.instruction !== 'string' ||
      !Array.isArray(row.dependencies) ||
      typeof row.output_key !== 'string'
    ) {
      throw new Error(`SOP asset '${asset.asset_id}' step ${index} has an invalid shape`);
    }
  }
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
    !Array.isArray(record.employees) ||
    !Array.isArray(record.sops)
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

function sopDefinitionFromPayload(payload: Readonly<Record<string, unknown>>, asset: ManifestAsset): unknown {
  const definitionJson = stringField(payload, 'definition_json');
  if (!definitionJson) return jsonField(payload, 'definition');
  return parseJsonPayload(definitionJson, asset, 'definition_json');
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
      throw new Error(`Office layout asset '${asset.asset_id}' prefab ${index} is missing prefab id`);
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

function validatePrefabPayload(payload: Readonly<Record<string, unknown>>, asset: ManifestAsset): void {
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

  if (transact) {
    // ── Drizzle / better-sqlite3 path ─────────────────────────────────────
    // All repo .run() calls are synchronous under better-sqlite3.
    // We pre-generate all IDs so we never need to await a create() result.
    // The async Promise wrappers resolve immediately (no I/O yield), so
    // the transaction scope holds for every write inside this callback.
    return transact((): MaterializeResult => {
      // 1. Create installed_packages row
      const installedPackageId = generateId();
      const pkgRow = buildInstalledPackageRow(plan, companyId, installedPackageId, now, provenance);
      void repos.installedPackages.create(pkgRow);

      // 2. Create assets and employees
      const installedAssetIds: string[] = [];
      const employeeIds: string[] = [];
      const sopTemplateIds: string[] = [];
      const companyTemplateIds: string[] = [];
      const officeLayoutIds: string[] = [];
      const prefabInstanceIds: string[] = [];

      for (const asset of orderedAssets(manifest.assets)) {
        assertSupportedAssetKind(asset.kind);
        const installedAssetId = generateId();
        const payload = payloadForAsset(manifest, asset);
        const assetRow: InstalledAssetRow = {
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
        void repos.installedAssets.create(assetRow);
        installedAssetIds.push(installedAssetId);

        if (asset.kind === 'employee') {
          const employeeId = generateId();
          const empData: NewEmployee = {
            employee_id: employeeId,
            company_id: companyId,
            name: manifest.package.title,
            role_slug: asset.asset_id,
            source_asset_id: asset.asset_id,
            source_package_id: manifest.package.id,
            persona_json: buildInstalledEmployeePersona(plan),
          };
          void repos.employees.create(empData);
          employeeIds.push(employeeId);
        }
        if (asset.kind === 'sop') {
          if (!repos.sopTemplates) throw new Error('SOP materializer repository is unavailable');
          const sopTemplateId = `sop_${generateId()}`;
          const definition = sopDefinitionFromPayload(payload, asset);
          validateSopDefinitionPayload(definition, asset);
          const definitionJson =
            stringField(payload, 'definition_json') ??
            stringifyJson(definition, {
              name: manifest.package.title,
              description: manifest.package.summary ?? '',
              steps: [],
              source: sourceMetadata(plan, asset),
            });
          const row: NewInstalledSopTemplate = {
            sop_template_id: sopTemplateId,
            company_id: companyId,
            name: stringField(payload, 'name') ?? manifest.package.title,
            description: stringField(payload, 'description') ?? manifest.package.summary ?? '',
            definition_json: definitionJson,
            source_thread_id: null,
            source_url: `package:${manifest.package.id}:${asset.asset_id}`,
            version: manifest.package.version,
            last_synced_at: now,
          };
          void repos.sopTemplates.create(row);
          sopTemplateIds.push(sopTemplateId);
        }
        if (asset.kind === 'company_template') {
          if (!repos.companyTemplates) {
            throw new Error('Company template materializer repository is unavailable');
          }
          const template = companyTemplateFromPayload(payload, asset);
          const companyTemplateAssetId = `company_template_${generateId()}`;
          const row: NewInstalledCompanyTemplate = {
            company_template_asset_id: companyTemplateAssetId,
            company_id: companyId,
            template_id: stringField(template, 'id') ?? asset.asset_id,
            name: stringField(template, 'name') ?? manifest.package.title,
            description:
              stringField(template, 'description') ?? manifest.package.summary ?? '',
            template_json: stringifyJson(template, {
              source: sourceMetadata(plan, asset),
            }),
            source_package_id: manifest.package.id,
            source_asset_id: asset.asset_id,
            version: manifest.package.version,
          };
          void repos.companyTemplates.create(row);
          companyTemplateIds.push(companyTemplateAssetId);
        }
        if (asset.kind === 'office_layout') {
          if (!repos.officeLayouts) throw new Error('Office layout materializer repository is unavailable');
          validateOfficeLayoutPayload(packagePrefabs, payload, asset);
          const layoutId = `layout_${generateId()}`;
          const row: NewInstalledOfficeLayout = {
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
          void repos.officeLayouts.create(row);
          officeLayoutIds.push(layoutId);
        }
        if (asset.kind === 'prefab') {
          if (!repos.prefabInstances) throw new Error('Prefab materializer repository is unavailable');
          validatePrefabPayload(payload, asset);
          const zoneId = stringField(payload, 'zone_id');
          if (!zoneId) throw new Error(`Prefab asset '${asset.asset_id}' is missing zone_id`);
          const instanceId = `prefab_${generateId()}`;
          const config = jsonField(payload, 'config');
          const row = {
            instance_id: instanceId,
            company_id: companyId,
            prefab_id: stringField(payload, 'prefab_id') ?? asset.asset_id,
            zone_id: zoneId,
            position_x: finiteNumberField(payload, 'position_x', asset),
            position_y: finiteNumberField(payload, 'position_y', asset),
            rotation: (payload.rotation === 90 ||
            payload.rotation === 180 ||
            payload.rotation === 270
              ? payload.rotation
              : 0) as 0 | 90 | 180 | 270,
            bindings_json: stringifyJson(jsonField(payload, 'bindings'), []),
            config_json: stringifyJson(
              {
                ...(config && typeof config === 'object'
                  ? (config as Record<string, unknown>)
                  : {}),
                source: sourceMetadata(plan, asset),
              },
              { source: sourceMetadata(plan, asset) },
            ),
            enabled: asset.default_enabled !== false ? 1 : 0,
            created_at: now,
            updated_at: now,
          };
          void repos.prefabInstances.create(row);
          prefabInstanceIds.push(instanceId);
        }
      }

      // 3. Create asset_bindings rows
      const bindingIds: string[] = [];
      const bindingLookup = new Map(bindings.map((b) => [b.bindingKey, b]));

      for (const req of plan.bindings) {
        const bindingId = generateId();
        const confirmation = bindingLookup.get(req.bindingKey);
        const bindingRow: AssetBindingRow = {
          binding_id: bindingId,
          installed_asset_id: installedAssetIds[0] ?? null,
          install_txn_id: installTxnId,
          binding_type: req.bindingType,
          binding_key: req.bindingKey,
          binding_value_json: confirmation?.valueJson ?? null,
          status: confirmation ? 'satisfied' : req.required ? 'pending' : 'skipped',
          created_at: now,
          updated_at: now,
        };
        void repos.assetBindings.create(bindingRow);
        bindingIds.push(bindingId);
      }

      return {
        installedPackageId,
        installedAssetIds,
        employeeIds,
        sopTemplateIds,
        companyTemplateIds,
        officeLayoutIds,
        prefabInstanceIds,
        bindingIds,
      };
    });
  }

  if (asyncTransact) {
    return asyncTransact(() =>
      materialize(plan, bindings, repos, companyId, installTxnId, { provenance }),
    );
  }

  // ── Memory-repos / fallback async path ──────────────────────────────────
  // Used in tests and browser environments where transact is not available.

  const partial: MutableMaterializeResult = {
    installedPackageId: '',
    installedAssetIds: [],
    employeeIds: [],
    sopTemplateIds: [],
    companyTemplateIds: [],
    officeLayoutIds: [],
    prefabInstanceIds: [],
    bindingIds: [],
  };

  try {
  // 1. Create installed_packages row
  const installedPackageId = generateId();
  partial.installedPackageId = installedPackageId;
  const pkgRow = buildInstalledPackageRow(plan, companyId, installedPackageId, now, provenance);
  await repos.installedPackages.create(pkgRow);

  // 2. Create assets and employees
  const installedAssetIds: string[] = [];
  const employeeIds: string[] = [];
  const sopTemplateIds: string[] = [];
  const companyTemplateIds: string[] = [];
  const officeLayoutIds: string[] = [];
  const prefabInstanceIds: string[] = [];

  for (const asset of orderedAssets(manifest.assets)) {
    assertSupportedAssetKind(asset.kind);
    const installedAssetId = generateId();
    const payload = payloadForAsset(manifest, asset);

    // Create installed_assets row
    const assetRow: InstalledAssetRow = {
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
    await repos.installedAssets.create(assetRow);
    installedAssetIds.push(installedAssetId);
    partial.installedAssetIds.push(installedAssetId);

    if (asset.kind === 'employee') {
      const empData: NewEmployee = {
        company_id: companyId,
        name: manifest.package.title,
        role_slug: asset.asset_id,
        source_asset_id: asset.asset_id,
        source_package_id: manifest.package.id,
        persona_json: buildInstalledEmployeePersona(plan),
      };
      const { employee_id } = await repos.employees.create(empData);
      employeeIds.push(employee_id);
      partial.employeeIds.push(employee_id);
    }

    if (asset.kind === 'sop') {
      if (!repos.sopTemplates) throw new Error('SOP materializer repository is unavailable');
      const sopTemplateId = `sop_${generateId()}`;
      const definition = sopDefinitionFromPayload(payload, asset);
      validateSopDefinitionPayload(definition, asset);
      const row: NewInstalledSopTemplate = {
        sop_template_id: sopTemplateId,
        company_id: companyId,
        name: stringField(payload, 'name') ?? manifest.package.title,
        description: stringField(payload, 'description') ?? manifest.package.summary ?? '',
        definition_json:
          stringField(payload, 'definition_json') ??
          stringifyJson(definition, {
            name: manifest.package.title,
            description: manifest.package.summary ?? '',
            steps: [],
            source: sourceMetadata(plan, asset),
          }),
        source_thread_id: null,
        source_url: `package:${manifest.package.id}:${asset.asset_id}`,
        version: manifest.package.version,
        last_synced_at: now,
      };
      await repos.sopTemplates.create(row);
      sopTemplateIds.push(sopTemplateId);
      partial.sopTemplateIds.push(sopTemplateId);
    }

    if (asset.kind === 'company_template') {
      if (!repos.companyTemplates) {
        throw new Error('Company template materializer repository is unavailable');
      }
      const template = companyTemplateFromPayload(payload, asset);
      const companyTemplateAssetId = `company_template_${generateId()}`;
      const row: NewInstalledCompanyTemplate = {
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
      await repos.companyTemplates.create(row);
      companyTemplateIds.push(companyTemplateAssetId);
      partial.companyTemplateIds.push(companyTemplateAssetId);
    }

    if (asset.kind === 'office_layout') {
      if (!repos.officeLayouts) throw new Error('Office layout materializer repository is unavailable');
      validateOfficeLayoutPayload(packagePrefabs, payload, asset);
      const layoutId = `layout_${generateId()}`;
      const row: NewInstalledOfficeLayout = {
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
      await repos.officeLayouts.create(row);
      officeLayoutIds.push(layoutId);
      partial.officeLayoutIds.push(layoutId);
    }

    if (asset.kind === 'prefab') {
      if (!repos.prefabInstances) throw new Error('Prefab materializer repository is unavailable');
      validatePrefabPayload(payload, asset);
      const zoneId = stringField(payload, 'zone_id');
      if (!zoneId) throw new Error(`Prefab asset '${asset.asset_id}' is missing zone_id`);
      const instanceId = `prefab_${generateId()}`;
      const config = jsonField(payload, 'config');
      const row = {
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
      await repos.prefabInstances.create(row);
      prefabInstanceIds.push(instanceId);
      partial.prefabInstanceIds.push(instanceId);
    }
  }

  // 3. Create asset_bindings rows
  const bindingIds: string[] = [];
  const bindingLookup = new Map(bindings.map((b) => [b.bindingKey, b]));

  for (const req of plan.bindings) {
    const bindingId = generateId();
    const confirmation = bindingLookup.get(req.bindingKey);

    const bindingRow: AssetBindingRow = {
      binding_id: bindingId,
      installed_asset_id: installedAssetIds[0] ?? null,
      install_txn_id: installTxnId,
      binding_type: req.bindingType,
      binding_key: req.bindingKey,
      binding_value_json: confirmation?.valueJson ?? null,
      status: confirmation ? 'satisfied' : req.required ? 'pending' : 'skipped',
      created_at: now,
      updated_at: now,
    };
    await repos.assetBindings.create(bindingRow);
    bindingIds.push(bindingId);
    partial.bindingIds.push(bindingId);
  }

  return {
    installedPackageId,
    installedAssetIds,
    employeeIds,
    sopTemplateIds,
    companyTemplateIds,
    officeLayoutIds,
    prefabInstanceIds,
    bindingIds,
  };
  } catch (err) {
    const { rollback } = await import('./rollback.js');
    await rollback(partial, repos);
    throw err;
  }
}
