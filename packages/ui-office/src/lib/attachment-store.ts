/**
 * Cross-platform contract for the chat attachment store. Two implementations
 * live in `apps/web/src/lib/`:
 *
 * - `WebAttachmentStore` — IndexedDB blobs (`offisim-chat-attachments`)
 * - `TauriAttachmentStore` — Rust-side `attachment_*` IPC commands
 *
 * Runtime context wires the platform-correct instance via
 * `OffisimRuntimeValue.attachmentStore` so chat composer, send pipeline, GC
 * sweeper, and the gateway-lane `read_attachment` tool all share one instance.
 */
import type { AttachmentMeta, VaultRef } from '@offisim/shared-types';

export type AttachmentReadResult =
  | { kind: 'ok'; meta: AttachmentMeta; bytes: Uint8Array }
  | { kind: 'attachment-not-found'; vaultRef: VaultRef }
  | { kind: 'attachment-corrupted'; vaultRef: VaultRef };

/**
 * Legacy repository slice from the first attachment-store draft. Runtime code
 * now installs cascades around the real repos instead of putting project /
 * company deletion logic inside store implementations.
 */
export interface AttachmentRepoEnumerator {
  threadsByProject(companyId: string, projectId: string): Promise<readonly string[]>;
  threadsByCompany(companyId: string): Promise<readonly string[]>;
}

export interface AttachmentStore {
  /** Persist `bytes` under the meta-derived `vaultRef`. */
  write(meta: AttachmentMeta, bytes: Uint8Array): Promise<VaultRef>;
  /** Read by ref. Never throws — typed result for missing / corrupt rows. */
  read(vaultRef: VaultRef, maxBytes?: number): Promise<AttachmentReadResult>;
  /** List metadata under `(companyId, threadId)`. Returns [] when nothing is stored. */
  list(companyId: string, threadId: string): Promise<AttachmentMeta[]>;
  /** Enumerate every persisted attachment — used by the boot-time GC sweeper. */
  listAll(): Promise<AttachmentMeta[]>;
  /** Idempotent delete by ref. */
  delete(vaultRef: VaultRef): Promise<void>;
  /** Cascade delete every blob under `(companyId, threadId)`; returns the deleted refs. */
  deleteByThread(companyId: string, threadId: string): Promise<VaultRef[]>;
  /**
   * Whether persistence is reachable on this device. Web returns `false` in
   * private browsing when IndexedDB.open fails; desktop always returns `true`.
   */
  readonly storageAvailable: boolean;
  /** @deprecated Use `storageAvailable`; retained for old callers during the transition. */
  readonly idbAvailable: boolean;
}

/**
 * Shared cascade helper — both backends route project/company deletes through
 * per-thread deletion; this lifts the loop out of the store implementations.
 */
export async function cascadeDeleteByThreads(
  store: AttachmentStore,
  companyId: string,
  threadIds: readonly string[],
): Promise<VaultRef[]> {
  const acc: VaultRef[] = [];
  for (const tid of threadIds) {
    const dropped = await store.deleteByThread(companyId, tid);
    acc.push(...dropped);
  }
  return acc;
}
