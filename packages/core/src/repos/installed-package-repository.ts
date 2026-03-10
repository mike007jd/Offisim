import type { InstalledPackageRow } from '@aics/install-core';

export interface InstalledPackageRepository {
  create(pkg: InstalledPackageRow): Promise<InstalledPackageRow>;
  findByPackageId(companyId: string, packageId: string): Promise<InstalledPackageRow[]>;
  /** Delete an installed package by ID. Used during rollback. */
  delete(id: string): Promise<void>;
}
