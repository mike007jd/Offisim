/**
 * Rollback — reverse materialization artifacts on install failure.
 *
 * Cleanup order (reverse of creation):
 * 1. bindings  (asset_bindings rows)
 * 2. assets    (installed_assets rows)
 * 3. employees (employees rows created by this install)
 * 4. package   (installed_packages row)
 */

import type { MaterializeResult } from './materializer.js';
import type { InstallRepositories } from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reverse the effects of a materialization.
 *
 * Deletes rows in reverse order of creation to respect foreign key constraints.
 * Errors during individual deletes are collected and logged, but the function
 * attempts to clean up as much as possible (best-effort).
 *
 * @param result - The MaterializeResult from a prior materialize() call.
 * @param repos - Install repositories with delete methods.
 */
export async function rollback(
  result: MaterializeResult,
  repos: InstallRepositories,
): Promise<void> {
  const errors: string[] = [];

  // 1. Delete bindings (created last during materialization)
  for (const id of result.bindingIds) {
    try {
      await repos.assetBindings.delete(id);
    } catch (err) {
      errors.push(
        `assetBindings.delete(${id}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2. Delete installed assets
  for (const id of result.installedAssetIds) {
    try {
      await repos.installedAssets.delete(id);
    } catch (err) {
      errors.push(
        `installedAssets.delete(${id}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 3. Delete employees created by this install
  for (const id of result.employeeIds) {
    try {
      await repos.employees.delete(id);
    } catch (err) {
      errors.push(`employees.delete(${id}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4. Delete the installed package record
  try {
    await repos.installedPackages.delete(result.installedPackageId);
  } catch (err) {
    errors.push(
      `installedPackages.delete(${result.installedPackageId}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (errors.length > 0) {
    console.warn('[install-core/rollback] Partial cleanup — some deletes failed:', errors);
  }
}
