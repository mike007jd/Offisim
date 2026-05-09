/**
 * Tool-lane bridge to the platform attachment store. Mirrors the JS-side
 * `AttachmentStore.read` contract but exposes only the read surface — the
 * core / agent code MUST NOT write attachments (the composer owns that).
 *
 * The injection point is `RuntimeContext.attachmentStoreBridge`. Bridge
 * presence + `llmToolCallsEnabled !== false` together gate the verified
 * attachment-capable `read_attachment` tool registration; SDK-backed model
 * transports (which set `llmToolCallsEnabled = false`) never see the schema.
 */
import type { AttachmentMeta, VaultRef } from '@offisim/shared-types';

export type AttachmentBridgeReadResult =
  | { kind: 'ok'; meta: AttachmentMeta; bytes: Uint8Array }
  | { kind: 'attachment-not-found'; vaultRef: VaultRef }
  | { kind: 'attachment-corrupted'; vaultRef: VaultRef };

export interface AttachmentStoreBridge {
  read(vaultRef: VaultRef, maxBytes?: number): Promise<AttachmentBridgeReadResult>;
}
