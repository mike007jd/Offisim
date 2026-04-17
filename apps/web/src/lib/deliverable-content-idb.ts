/**
 * IndexedDB-backed store for deliverable content bodies.
 *
 * H1 archived the deliverable-persistence change where content was inlined in
 * the main `offisim:browser-runtime-snapshot:v1` localStorage blob. That blew
 * the ~5–10 MB per-origin quota once a session collected N deliverables with
 * real content. This module holds the content bytes in IDB instead, keyed by
 * `deliverable_id`. The localStorage snapshot keeps only summary metadata.
 */

const DB_NAME = 'offisim-runtime';
const DB_VERSION = 1;
const STORE_NAME = 'deliverable_content';

let warnedUnavailable = false;

function warnUnavailableOnce(reason: unknown): void {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  console.warn(
    '[deliverable-content-idb] IndexedDB unavailable — deliverable content will not persist across reloads.',
    reason,
  );
}

function toPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
  });
}

function awaitTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
  });
}

export function openDeliverableContentDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    warnUnavailableOnce('indexedDB global is undefined');
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      warnUnavailableOnce(err);
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      warnUnavailableOnce(request.error);
      resolve(null);
    };
    request.onblocked = () => {
      warnUnavailableOnce('indexedDB open blocked');
      resolve(null);
    };
  });
}

export async function putDeliverableContent(
  db: IDBDatabase,
  deliverableId: string,
  content: string,
): Promise<void> {
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(content, deliverableId);
  await awaitTransaction(tx);
}

export async function getDeliverableContent(
  db: IDBDatabase,
  deliverableId: string,
): Promise<string | null> {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const result = await toPromise<unknown>(tx.objectStore(STORE_NAME).get(deliverableId));
  await awaitTransaction(tx);
  return typeof result === 'string' ? result : null;
}

export async function deleteDeliverableContent(
  db: IDBDatabase,
  deliverableId: string,
): Promise<void> {
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(deliverableId);
  await awaitTransaction(tx);
}

export async function listDeliverableContentKeys(db: IDBDatabase): Promise<string[]> {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const keys = await toPromise<IDBValidKey[]>(tx.objectStore(STORE_NAME).getAllKeys());
  await awaitTransaction(tx);
  return keys.filter((k): k is string => typeof k === 'string');
}
