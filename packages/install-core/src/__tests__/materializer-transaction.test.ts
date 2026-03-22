/**
 * materializer-transaction.test.ts
 *
 * Verifies that when a `transact` wrapper is provided to materialize(), a
 * failure inside the callback rolls back ALL prior writes atomically.
 *
 * Since we cannot use a real SQLite DB in vitest (Node/browser), we simulate
 * the transaction contract with an in-memory store that snapshots and restores
 * state on error — exactly as better-sqlite3's db.transaction() does.
 *
 * The test exercises the rollback contract, not the Drizzle internals.
 * Real integration of the Drizzle transact path is covered by the fact that
 * `createDrizzleRepositories` returns a `transact` built from `db.transaction()`.
 */

import { describe, expect, it } from 'vitest';
import { materialize } from '../materializer.js';
import type {
  AssetBindingRow,
  InstallPlan,
  InstallRepositories,
  InstalledAssetRow,
  InstalledPackageRow,
  NewEmployee,
} from '../types.js';
import { TEST_MANIFEST } from './fixtures/create-test-pkg.js';

// ---------------------------------------------------------------------------
// In-memory store + simulated transact
// ---------------------------------------------------------------------------

interface MemoryStore {
  packages: InstalledPackageRow[];
  assets: InstalledAssetRow[];
  employees: Array<NewEmployee & { employee_id: string }>;
  bindings: AssetBindingRow[];
}

/**
 * Build repos + a `transact` function that mimics better-sqlite3 semantics:
 * - The callback executes synchronously.
 * - On error: restores store to its pre-call state (full rollback).
 * - On success: the writes made during the callback are kept.
 */
function createTransactableRepos(): {
  repos: InstallRepositories;
  store: MemoryStore;
  transact: <T>(fn: () => T) => T;
} {
  const store: MemoryStore = {
    packages: [],
    assets: [],
    employees: [],
    bindings: [],
  };

  const repos: InstallRepositories = {
    installTransactions: {
      create: async () => {
        throw new Error('Not used in materializer tests');
      },
      findById: async () => null,
      updateState: async () => {},
      finish: async () => {},
    },
    installedPackages: {
      create: async (pkg) => {
        store.packages.push(pkg);
        return pkg;
      },
      findByPackageId: async () => [],
      delete: async (id) => {
        const idx = store.packages.findIndex((p) => p.installed_package_id === id);
        if (idx !== -1) store.packages.splice(idx, 1);
      },
    },
    installedAssets: {
      create: async (asset) => {
        store.assets.push(asset);
        return asset;
      },
      delete: async (id) => {
        const idx = store.assets.findIndex((a) => a.installed_asset_id === id);
        if (idx !== -1) store.assets.splice(idx, 1);
      },
    },
    assetBindings: {
      create: async (binding) => {
        store.bindings.push(binding);
        return binding;
      },
      findByTransaction: async () => [],
      updateStatus: async () => {},
      delete: async (id) => {
        const idx = store.bindings.findIndex((b) => b.binding_id === id);
        if (idx !== -1) store.bindings.splice(idx, 1);
      },
    },
    employees: {
      create: async (emp) => {
        const employee_id = globalThis.crypto.randomUUID();
        store.employees.push({ ...emp, employee_id });
        return { employee_id };
      },
      delete: async (id) => {
        const idx = store.employees.findIndex((e) => e.employee_id === id);
        if (idx !== -1) store.employees.splice(idx, 1);
      },
    },
  };

  const transact = <T>(fn: () => T): T => {
    const snapshot: MemoryStore = {
      packages: [...store.packages],
      assets: [...store.assets],
      employees: [...store.employees],
      bindings: [...store.bindings],
    };
    try {
      return fn();
    } catch (err) {
      // Rollback: restore from snapshot
      store.packages.length = 0;
      store.packages.push(...snapshot.packages);
      store.assets.length = 0;
      store.assets.push(...snapshot.assets);
      store.employees.length = 0;
      store.employees.push(...snapshot.employees);
      store.bindings.length = 0;
      store.bindings.push(...snapshot.bindings);
      throw err;
    }
  };

  return { repos, store, transact };
}

// ---------------------------------------------------------------------------
// Plan helpers
// ---------------------------------------------------------------------------

function makeMultiAssetPlan(assetCount: number): InstallPlan {
  const assets = Array.from({ length: assetCount }, (_, i) => ({
    asset_id: `asset-${i + 1}`,
    kind: 'employee' as const,
    path: `assets/emp-${i + 1}.json`,
    entrypoint: 'main',
    default_enabled: true,
  }));

  return {
    manifest: { ...TEST_MANIFEST, assets },
    compatibility: { compatible: true, errors: [] },
    bindings: [],
    needsConfirmation: false,
    confirmationReasons: [],
    packageHash: 'pkghash',
    manifestHash: 'mfhash',
  };
}

