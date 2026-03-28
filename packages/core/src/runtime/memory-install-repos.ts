import type {
  AssetBindingRow,
  InstallTransactionRow,
  InstalledAssetRow,
  InstalledPackageRow,
} from '@offisim/install-core';
import type { BindingStatus, InstallState } from '@offisim/shared-types';
import type { AssetBindingRepository } from '../repos/asset-binding-repository.js';
import type { InstallTransactionRepository } from '../repos/install-transaction-repository.js';
import type { InstalledAssetRepository } from '../repos/installed-asset-repository.js';
import type { InstalledPackageRepository } from '../repos/installed-package-repository.js';

function now(): string {
  return new Date().toISOString();
}

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

  async create(txn: Omit<InstallTransactionRow, 'finished_at'>): Promise<InstallTransactionRow> {
    const row: InstallTransactionRow = { ...txn, finished_at: null };
    this.store.set(row.install_txn_id, row);
    return row;
  }

  async findById(id: string): Promise<InstallTransactionRow | null> {
    return this.store.get(id) ?? null;
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
    return [...this.store.values()].map((row) => ({ ...row }));
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

  async create(pkg: InstalledPackageRow): Promise<InstalledPackageRow> {
    this.store.set(pkg.installed_package_id, pkg);
    return pkg;
  }

  async findByPackageId(companyId: string, packageId: string): Promise<InstalledPackageRow[]> {
    return [...this.store.values()].filter(
      (p) => p.company_id === companyId && p.package_id === packageId,
    );
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  snapshot(): InstalledPackageRow[] {
    return [...this.store.values()].map((row) => ({ ...row }));
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

  async create(asset: InstalledAssetRow): Promise<InstalledAssetRow> {
    this.store.set(asset.installed_asset_id, asset);
    return asset;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  snapshot(): InstalledAssetRow[] {
    return [...this.store.values()].map((row) => ({ ...row }));
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

  async create(binding: AssetBindingRow): Promise<AssetBindingRow> {
    this.store.set(binding.binding_id, binding);
    return binding;
  }

  async findByTransaction(txnId: string): Promise<AssetBindingRow[]> {
    return [...this.store.values()].filter((b) => b.install_txn_id === txnId);
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
    return [...this.store.values()].map((row) => ({ ...row }));
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
