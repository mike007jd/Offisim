/**
 * Tauri (desktop) implementation of `AttachmentStore` — calls the
 * `attachment_*` invoke commands defined in
 * `apps/desktop/src-tauri/src/attachment_store.rs`. Bytes cross JS↔Rust as
 * raw `Vec<u8>` (no base64 inflation).
 *
 * The Rust side enforces an 8 MB hard cap, sha256 verification, and atomic
 * writes; this adapter only translates types and maps typed errors into the
 * `AttachmentReadResult` discriminated union the consumer code expects.
 */
import { invoke } from '@tauri-apps/api/core';
import { isAttachmentKind, type AttachmentMeta, type VaultRef } from '@offisim/shared-types';
import type {
  AttachmentReadResult,
  AttachmentStore,
} from '@offisim/ui-office/web';

interface RustAttachmentMeta {
  attachmentId: string;
  companyId: string;
  threadId: string;
  filename: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
  createdAt: string;
  parsedRev: number;
  kind: string;
}

interface RustAttachmentReadPayload {
  meta: RustAttachmentMeta;
  bytes: Uint8Array | number[];
}

function bytesAsUint8Array(bytes: Uint8Array | number[] | ArrayBuffer): Uint8Array {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return Uint8Array.from(bytes);
}

function castMeta(m: RustAttachmentMeta): AttachmentMeta {
  return {
    ...m,
    kind: isAttachmentKind(m.kind) ? m.kind : 'other',
  } as AttachmentMeta;
}

function isAttachmentError(err: unknown, kind: string): boolean {
  if (!err) return false;
  if (typeof err === 'string') return err === kind;
  if (typeof err === 'object' && err !== null) {
    const k = (err as { kind?: unknown }).kind;
    return typeof k === 'string' && k === kind;
  }
  return false;
}

export class TauriAttachmentStore implements AttachmentStore {
  readonly storageAvailable = true;
  readonly idbAvailable = true;

  async write(meta: AttachmentMeta, bytes: Uint8Array): Promise<VaultRef> {
    const ref = await invoke<string>('attachment_write', {
      meta: meta as unknown as RustAttachmentMeta,
      bytes,
    });
    return ref as VaultRef;
  }

  async read(vaultRef: VaultRef, maxBytes?: number): Promise<AttachmentReadResult> {
    try {
      const payload = await invoke<RustAttachmentReadPayload>('attachment_read', {
        vaultRef,
        maxBytes: maxBytes ?? null,
      });
      return {
        kind: 'ok',
        meta: castMeta(payload.meta),
        bytes: bytesAsUint8Array(payload.bytes),
      };
    } catch (err) {
      if (isAttachmentError(err, 'attachment-not-found')) {
        return { kind: 'attachment-not-found', vaultRef };
      }
      if (isAttachmentError(err, 'attachment-corrupted')) {
        return { kind: 'attachment-corrupted', vaultRef };
      }
      throw err;
    }
  }

  async list(companyId: string, threadId: string): Promise<AttachmentMeta[]> {
    const metas = await invoke<RustAttachmentMeta[]>('attachment_list', {
      companyId,
      threadId,
    });
    return metas.map(castMeta);
  }

  async listAll(): Promise<AttachmentMeta[]> {
    const metas = await invoke<RustAttachmentMeta[]>('attachment_list_all');
    return metas.map(castMeta);
  }

  async delete(vaultRef: VaultRef): Promise<void> {
    await invoke('attachment_delete', { vaultRef });
  }

  async deleteByThread(companyId: string, threadId: string): Promise<VaultRef[]> {
    const metas = await this.list(companyId, threadId);
    const refs: VaultRef[] = metas.map(
      (m) => `attachment://${m.companyId}/${m.threadId}/${m.attachmentId}` as VaultRef,
    );
    for (const ref of refs) await this.delete(ref);
    return refs;
  }
}
