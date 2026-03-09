/**
 * Materializer — create runtime entities from an install plan.
 *
 * MVP scope: employee assets only.
 *
 * Materialization creates:
 * 1. installed_packages row
 * 2. For each employee asset: installed_assets + employees row
 * 3. asset_bindings rows (status: 'satisfied')
 *
 * Returns all created entity IDs for rollback tracking.
 */

import type {
  InstallPlan,
  BindingConfirmation,
  InstallRepositories,
  InstalledPackageRow,
  InstalledAssetRow,
  AssetBindingRow,
  NewEmployee,
} from './types.js';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/** All entity IDs created during materialization, for rollback tracking. */
export interface MaterializeResult {
  readonly installedPackageId: string;
  readonly installedAssetIds: string[];
  readonly employeeIds: string[];
  readonly bindingIds: string[];
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function generateId(): string {
  return globalThis.crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
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
 * @returns MaterializeResult with all created entity IDs.
 */
export async function materialize(
  plan: InstallPlan,
  bindings: BindingConfirmation[],
  repos: InstallRepositories,
  companyId: string,
  installTxnId: string,
): Promise<MaterializeResult> {
  const now = nowIso();
  const manifest = plan.manifest;

  // 1. Create installed_packages row
  const installedPackageId = generateId();
  const pkgRow: InstalledPackageRow = {
    installed_package_id: installedPackageId,
    company_id: companyId,
    package_id: manifest.package.id,
    package_kind: manifest.package.kind,
    version: manifest.package.version,
    source_type: 'file',
    source_ref: null,
    manifest_hash: plan.manifestHash,
    package_hash: plan.packageHash,
    install_state: 'installed',
    enabled: 1,
    installed_at: now,
    updated_at: now,
  };
  await repos.installedPackages.create(pkgRow);

  // 2. Create assets and employees
  const installedAssetIds: string[] = [];
  const employeeIds: string[] = [];

  for (const asset of manifest.assets) {
    const installedAssetId = generateId();

    // Create installed_assets row
    const assetRow: InstalledAssetRow = {
      installed_asset_id: installedAssetId,
      installed_package_id: installedPackageId,
      asset_id: asset.asset_id,
      asset_kind: asset.kind,
      local_instance_id: null,
      entrypoint: asset.entrypoint ?? null,
      enabled: asset.default_enabled !== false ? 1 : 0,
      override_json: null,
      created_at: now,
      updated_at: now,
    };
    await repos.installedAssets.create(assetRow);
    installedAssetIds.push(installedAssetId);

    // MVP: Only create employees for employee-kind assets
    if (asset.kind === 'employee') {
      const empData: NewEmployee = {
        company_id: companyId,
        name: manifest.package.title,
        role_slug: asset.asset_id,
        source_asset_id: asset.asset_id,
        source_package_id: manifest.package.id,
      };
      const { employee_id } = await repos.employees.create(empData);
      employeeIds.push(employee_id);
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
      installed_asset_id: installedAssetIds[0] ?? null, // MVP: associate with first asset
      install_txn_id: installTxnId,
      binding_type: req.bindingType,
      binding_key: req.bindingKey,
      binding_value_json: confirmation?.valueJson ?? null,
      status: confirmation ? 'satisfied' : (req.required ? 'pending' : 'skipped'),
      created_at: now,
      updated_at: now,
    };
    await repos.assetBindings.create(bindingRow);
    bindingIds.push(bindingId);
  }

  return {
    installedPackageId,
    installedAssetIds,
    employeeIds,
    bindingIds,
  };
}
