/**
 * Rollback — reverse materialization artifacts on install failure.
 *
 * Deletes run in reverse creation order (bindings → assets → employees → package)
 * to respect foreign key constraints. Within each type deletes run in parallel.
 * Individual failures are collected and logged (best-effort cleanup).
 */

import type { MaterializeResult } from './materializer.js';
import type { InstallRepositories } from './types.js';

function formatError(label: string, err: unknown): string {
  return `${label}: ${err instanceof Error ? err.message : String(err)}`;
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

export async function rollback(
  result: MaterializeResult,
  repos: InstallRepositories,
): Promise<void> {
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

  const sopResults = await Promise.allSettled(
    (result.sopTemplateIds ?? []).map((id) => repos.sopTemplates?.delete(id)),
  );
  collectErrors(
    sopResults,
    result.sopTemplateIds ?? [],
    (id) => `sopTemplates.delete(${id})`,
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
}
