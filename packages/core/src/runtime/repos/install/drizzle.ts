import * as schema from '@offisim/db-local/dist/schema.js';
import type {
  AssetBindingRow,
  InstallTransactionRow,
  InstalledAssetRow,
  InstalledPackageRow,
} from '@offisim/install-core';
import type { BindingStatus, InstallState } from '@offisim/shared-types';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AssetBindingRepository } from '../../../repos/asset-binding-repository.js';
import type { InstallTransactionRepository } from '../../../repos/install-transaction-repository.js';
import type { InstalledAssetRepository } from '../../../repos/installed-asset-repository.js';
import type { InstalledPackageRepository } from '../../../repos/installed-package-repository.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export interface InstallDrizzleRepos {
  installTransactions: InstallTransactionRepository;
  installedPackages: InstalledPackageRepository;
  installedAssets: InstalledAssetRepository;
  assetBindings: AssetBindingRepository;
}

export function createInstallDrizzleRepos(db: Db): InstallDrizzleRepos {
  const installTransactions: InstallTransactionRepository = {
    async create(txn) {
      const row: InstallTransactionRow = { ...txn, finished_at: null };
      db.insert(schema.installTransactions).values(row).run();
      return row;
    },
    async findById(id) {
      const rows = db
        .select()
        .from(schema.installTransactions)
        .where(eq(schema.installTransactions.install_txn_id, id))
        .all();
      return (rows[0] as InstallTransactionRow | undefined) ?? null;
    },
    async updateState(id, state: InstallState, errorCode?: string, errorDetail?: string) {
      db.update(schema.installTransactions)
        .set({
          state,
          error_code: errorCode ?? undefined,
          error_detail: errorDetail ?? undefined,
        })
        .where(eq(schema.installTransactions.install_txn_id, id))
        .run();
    },
    async finish(id, state: InstallState) {
      db.update(schema.installTransactions)
        .set({ state, finished_at: now() })
        .where(eq(schema.installTransactions.install_txn_id, id))
        .run();
    },
  };

  const installedPackages: InstalledPackageRepository = {
    // NOTE: not `async` — see EmployeeRepository.create for rationale. Install
    // materializer runs all 4 create calls inside a sync transact() callback;
    // an async wrapper would capture sync throws into rejected promises that
    // void silently discards, defeating rollback.
    create(pkg) {
      db.insert(schema.installedPackages).values(pkg).run();
      return Promise.resolve(pkg as InstalledPackageRow);
    },
    async findByPackageId(companyId, packageId) {
      return db
        .select()
        .from(schema.installedPackages)
        .where(
          and(
            eq(schema.installedPackages.company_id, companyId),
            eq(schema.installedPackages.package_id, packageId),
          ),
        )
        .all() as InstalledPackageRow[];
    },
    async listByCompany(companyId) {
      return db
        .select()
        .from(schema.installedPackages)
        .where(eq(schema.installedPackages.company_id, companyId))
        .all() as InstalledPackageRow[];
    },
    async delete(id) {
      db.delete(schema.installedPackages)
        .where(eq(schema.installedPackages.installed_package_id, id))
        .run();
    },
  };

  const installedAssets: InstalledAssetRepository = {
    // NOTE: not `async` — see EmployeeRepository.create for rationale.
    create(asset) {
      db.insert(schema.installedAssets).values(asset).run();
      return Promise.resolve(asset as InstalledAssetRow);
    },
    async delete(id) {
      db.delete(schema.installedAssets)
        .where(eq(schema.installedAssets.installed_asset_id, id))
        .run();
    },
  };

  const assetBindings: AssetBindingRepository = {
    // NOTE: not `async` — see EmployeeRepository.create for rationale.
    create(binding) {
      db.insert(schema.assetBindings).values(binding).run();
      return Promise.resolve(binding as AssetBindingRow);
    },
    async findByTransaction(txnId) {
      return db
        .select()
        .from(schema.assetBindings)
        .where(eq(schema.assetBindings.install_txn_id, txnId))
        .all() as AssetBindingRow[];
    },
    async updateStatus(id, status: BindingStatus, valueJson?: string) {
      db.update(schema.assetBindings)
        .set({
          status,
          binding_value_json: valueJson ?? undefined,
          updated_at: now(),
        })
        .where(eq(schema.assetBindings.binding_id, id))
        .run();
    },
    async delete(id) {
      db.delete(schema.assetBindings).where(eq(schema.assetBindings.binding_id, id)).run();
    },
  };

  return { installTransactions, installedPackages, installedAssets, assetBindings };
}
