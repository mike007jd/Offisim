import type { InstalledAssetRow } from '@aics/install-core';

export interface InstalledAssetRepository {
  create(asset: InstalledAssetRow): Promise<InstalledAssetRow>;
}
