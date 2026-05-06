/**
 * Web (IndexedDB) implementation of `AttachmentStore`. Store `blobs` keeps
 * bytes keyed by `vaultRef`; store `metas` keeps metadata-only rows so GC does
 * not pull Blob payloads into JS heap. Handles private-browsing crippled IDB
 * by exposing `storageAvailable=false` instead of throwing mid-staging.
 *
 * Eviction path: a `read()` call that finds no row for an embedded ref returns
 * `{ kind: 'attachment-not-found' }` and emits `chat.attachment.evicted` so the
 * bubble can flip its chip into the `[evicted]` variant — no surprise
 * exceptions in the message render path.
 */
import { idbRequestToPromise, idbTransactionDone } from '@offisim/core/browser';
import type { EventBus } from '@offisim/core/browser';
import type { AttachmentMeta, ChatAttachmentEvictedPayload, VaultRef } from '@offisim/shared-types';
import {
  CHAT_ATTACHMENT_EVICTED,
  CHAT_ATTACHMENT_MAX_BYTES,
  chatAttachmentEvent,
  parseVaultRef,
} from '@offisim/shared-types';
import type { AttachmentReadResult, AttachmentStore } from '@offisim/ui-office/web';

const DB_NAME = 'offisim-chat-attachments';
const DB_VERSION = 2;
const STORE_NAME = 'blobs';
const META_STORE_NAME = 'metas';

interface BlobRow {
  bytes: Blob;
  meta: AttachmentMeta;
}

let cachedAvailability: boolean | null = null;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      let blobStore: IDBObjectStore | null = null;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        blobStore = db.createObjectStore(STORE_NAME);
      } else {
        blobStore = tx?.objectStore(STORE_NAME) ?? null;
      }
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME);
      }
      if (event.oldVersion < 2 && blobStore && tx) {
        const metaStore = tx.objectStore(META_STORE_NAME);
        const cursorReq = blobStore.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const row = cursor.value as Partial<BlobRow> | undefined;
          if (row?.meta) metaStore.put(row.meta, cursor.key);
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function probeAvailability(): Promise<boolean> {
  if (cachedAvailability !== null) return cachedAvailability;
  const db = await open();
  if (!db) {
    // Do not permanently cache failures. A blocked IndexedDB open can happen
    // while another app tab still holds an older connection; future runtime
    // initialization or reload should be allowed to recover once it closes.
    return false;
  }
  cachedAvailability = true;
  db.close();
  return true;
}

function emitEvictedEvent(
  eventBus: EventBus | null,
  meta: AttachmentMeta | null,
  vaultRef: VaultRef,
): void {
  if (!eventBus) return;
  const parsed = parseVaultRef(vaultRef);
  const companyId = meta?.companyId ?? (parsed.kind === 'ok' ? parsed.companyId : '');
  const threadId = meta?.threadId ?? (parsed.kind === 'ok' ? parsed.threadId : '');
  const attachmentId = meta?.attachmentId ?? (parsed.kind === 'ok' ? parsed.attachmentId : '');
  const payload: ChatAttachmentEvictedPayload = {
    attachmentId,
    threadId,
    vaultRef,
    filename: meta?.filename ?? '',
    source: 'web-idb',
  };
  eventBus.emit(
    chatAttachmentEvent(
      CHAT_ATTACHMENT_EVICTED,
      { entityId: attachmentId || vaultRef, companyId, threadId },
      payload,
    ),
  );
}

export class WebAttachmentStore implements AttachmentStore {
  readonly storageAvailable: boolean;
  readonly idbAvailable: boolean;

  constructor(
    private readonly eventBus: EventBus | null,
    idbAvailable: boolean,
  ) {
    this.storageAvailable = idbAvailable;
    this.idbAvailable = idbAvailable;
  }

  static async create(eventBus: EventBus | null): Promise<WebAttachmentStore> {
    const available = await probeAvailability();
    return new WebAttachmentStore(eventBus, available);
  }

  private async db(): Promise<IDBDatabase> {
    const db = await open();
    if (!db) throw new Error('attachment-store-unavailable');
    return db;
  }

  async write(meta: AttachmentMeta, bytes: Uint8Array): Promise<VaultRef> {
    if (bytes.length > CHAT_ATTACHMENT_MAX_BYTES) {
      throw new Error('attachment-too-large');
    }
    if (meta.byteLength !== bytes.length) {
      throw new Error('attachment-meta-mismatch');
    }
    const db = await this.db();
    try {
      const vaultRef =
        `attachment://${meta.companyId}/${meta.threadId}/${meta.attachmentId}` as VaultRef;
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: meta.mimeType });
      const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
      tx.objectStore(STORE_NAME).put({ bytes: blob, meta } satisfies BlobRow, vaultRef);
      tx.objectStore(META_STORE_NAME).put(meta, vaultRef);
      await idbTransactionDone(tx);
      return vaultRef;
    } finally {
      db.close();
    }
  }

  async read(vaultRef: VaultRef, maxBytes?: number): Promise<AttachmentReadResult> {
    const db = await this.db();
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const row = (await idbRequestToPromise<unknown>(tx.objectStore(STORE_NAME).get(vaultRef))) as
        | BlobRow
        | undefined;
      await idbTransactionDone(tx);
      if (!row) {
        emitEvictedEvent(this.eventBus, null, vaultRef);
        return { kind: 'attachment-not-found', vaultRef };
      }
      const cap = Math.min(
        typeof maxBytes === 'number' && maxBytes > 0 ? maxBytes : CHAT_ATTACHMENT_MAX_BYTES,
        CHAT_ATTACHMENT_MAX_BYTES,
      );
      const blob = row.bytes.slice(0, cap);
      const buf = new Uint8Array(await blob.arrayBuffer());
      return { kind: 'ok', meta: row.meta, bytes: buf };
    } finally {
      db.close();
    }
  }

  async list(companyId: string, threadId: string): Promise<AttachmentMeta[]> {
    const all = await this.listAll();
    return all
      .filter((m) => m.companyId === companyId && m.threadId === threadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listAll(): Promise<AttachmentMeta[]> {
    const db = await this.db();
    try {
      const tx = db.transaction(META_STORE_NAME, 'readonly');
      const rows = (await idbRequestToPromise<unknown[]>(
        tx.objectStore(META_STORE_NAME).getAll(),
      )) as AttachmentMeta[];
      await idbTransactionDone(tx);
      return rows;
    } finally {
      db.close();
    }
  }

  async delete(vaultRef: VaultRef): Promise<void> {
    const db = await this.db();
    try {
      const tx = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
      tx.objectStore(STORE_NAME).delete(vaultRef);
      tx.objectStore(META_STORE_NAME).delete(vaultRef);
      await idbTransactionDone(tx);
    } finally {
      db.close();
    }
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
