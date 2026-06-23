/**
 * Rollback — reverse materialization artifacts on install failure.
 *
 * Deletes run in reverse creation order (bindings → assets → employees → package)
 * to respect foreign key constraints. Within each type deletes run in parallel.
 * Individual failures are collected and logged (best-effort cleanup).
 */

import type { MaterializeResult } from './materializer.js';
import type { InstallRepositories, InstallVaultFileSystem } from './types.js';

function formatError(label: string, err: unknown): string {
  return `${label}: ${err instanceof Error ? err.message : String(err)}`;
}

/**
 * Durable marker written when a post-commit vault flush AND its compensating
 * rollback BOTH fail. Without it, the install is left in an inconsistent state
 * (committed rows / partially-written vault files) recorded only via
 * `console.warn`, which a recovery process cannot act on. The marker is a
 * recoverable record: it pins the install transaction plus every entity ID and
 * vault path the failed rollback should have removed, so a later repair pass can
 * find and finish the cleanup.
 */
export interface VaultRepairRecord {
  readonly kind: 'install-rollback-failure';
  readonly installTxnId: string;
  readonly recordedAt: string;
  readonly flushError: string;
  readonly rollbackError: string;
  readonly orphaned: MaterializeResult;
}

/** Deterministic vault path for a transaction's repair marker. */
export function vaultRepairMarkerPath(installTxnId: string): string {
  return `_repair/install-rollback/${installTxnId}.json`;
}

/**
 * Persist a durable repair record to the vault on the flush-then-rollback
 * double-failure path. Best-effort: if even the marker write fails we fall back
 * to a warning, but we have done everything possible to leave a recoverable
 * trace rather than silently losing the inconsistency.
 *
 * @returns the vault path written, or `null` if no vault was available / the
 *   marker write itself failed.
 */
export async function recordVaultRepairMarker(
  vault: InstallVaultFileSystem | undefined,
  record: VaultRepairRecord,
): Promise<string | null> {
  if (!vault) {
    console.warn(
      '[install-core/rollback] flush+rollback double-failure but no vault to record repair marker:',
      record.installTxnId,
    );
    return null;
  }
  const path = vaultRepairMarkerPath(record.installTxnId);
  try {
    await vault.writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
    return path;
  } catch (err) {
    console.warn(
      '[install-core/rollback] failed to write repair marker for',
      record.installTxnId,
      formatError('vault.writeFile', err),
    );
    return null;
  }
}

function collectErrors(
  results: PromiseSettledResult<unknown>[],
  ids: string[],
  label: (id: string) => string,
  errors: string[],
): void {
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r?.status === 'rejected') {
      errors.push(formatError(label(ids[i] ?? '<unknown>'), r.reason));
    }
  }
}

/**
 * Outcome of a best-effort rollback. `errors` is empty on a clean rollback and
 * lists the per-entity failures otherwise. Returned (rather than only warned) so
 * the caller can detect a rollback that did NOT fully clean up and record a
 * durable repair marker.
 */
export interface RollbackOutcome {
  readonly errors: readonly string[];
}

export async function rollback(
  result: MaterializeResult,
  repos: InstallRepositories,
): Promise<RollbackOutcome> {
  const errors: string[] = [];

  const bindingResults = await Promise.allSettled(
    result.bindingIds.map((id) => repos.assetBindings.delete(id)),
  );
  collectErrors(bindingResults, result.bindingIds, (id) => `assetBindings.delete(${id})`, errors);

  const assetResults = await Promise.allSettled(
    result.installedAssetIds.map((id) => repos.installedAssets.delete(id)),
  );
  collectErrors(
    assetResults,
    result.installedAssetIds,
    (id) => `installedAssets.delete(${id})`,
    errors,
  );

  const employeeResults = await Promise.allSettled(
    result.employeeIds.map((id) => repos.employees.delete(id)),
  );
  collectErrors(employeeResults, result.employeeIds, (id) => `employees.delete(${id})`, errors);

  const skillResults = await Promise.allSettled(
    (result.skillIds ?? []).map((id) => repos.skills?.delete(id)),
  );
  collectErrors(skillResults, result.skillIds ?? [], (id) => `skills.delete(${id})`, errors);

  const skillVaultResults = await Promise.allSettled(
    (result.skillVaultPaths ?? []).map((path) => repos.vault?.remove(path)),
  );
  collectErrors(
    skillVaultResults,
    result.skillVaultPaths ?? [],
    (path) => `vault.remove(${path})`,
    errors,
  );

  const prefabResults = await Promise.allSettled(
    (result.prefabInstanceIds ?? []).map((id) => repos.prefabInstances?.delete(id)),
  );
  collectErrors(
    prefabResults,
    result.prefabInstanceIds ?? [],
    (id) => `prefabInstances.delete(${id})`,
    errors,
  );

  const layoutResults = await Promise.allSettled(
    (result.officeLayoutIds ?? []).map((id) => repos.officeLayouts?.delete(id)),
  );
  collectErrors(
    layoutResults,
    result.officeLayoutIds ?? [],
    (id) => `officeLayouts.delete(${id})`,
    errors,
  );

  const companyTemplateResults = await Promise.allSettled(
    (result.companyTemplateIds ?? []).map((id) => repos.companyTemplates?.delete(id)),
  );
  collectErrors(
    companyTemplateResults,
    result.companyTemplateIds ?? [],
    (id) => `companyTemplates.delete(${id})`,
    errors,
  );

  if (result.installedPackageId) {
    try {
      await repos.installedPackages.delete(result.installedPackageId);
    } catch (err) {
      errors.push(formatError(`installedPackages.delete(${result.installedPackageId})`, err));
    }
  }

  if (errors.length > 0) {
    console.warn('[install-core/rollback] Partial cleanup — some deletes failed:', errors);
  }

  return { errors };
}
