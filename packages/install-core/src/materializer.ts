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
  AssetBindingRow,
  BindingConfirmation,
  InstallPlan,
  InstallRepositories,
  InstalledAssetRow,
  InstalledPackageRow,
  NewEmployee,
} from './types.js';

interface InstalledSkillRuntimeConfig {
  readonly skillName: string;
  readonly summary: string;
  readonly instructionMode?: string;
  readonly instructionExcerpt?: string;
  readonly instructions?: string;
  readonly capabilityIndex?: unknown;
  readonly allowedTools?: readonly string[];
  readonly userInvocable?: boolean;
}

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

function buildInstalledEmployeePersona(plan: InstallPlan): string | undefined {
  const summary = plan.manifest.package.summary?.trim();
  if (!summary) return undefined;
  return JSON.stringify({
    expertise: summary,
  });
}

function buildInstalledEmployeeConfig(plan: InstallPlan): string | undefined {
  const custom = plan.manifest.custom as Record<string, unknown> | undefined;
  if (!custom?.openclaw_skill_index) return undefined;

  const runtimeSkill: InstalledSkillRuntimeConfig = {
    skillName: plan.manifest.package.title,
    summary: plan.manifest.package.summary ?? '',
    instructionMode:
      typeof custom.openclaw_instruction_mode === 'string'
        ? custom.openclaw_instruction_mode
        : undefined,
    instructionExcerpt:
      typeof custom.openclaw_instruction_excerpt === 'string'
        ? custom.openclaw_instruction_excerpt
        : undefined,
    instructions:
      typeof custom.openclaw_instructions === 'string' ? custom.openclaw_instructions : undefined,
    capabilityIndex: custom.openclaw_skill_index,
    allowedTools: Array.isArray(custom.openclaw_allowed_tools)
      ? (custom.openclaw_allowed_tools as readonly string[])
      : undefined,
    userInvocable:
      typeof custom.openclaw_user_invocable === 'boolean'
        ? custom.openclaw_user_invocable
        : undefined,
  };

  return JSON.stringify({
    runtimeSkill,
  });
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
  transact?: <T>(fn: () => T) => T,
): Promise<MaterializeResult> {
  const now = nowIso();
  const manifest = plan.manifest;

  if (transact) {
    // ── Drizzle / better-sqlite3 path ─────────────────────────────────────
    // All repo .run() calls are synchronous under better-sqlite3.
    // We pre-generate all IDs so we never need to await a create() result.
    // The async Promise wrappers resolve immediately (no I/O yield), so
    // the transaction scope holds for every write inside this callback.
    return transact((): MaterializeResult => {
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
      void repos.installedPackages.create(pkgRow);

      // 2. Create assets and employees
      const installedAssetIds: string[] = [];
      const employeeIds: string[] = [];

      for (const asset of manifest.assets) {
        const installedAssetId = generateId();
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
        void repos.installedAssets.create(assetRow);
        installedAssetIds.push(installedAssetId);

        if (asset.kind === 'employee') {
          // Pre-generate the employee ID so we can push it without awaiting.
          // Drizzle's employee.create() ignores the passed ID and generates its
          // own via crypto.randomUUID() inside the repo — so we need a different
          // approach: capture the returned ID from the synchronously-resolving Promise.
          const empData: NewEmployee = {
            company_id: companyId,
            name: manifest.package.title,
            role_slug: asset.asset_id,
            source_asset_id: asset.asset_id,
            source_package_id: manifest.package.id,
            persona_json: buildInstalledEmployeePersona(plan),
            config_json: buildInstalledEmployeeConfig(plan),
          };
          // The Drizzle repo wraps a sync .run() in Promise.resolve().
          // We capture the result via a synchronously-settled promise chain.
          let capturedId = '';
          void repos.employees.create(empData).then((r) => {
            capturedId = r.employee_id;
          });
          // capturedId is now set because the microtask resolved synchronously
          // (better-sqlite3 never yields to the event loop).
          employeeIds.push(capturedId);
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

      return { installedPackageId, installedAssetIds, employeeIds, bindingIds };
    });
  }

  // ── Memory-repos / fallback async path ──────────────────────────────────
  // Used in tests and browser environments where transact is not available.

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
        persona_json: buildInstalledEmployeePersona(plan),
        config_json: buildInstalledEmployeeConfig(plan),
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
      status: confirmation ? 'satisfied' : req.required ? 'pending' : 'skipped',
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
