import type {
  AssetBindingRow,
  InstallTransactionRow,
  InstalledAssetRow,
  InstalledPackageRow,
} from '@offisim/install-core';
import type { BindingStatus, InstallState } from '@offisim/shared-types';
import type { AssetBindingRepository } from '../../../repos/asset-binding-repository.js';
import type { InstallTransactionRepository } from '../../../repos/install-transaction-repository.js';
import type { InstalledAssetRepository } from '../../../repos/installed-asset-repository.js';
import type { InstalledPackageRepository } from '../../../repos/installed-package-repository.js';
import { cloneRows, now } from '../memory-utils.js';

export interface MemoryInstallRepositoriesSnapshot {
  installTransactions: InstallTransactionRow[];
  installedPackages: InstalledPackageRow[];
  installedAssets: InstalledAssetRow[];
  assetBindings: AssetBindingRow[];
}

export class MemoryInstallTransactionRepository implements InstallTransactionRepository {
  private store = new Map<string, InstallTransactionRow>();

  constructor(initialRows?: Iterable<InstallTransactionRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.install_txn_id, { ...row });
    }
  }

  // NOTE: async here is safe ONLY because the memory backend never participates
  // in a sync transact() (it offers an asyncTransact passthrough instead). The
  // drizzle install repos deliberately keep create() non-async for the opposite
  // reason — see the NOTE in repos/install/drizzle.ts. This asymmetry is intentional.
  async create(txn: Omit<InstallTransactionRow, 'finished_at'>): Promise<InstallTransactionRow> {
    if (txn.idempotency_key) {
      const duplicate = [...this.store.values()].find(
        (row) =>
          row.company_id === txn.company_id &&
          row.idempotency_key === txn.idempotency_key &&
          row.state !== 'failed' &&
          row.state !== 'rolled_back' &&
          row.state !== 'cancelled',
      );
      if (duplicate) {
        throw new Error(`Duplicate install transaction idempotency key '${txn.idempotency_key}'`);
      }
    }
    const row: InstallTransactionRow = { ...txn, finished_at: null };
    this.store.set(row.install_txn_id, row);
    return { ...row };
  }

  async findById(id: string): Promise<InstallTransactionRow | null> {
    const row = this.store.get(id);
    return row ? { ...row } : null;
  }

  async findByIdempotencyKey(
    companyId: string,
    idempotencyKey: string,
  ): Promise<InstallTransactionRow | null> {
    // Mirror the drizzle ordering (desc started_at, take 1) so both backends
    // deterministically resolve the same row when multiple active rows share the key.
    const row =
      [...this.store.values()]
        .filter(
          (r) =>
            r.company_id === companyId &&
            r.idempotency_key === idempotencyKey &&
            r.state !== 'failed' &&
            r.state !== 'rolled_back' &&
            r.state !== 'cancelled',
        )
        .sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null;
    return row ? { ...row } : null;
  }

  async updateState(
    id: string,
    state: InstallState,
    errorCode?: string,
    errorDetail?: string,
  ): Promise<void> {
    const row = this.store.get(id);
    if (row) {
      this.store.set(id, {
        ...row,
        state,
        error_code: errorCode ?? row.error_code,
        error_detail: errorDetail ?? row.error_detail,
      });
    }
  }

  async finish(id: string, state: InstallState): Promise<void> {
    const row = this.store.get(id);
    if (row) {
      this.store.set(id, { ...row, state, finished_at: now() });
    }
  }

  snapshot(): InstallTransactionRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemoryInstalledPackageRepository implements InstalledPackageRepository {
  private store = new Map<string, InstalledPackageRow>();

  constructor(initialRows?: Iterable<InstalledPackageRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.installed_package_id, { ...row });
    }
  }

  // NOTE: async here is safe ONLY because the memory backend never participates
  // in a sync transact() (asyncTransact passthrough) — see the NOTE in
  // repos/install/drizzle.ts for the inverse non-async constraint.
  async create(pkg: InstalledPackageRow): Promise<InstalledPackageRow> {
    const r = { ...pkg };
    this.store.set(r.installed_package_id, r);
    return { ...r };
  }

  async findByPackageId(companyId: string, packageId: string): Promise<InstalledPackageRow[]> {
    return cloneRows(
      [...this.store.values()].filter(
        (p) => p.company_id === companyId && p.package_id === packageId,
      ),
    );
  }

  async listByCompany(companyId: string): Promise<InstalledPackageRow[]> {
    return cloneRows([...this.store.values()].filter((p) => p.company_id === companyId));
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  snapshot(): InstalledPackageRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemoryInstalledAssetRepository implements InstalledAssetRepository {
  private store = new Map<string, InstalledAssetRow>();

  constructor(initialRows?: Iterable<InstalledAssetRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.installed_asset_id, { ...row });
    }
  }

  // NOTE: async here is safe ONLY because the memory backend never participates
  // in a sync transact() (asyncTransact passthrough) — see the NOTE in
  // repos/install/drizzle.ts for the inverse non-async constraint.
  async create(asset: InstalledAssetRow): Promise<InstalledAssetRow> {
    const r = { ...asset };
    this.store.set(r.installed_asset_id, r);
    return { ...r };
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  snapshot(): InstalledAssetRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemoryAssetBindingRepository implements AssetBindingRepository {
  private store = new Map<string, AssetBindingRow>();

  constructor(initialRows?: Iterable<AssetBindingRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.binding_id, { ...row });
    }
  }

  // NOTE: async here is safe ONLY because the memory backend never participates
  // in a sync transact() (asyncTransact passthrough) — see the NOTE in
  // repos/install/drizzle.ts for the inverse non-async constraint.
  async create(binding: AssetBindingRow): Promise<AssetBindingRow> {
    const r = { ...binding };
    this.store.set(r.binding_id, r);
    return { ...r };
  }

  async findByTransaction(txnId: string): Promise<AssetBindingRow[]> {
    return cloneRows([...this.store.values()].filter((b) => b.install_txn_id === txnId));
  }

  async updateStatus(id: string, status: BindingStatus, valueJson?: string): Promise<void> {
    const row = this.store.get(id);
    if (row) {
      this.store.set(id, {
        ...row,
        status,
        binding_value_json: valueJson ?? row.binding_value_json,
        updated_at: now(),
      });
    }
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  snapshot(): AssetBindingRow[] {
    return cloneRows(this.store.values());
  }
}

export function createMemoryInstallRepositories(
  snapshot?: Partial<MemoryInstallRepositoriesSnapshot>,
): {
  installTransactions: MemoryInstallTransactionRepository;
  installedPackages: MemoryInstalledPackageRepository;
  installedAssets: MemoryInstalledAssetRepository;
  assetBindings: MemoryAssetBindingRepository;
} {
  return {
    installTransactions: new MemoryInstallTransactionRepository(snapshot?.installTransactions),
    installedPackages: new MemoryInstalledPackageRepository(snapshot?.installedPackages),
    installedAssets: new MemoryInstalledAssetRepository(snapshot?.installedAssets),
    assetBindings: new MemoryAssetBindingRepository(snapshot?.assetBindings),
  };
}
