import type { InstallTransactionRow } from '@offisim/install-core';
import type { InstallState } from '@offisim/shared-types';

export interface InstallTransactionRepository {
  create(txn: Omit<InstallTransactionRow, 'finished_at'>): Promise<InstallTransactionRow>;
  findById(id: string): Promise<InstallTransactionRow | null>;
  updateState(
    id: string,
    state: InstallState,
    errorCode?: string,
    errorDetail?: string,
  ): Promise<void>;
  finish(id: string, state: InstallState): Promise<void>;
}
