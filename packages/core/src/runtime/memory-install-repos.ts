import type { AssetBindingRow, InstallTransactionRow, InstalledAssetRow, InstalledPackageRow } from '@aics/install-core';
import type { BindingStatus, InstallState } from '@aics/shared-types';
import type { AssetBindingRepository } from '../repos/asset-binding-repository.js';
import type { InstallTransactionRepository } from '../repos/install-transaction-repository.js';
import type { InstalledAssetRepository } from '../repos/installed-asset-repository.js';
import type { InstalledPackageRepository } from '../repos/installed-package-repository.js';

function now(): string {
  return new Date().toISOString();
}

export class MemoryInstallTransactionRepository implements InstallTransactionRepository {
  private store = new Map<string, InstallTransactionRow>();

  async create(txn: Omit<InstallTransactionRow, 'finished_at'>): Promise<InstallTransactionRow> {
    const row: InstallTransactionRow = { ...txn, finished_at: null };
    this.store.set(row.install_txn_id, row);
    return row;
  }

  async findById(id: string): Promise<InstallTransactionRow | null> {
    return this.store.get(id) ?? null;
  }

  async updateState(id: string, state: InstallState, errorCode?: string, errorDetail?: string): Promise<void> {
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
}

export class MemoryInstalledPackageRepository implements InstalledPackageRepository {
  private store = new Map<string, InstalledPackageRow>();

  async create(pkg: InstalledPackageRow): Promise<InstalledPackageRow> {
    this.store.set(pkg.installed_package_id, pkg);
    return pkg;
  }

  async findByPackageId(companyId: string, packageId: string): Promise<InstalledPackageRow[]> {
    return [...this.store.values()].filter(
      (p) => p.company_id === companyId && p.package_id === packageId,
    );
  }
}

export class MemoryInstalledAssetRepository implements InstalledAssetRepository {
  private store = new Map<string, InstalledAssetRow>();

  async create(asset: InstalledAssetRow): Promise<InstalledAssetRow> {
    this.store.set(asset.installed_asset_id, asset);
    return asset;
  }
}

export class MemoryAssetBindingRepository implements AssetBindingRepository {
  private store = new Map<string, AssetBindingRow>();

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
}

export function createMemoryInstallRepositories(): {
  installTransactions: MemoryInstallTransactionRepository;
  installedPackages: MemoryInstalledPackageRepository;
  installedAssets: MemoryInstalledAssetRepository;
  assetBindings: MemoryAssetBindingRepository;
} {
  return {
    installTransactions: new MemoryInstallTransactionRepository(),
    installedPackages: new MemoryInstalledPackageRepository(),
    installedAssets: new MemoryInstalledAssetRepository(),
    assetBindings: new MemoryAssetBindingRepository(),
  };
}
