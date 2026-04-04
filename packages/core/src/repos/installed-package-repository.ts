import type { InstalledPackageRow } from '@offisim/install-core';

export interface InstalledPackageRepository {
  create(pkg: InstalledPackageRow): Promise<InstalledPackageRow>;
  findByPackageId(companyId: string, packageId: string): Promise<InstalledPackageRow[]>;
  listByCompany(companyId: string): Promise<InstalledPackageRow[]>;
  /** Delete an installed package by ID. Used during rollback. */
  delete(id: string): Promise<void>;
}
