import type { AttachmentKind, VaultRef } from '../chat-attachments.js';
import type { RuntimeEvent } from './core.js';

/** Canonical event type literal — use everywhere instead of bare strings. */
export const CHAT_ATTACHMENT_STAGED = 'chat.attachment.staged' as const;
export const CHAT_ATTACHMENT_PERSISTED = 'chat.attachment.persisted' as const;
export const CHAT_ATTACHMENT_READ = 'chat.attachment.read' as const;
export const CHAT_ATTACHMENT_GC_DROPPED = 'chat.attachment.gc.dropped' as const;
export const CHAT_ATTACHMENT_GC_SWEPT = 'chat.attachment.gc.swept' as const;
export const CHAT_ATTACHMENT_FAILED = 'chat.attachment.failed' as const;
export const CHAT_ATTACHMENT_EVICTED = 'chat.attachment.evicted' as const;

/** GC reason union — drives both `gc.dropped` payloads and store cascade callers. */
export type ChatAttachmentGcReason =
  | 'thread-deleted'
  | 'project-deleted'
  | 'company-deleted'
  | 'orphaned';

export const ATTACHMENT_GC_REASON_THREAD: ChatAttachmentGcReason = 'thread-deleted';
export const ATTACHMENT_GC_REASON_PROJECT: ChatAttachmentGcReason = 'project-deleted';
export const ATTACHMENT_GC_REASON_COMPANY: ChatAttachmentGcReason = 'company-deleted';
export const ATTACHMENT_GC_REASON_ORPHANED: ChatAttachmentGcReason = 'orphaned';

/**
 * Single envelope factory for `chat.attachment.*` events. Keeps the typed
 * `entityType: 'attachment'` cast in one place and lets callers pass only
 * the variable bits (type / entityId / scope / payload).
 */
export function chatAttachmentEvent<P>(
  type: string,
  scope: { entityId: string; companyId: string; threadId?: string },
  payload: P,
): RuntimeEvent<P> {
  return {
    type,
    entityId: scope.entityId,
    entityType: 'attachment',
    companyId: scope.companyId,
    threadId: scope.threadId,
    timestamp: Date.now(),
    payload,
  };
}

/** A file accepted into the composer staging tray. Pre-write event. */
export interface ChatAttachmentStagedPayload {
  readonly attachmentId: string;
  readonly threadId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly kind: AttachmentKind;
  readonly sha256: string;
  readonly summary?: string;
}

/** A staged file successfully persisted via `attachmentStore.write`. */
export interface ChatAttachmentPersistedPayload {
  readonly attachmentId: string;
  readonly threadId: string;
  readonly vaultRef: VaultRef;
  readonly filename: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly kind: AttachmentKind;
  readonly parsedRev: number;
}

/** AI-side `read_attachment` tool invocation telemetry. */
export interface ChatAttachmentReadPayload {
  readonly vaultRef: VaultRef;
  readonly threadId: string;
  readonly mode: 'auto' | 'text' | 'binary' | 'structured';
  readonly byteLengthRead: number;
  readonly truncated: boolean;
}

/**
 * Emitted per ref dropped by lifecycle cascade or GC sweep. `reason` carries
 * the cascade trigger so activity rail / telemetry can tell apart user delete
 * (`thread-deleted`) from background sweep (`orphaned`) from quota recovery
 * upstream signals.
 */
export interface ChatAttachmentGcDroppedPayload {
  readonly attachmentId: string;
  readonly threadId: string;
  readonly vaultRef: VaultRef;
  readonly reason: ChatAttachmentGcReason;
}

/** Boot-time GC sweep summary. Emitted once per sweep completion. */
export interface ChatAttachmentGcSweptPayload {
  readonly scanned: number;
  readonly dropped: number;
  readonly durationMs: number;
}

/**
 * Staging-time rejection. `reason` is one of the documented rejection codes;
 * UI maps it to a localizable inline error tagged with the offending filename.
 */
export type ChatAttachmentFailReason =
  | 'oversize-per-file'
  | 'oversize-total'
  | 'duplicate'
  | 'storage-unavailable'
  | 'parser-exception'
  | 'persist-failed';

export interface ChatAttachmentFailedPayload {
  readonly threadId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly reason: ChatAttachmentFailReason;
  readonly message?: string;
}

/**
 * Read-path miss when `attachmentStore.read(vaultRef)` returns
 * `attachment-not-found` for a ref still embedded in a persisted message.
 * Drives the `[evicted]` chip variant.
 */
export interface ChatAttachmentEvictedPayload {
  readonly attachmentId: string;
  readonly threadId: string;
  readonly vaultRef: VaultRef;
  readonly filename: string;
  readonly source: 'web-idb' | 'desktop-fs';
}
