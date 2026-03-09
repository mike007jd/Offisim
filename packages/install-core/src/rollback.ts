/**
 * Rollback — reverse materialization artifacts on install failure.
 *
 * MVP stub: since InstallRepositories does not yet expose delete methods,
 * this implementation logs what WOULD be cleaned up and returns successfully.
 * A future phase will add actual deletion once repo delete methods exist.
 */

import type { InstallRepositories } from './types.js';
import type { MaterializeResult } from './materializer.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reverse the effects of a materialization.
 *
 * Cleanup order (reverse of creation):
 * 1. bindings  (asset_bindings rows)
 * 2. assets    (installed_assets rows)
 * 3. employees (employees rows created by this install)
 * 4. package   (installed_packages row)
 *
 * MVP: No-op stub — logs intended cleanup actions.
 * The repos don't expose delete methods yet, so we can't actually remove rows.
 *
 * @param result - The MaterializeResult from a prior materialize() call.
 * @param _repos - Install repositories (unused in MVP stub).
 */
export async function rollback(
  result: MaterializeResult,
  _repos: InstallRepositories,
): Promise<void> {
  // MVP: Log what would be cleaned up (no actual deletion)
  //
  // In production, this would:
  //   for (const id of result.bindingIds)   await repos.assetBindings.delete(id);
  //   for (const id of result.installedAssetIds) await repos.installedAssets.delete(id);
  //   for (const id of result.employeeIds)  await repos.employees.delete(id);
  //   await repos.installedPackages.delete(result.installedPackageId);

  if (typeof console !== 'undefined') {
    console.warn('[install-core/rollback] MVP stub — would clean up:', {
      installedPackageId: result.installedPackageId,
      installedAssetIds: result.installedAssetIds,
      employeeIds: result.employeeIds,
      bindingIds: result.bindingIds,
    });
  }
}
