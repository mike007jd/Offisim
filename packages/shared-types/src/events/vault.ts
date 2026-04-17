export interface VaultSyncFailedPayload {
  readonly employeeId: string;
  readonly reason: string;
  readonly target: 'write' | 'import' | 'delete' | 'activate';
}
