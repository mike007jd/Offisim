import type {
  AssetBindingRepository,
  InstallTransactionRepository,
  InstalledAssetRepository,
  InstalledPackageRepository,
} from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import type {
  AssetBindingRow,
  InstallTransactionRow,
  InstalledAssetRow,
  InstalledPackageRow,
} from '@offisim/install-core';
import type { BindingStatus, InstallState } from '@offisim/shared-types';
import { and, eq, notInArray } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

export interface InstallTauriRepos {
  installTransactions: InstallTransactionRepository;
  installedPackages: InstalledPackageRepository & {
    listByCompany(companyId: string): Promise<InstalledPackageRow[]>;
  };
  installedAssets: InstalledAssetRepository;
  assetBindings: AssetBindingRepository;
}

export function createInstallTauriRepos(db: TauriDrizzleDb): InstallTauriRepos {
  const installTransactions: InstallTransactionRepository = {
    async create(txn) {
      const row: InstallTransactionRow = { ...txn, finished_at: null };
      await db.insert(schema.installTransactions).values(row);
      return row;
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(schema.installTransactions)
        .where(eq(schema.installTransactions.install_txn_id, id));
      return (rows[0] as InstallTransactionRow | undefined) ?? null;
    },
    async findByIdempotencyKey(companyId, idempotencyKey) {
      const rows = await db
        .select()
        .from(schema.installTransactions)
        .where(
          and(
            eq(schema.installTransactions.company_id, companyId),
            eq(schema.installTransactions.idempotency_key, idempotencyKey),
            notInArray(schema.installTransactions.state, ['failed', 'rolled_back', 'cancelled']),
          ),
        );
      return (rows[0] as InstallTransactionRow | undefined) ?? null;
    },
    async updateState(id, state: InstallState, errorCode?: string, errorDetail?: string) {
      await db
        .update(schema.installTransactions)
        .set({
          state,
          error_code: errorCode ?? undefined,
          error_detail: errorDetail ?? undefined,
        })
        .where(eq(schema.installTransactions.install_txn_id, id));
    },
    async finish(id, state: InstallState) {
      await db
        .update(schema.installTransactions)
        .set({ state, finished_at: now() })
        .where(eq(schema.installTransactions.install_txn_id, id));
    },
  };

  const installedPackages: InstalledPackageRepository & {
    listByCompany(companyId: string): Promise<InstalledPackageRow[]>;
  } = {
    async create(pkg) {
      await db.insert(schema.installedPackages).values(pkg);
      return pkg as InstalledPackageRow;
    },
    async findByPackageId(companyId, packageId) {
      return (await db
        .select()
        .from(schema.installedPackages)
        .where(
          and(
            eq(schema.installedPackages.company_id, companyId),
            eq(schema.installedPackages.package_id, packageId),
          ),
        )) as InstalledPackageRow[];
    },
    async listByCompany(companyId: string) {
      return (await db
        .select()
        .from(schema.installedPackages)
        .where(eq(schema.installedPackages.company_id, companyId))) as InstalledPackageRow[];
    },
    async delete(id) {
      await db
        .delete(schema.installedPackages)
        .where(eq(schema.installedPackages.installed_package_id, id));
    },
  };

  const installedAssets: InstalledAssetRepository = {
    async create(asset) {
      await db.insert(schema.installedAssets).values(asset);
      return asset as InstalledAssetRow;
    },
    async delete(id) {
      await db
        .delete(schema.installedAssets)
        .where(eq(schema.installedAssets.installed_asset_id, id));
    },
  };

  const assetBindings: AssetBindingRepository = {
    async create(binding) {
      await db.insert(schema.assetBindings).values(binding);
      return binding as AssetBindingRow;
    },
    async findByTransaction(txnId) {
      return (await db
        .select()
        .from(schema.assetBindings)
        .where(eq(schema.assetBindings.install_txn_id, txnId))) as AssetBindingRow[];
    },
    async updateStatus(id, status: BindingStatus, valueJson?: string) {
      await db
        .update(schema.assetBindings)
        .set({
          status,
          binding_value_json: valueJson ?? undefined,
          updated_at: now(),
        })
        .where(eq(schema.assetBindings.binding_id, id));
    },
    async delete(id) {
      await db.delete(schema.assetBindings).where(eq(schema.assetBindings.binding_id, id));
    },
  };

  return { installTransactions, installedPackages, installedAssets, assetBindings };
}
