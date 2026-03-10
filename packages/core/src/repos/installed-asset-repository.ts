import type { InstalledAssetRow } from '@aics/install-core';

export interface InstalledAssetRepository {
  create(asset: InstalledAssetRow): Promise<InstalledAssetRow>;
  /** Delete an installed asset by ID. Used during rollback. */
  delete(id: string): Promise<void>;
}
