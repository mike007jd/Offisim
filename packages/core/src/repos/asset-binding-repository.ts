import type { AssetBindingRow } from '@offisim/install-core';
import type { BindingStatus } from '@offisim/shared-types';

export interface AssetBindingRepository {
  create(binding: AssetBindingRow): Promise<AssetBindingRow>;
  findByTransaction(txnId: string): Promise<AssetBindingRow[]>;
  updateStatus(id: string, status: BindingStatus, valueJson?: string): Promise<void>;
  /** Delete a binding by ID. Used during rollback. */
  delete(id: string): Promise<void>;
}