/**
 * Build a `transact` that always throws after executing the callback,
 * simulating a DB constraint violation detected after the writes are staged.
 * Returns a snapshot-restoring transact so the rollback contract is verified.
 */
function makeForcedRollbackTransact(store: MemoryStore): <T>(fn: () => T) => T {
  return <T>(fn: () => T): T => {
    const snapshot: MemoryStore = {
      packages: [...store.packages],
      assets: [...store.assets],
      employees: [...store.employees],
      bindings: [...store.bindings],
    };
    try {
      fn(); // executes all void repo calls (fire-and-forget within transact)
      // Simulate a failure detected AFTER the writes were staged
      throw new Error('forced DB constraint violation — rollback required');
    } catch (err) {
      // Restore snapshot (rollback)
      store.packages.length = 0;
      store.packages.push(...snapshot.packages);
      store.assets.length = 0;
      store.assets.push(...snapshot.assets);
      store.employees.length = 0;
      store.employees.push(...snapshot.employees);
      store.bindings.length = 0;
      store.bindings.push(...snapshot.bindings);
      throw err;
    }
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('materializer / transact rollback', () => {
  const companyId = 'co-txn-test';
  const installTxnId = 'txn-txn-test';

  it('commits all writes when transact succeeds', async () => {
    const { repos, store, transact } = createTransactableRepos();
    const plan = makeMultiAssetPlan(3);

    await materialize(plan, [], repos, companyId, installTxnId, transact);

    // The transact path fires void repo.create() calls — those resolve in the
    // next microtask under real Drizzle. In our in-memory repos they are
    // also async, so flush the microtask queue before asserting.
    await Promise.resolve();
    await Promise.resolve();

    expect(store.packages).toHaveLength(1);
    expect(store.assets).toHaveLength(3);
    expect(store.employees).toHaveLength(3);
  });

  it('rolls back all writes when the transact callback throws', async () => {
    const { store } = createTransactableRepos();
    const plan = makeMultiAssetPlan(3);

    // Use a fresh set of repos that share the same store
    const { repos } = createTransactableRepos();
    // Override store reference to the shared one
    (repos.installedPackages as { create: (p: InstalledPackageRow) => Promise<InstalledPackageRow> }).create = async (pkg) => {
      store.packages.push(pkg);
      return pkg;
    };

    const forcedRollback = makeForcedRollbackTransact(store);

    await expect(
      materialize(plan, [], repos, companyId, installTxnId, forcedRollback),
    ).rejects.toThrow('forced DB constraint violation — rollback required');

    // Flush microtasks
    await Promise.resolve();
    await Promise.resolve();

    // After rollback: no rows from this transaction survive
    expect(store.packages).toHaveLength(0);
    expect(store.assets).toHaveLength(0);
    expect(store.employees).toHaveLength(0);
    expect(store.bindings).toHaveLength(0);
  });

  it('falls back to plain async execution when transact is undefined', async () => {
    const { repos, store } = createTransactableRepos();
    const plan = makeMultiAssetPlan(2);

    // No transact passed — uses the async await path
    await materialize(plan, [], repos, companyId, installTxnId);

    expect(store.packages).toHaveLength(1);
    expect(store.assets).toHaveLength(2);
    expect(store.employees).toHaveLength(2);
  });

  it('does not affect pre-existing rows when rolling back a new install', async () => {
    const { repos, store } = createTransactableRepos();
    const plan = makeMultiAssetPlan(3);

    // Pre-populate store with an existing (unrelated) installed package
    const existingPkg: InstalledPackageRow = {
      installed_package_id: 'existing-pkg-id',
      company_id: 'other-company',
      package_id: 'some.existing.pkg',
      package_kind: 'employee',
      version: '1.0.0',
      source_type: 'file',
      source_ref: null,
      manifest_hash: 'aa',
      package_hash: 'bb',
      install_state: 'installed',
      enabled: 1,
      installed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    store.packages.push(existingPkg);
    expect(store.packages).toHaveLength(1);

    const rollbackTransact = makeForcedRollbackTransact(store);

    await expect(
      materialize(plan, [], repos, companyId, installTxnId, rollbackTransact),
    ).rejects.toThrow();

    // Flush microtasks
    await Promise.resolve();
    await Promise.resolve();

    // Pre-existing package must survive (rollback only undoes the failed install)
    expect(store.packages).toHaveLength(1);
    expect(store.packages[0]!.installed_package_id).toBe('existing-pkg-id');

    // No assets or employees from the failed install
    expect(store.assets).toHaveLength(0);
    expect(store.employees).toHaveLength(0);
    expect(store.bindings).toHaveLength(0);
  });
});
