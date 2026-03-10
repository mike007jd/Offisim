import type { AssetBindingRow } from '@aics/install-core';
import type { BindingStatus } from '@aics/shared-types';

export interface AssetBindingRepository {
  create(binding: AssetBindingRow): Promise<AssetBindingRow>;
  findByTransaction(txnId: string): Promise<AssetBindingRow[]>;
  updateStatus(id: string, status: BindingStatus, valueJson?: string): Promise<void>;
  /** Delete a binding by ID. Used during rollback. */
  delete(id: string): Promise<void>;
}
