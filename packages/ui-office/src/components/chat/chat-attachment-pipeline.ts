/**
 * Send-pipeline glue between the composer staging surface and the platform
 * `AttachmentStore`. Splits out so `ChatPanel.handleSend` stays readable.
 */
import type { EventBus } from '@offisim/core/browser';
import {
  CURRENT_PARSED_REV,
  CHAT_ATTACHMENT_PERSISTED,
  type ChatAttachmentPersistedPayload,
  type ChatAttachmentRef,
  type StagedAttachment,
  type VaultRef,
  chatAttachmentEvent,
} from '@offisim/shared-types';
import type { AttachmentStore } from '../../lib/attachment-store.js';

export interface PersistStagedOptions {
  staged: StagedAttachment[];
  companyId: string;
  threadId: string;
  attachmentStore: AttachmentStore;
  eventBus: EventBus | null;
}

function refFromStaged(s: StagedAttachment, vaultRef: VaultRef): ChatAttachmentRef {
  return {
    attachmentId: s.attachmentId,
    vaultRef,
    filename: s.filename,
    mimeType: s.mimeType,
    byteLength: s.byteLength,
    kind: s.kind,
    parsedRev: CURRENT_PARSED_REV,
    ...(s.summary ? { summary: s.summary } : {}),
  };
}

/**
 * Atomically persist every staged record. Throws on the first failure so the
 * caller can roll back via `rollbackPersistedAttachments`. Each successful
 * write fires `chat.attachment.persisted` for telemetry / activity rail.
 */
export async function persistStagedAttachments(
  opts: PersistStagedOptions,
): Promise<ChatAttachmentRef[]> {
  const { staged, companyId, threadId, attachmentStore, eventBus } = opts;
  const refs: ChatAttachmentRef[] = [];
  for (const s of staged) {
    const meta = {
      attachmentId: s.attachmentId,
      companyId,
      threadId,
      filename: s.filename,
      mimeType: s.mimeType,
      byteLength: s.byteLength,
      sha256: s.sha256,
      createdAt: new Date().toISOString(),
      parsedRev: CURRENT_PARSED_REV,
      kind: s.kind,
    };
    const vaultRef = await attachmentStore.write(meta, s.bytes);
    const ref = refFromStaged(s, vaultRef);
    refs.push(ref);
    if (eventBus) {
      const payload: ChatAttachmentPersistedPayload = {
        attachmentId: ref.attachmentId,
        threadId,
        vaultRef,
        filename: ref.filename,
        mimeType: ref.mimeType,
        byteLength: ref.byteLength,
        kind: ref.kind,
        parsedRev: CURRENT_PARSED_REV,
      };
      eventBus.emit(
        chatAttachmentEvent(
          CHAT_ATTACHMENT_PERSISTED,
          { entityId: ref.attachmentId, companyId, threadId },
          payload,
        ),
      );
    }
  }
  return refs;
}

/** Best-effort cascade delete. Used when a partial send fails. */
export async function rollbackPersistedAttachments(
  store: AttachmentStore,
  refs: ReadonlyArray<ChatAttachmentRef>,
): Promise<void> {
  for (const r of refs) {
    try {
      await store.delete(r.vaultRef);
    } catch {
      /* swallow — rollback is best-effort */
    }
  }
}
