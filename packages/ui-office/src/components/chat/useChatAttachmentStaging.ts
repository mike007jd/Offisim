import type { EventBus } from '@offisim/core/browser';
import { parseAttachment } from '@offisim/doc-engine';
import {
  CHAT_ATTACHMENT_FAILED,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_STAGED,
  type ChatAttachmentFailReason,
  type ChatAttachmentFailedPayload,
  type ChatAttachmentStagedPayload,
  type ParsedAttachment,
  type StagedAttachment,
  chatAttachmentEvent,
  kindFromMime,
  summaryFromParsed,
} from '@offisim/shared-types';
import { useCallback, useMemo, useRef, useState } from 'react';
import { computeSha256 } from '../../lib/attachment-sha256.js';
import type { AttachmentStore } from '../../lib/attachment-store.js';

export const MAX_PER_FILE = CHAT_ATTACHMENT_MAX_BYTES;
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

export interface UseChatAttachmentStagingOptions {
  companyId: string;
  threadId: string;
  attachmentStore: AttachmentStore | null;
  eventBus: EventBus | null;
}

export interface ChatAttachmentStagingApi {
  staged: StagedAttachment[];
  errors: StagingError[];
  totalBytes: number;
  storageAvailable: boolean;
  handleStaging: (files: File[]) => Promise<void>;
  reportExternalError: (filename: string, message: string) => void;
  removeStaged: (attachmentId: string) => void;
  clear: () => void;
  /** Look up the cached parser output for a staged attachmentId — survives rerenders. */
  getCachedParsed: (attachmentId: string) => ParsedAttachment | undefined;
}

export interface StagingError {
  id: string;
  filename: string;
  message: string;
}

function emitFailed(
  eventBus: EventBus | null,
  payload: ChatAttachmentFailedPayload,
  companyId: string,
  attachmentId: string,
): void {
  if (!eventBus) return;
  eventBus.emit(
    chatAttachmentEvent(
      CHAT_ATTACHMENT_FAILED,
      { entityId: attachmentId, companyId, threadId: payload.threadId },
      payload,
    ),
  );
}

function emitStaged(
  eventBus: EventBus | null,
  payload: ChatAttachmentStagedPayload,
  companyId: string,
): void {
  if (!eventBus) return;
  eventBus.emit(
    chatAttachmentEvent(
      CHAT_ATTACHMENT_STAGED,
      { entityId: payload.attachmentId, companyId, threadId: payload.threadId },
      payload,
    ),
  );
}

function failureMessage(file: File, reason: ChatAttachmentFailReason, detail?: string): string {
  switch (reason) {
    case 'oversize-per-file':
      return `${file.name}: exceeds the 8 MB per-file limit`;
    case 'oversize-total':
      return `${file.name}: exceeds the 32 MB total attachment limit`;
    case 'duplicate':
      return `${file.name}: Already attached`;
    case 'storage-unavailable':
      return `${file.name}: storage unavailable in this browser window`;
    case 'parser-exception':
      return `${file.name}: ${detail ?? 'parser failed'}`;
    case 'persist-failed':
      return `${file.name}: failed to persist attachment`;
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

/**
 * Composer-side staging state machine. Owns:
 * - `staged: StagedAttachment[]` (local React state)
 * - per-file sha256 dedupe + 8 MB / 32 MB caps
 * - background parse via `@offisim/doc-engine.parseAttachment`
 * - typed `chat.attachment.staged` / `.failed` event emission
 *
 * The parsed output is cached on the staged record AND in a ref-backed map so
 * the send pipeline (`ChatPanel`) can pull `ParsedAttachment` without
 * re-parsing the bytes. Cache survives rerenders for the lifetime of the hook.
 */
export function useChatAttachmentStaging(
  opts: UseChatAttachmentStagingOptions,
): ChatAttachmentStagingApi {
  const { companyId, threadId, attachmentStore, eventBus } = opts;
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [errors, setErrors] = useState<StagingError[]>([]);
  const stagedRef = useRef(staged);
  stagedRef.current = staged;
  const storageAvailable = !!attachmentStore && attachmentStore.storageAvailable;

  const totalBytes = useMemo(() => staged.reduce((acc, s) => acc + s.byteLength, 0), [staged]);

  const reportFailure = useCallback(
    (file: File, reason: ChatAttachmentFailReason, message?: string, attachmentId = 'unknown') => {
      emitFailed(
        eventBus,
        {
          threadId,
          filename: file.name,
          mimeType: file.type,
          byteLength: file.size,
          reason,
          ...(message ? { message } : {}),
        },
        companyId,
        attachmentId,
      );
      setErrors((prev) =>
        [
          ...prev,
          {
            id: crypto.randomUUID(),
            filename: file.name,
            message: failureMessage(file, reason, message),
          },
        ].slice(-6),
      );
    },
    [eventBus, threadId, companyId],
  );

  const reportExternalError = useCallback((filename: string, message: string) => {
    setErrors((prev) =>
      [
        ...prev,
        {
          id: crypto.randomUUID(),
          filename,
          message,
        },
      ].slice(-6),
    );
  }, []);

  const handleStaging = useCallback(
    async (files: File[]): Promise<void> => {
      if (!storageAvailable) {
        for (const file of files) reportFailure(file, 'storage-unavailable');
        return;
      }
      let runningTotal = stagedRef.current.reduce((a, s) => a + s.byteLength, 0);
      const accepted: StagedAttachment[] = [];
      const parseJobs: { item: StagedAttachment; file: File }[] = [];
      const acceptedKeys = new Set(
        stagedRef.current.map((s) => `${s.filename}\0${s.byteLength}\0${s.sha256}`),
      );
      for (const file of files) {
        if (file.size > MAX_PER_FILE) {
          reportFailure(file, 'oversize-per-file');
          continue;
        }
        if (runningTotal + file.size > MAX_TOTAL_BYTES) {
          reportFailure(file, 'oversize-total');
          continue;
        }
        let bytes: Uint8Array;
        try {
          bytes = new Uint8Array(await file.arrayBuffer());
        } catch (err) {
          reportFailure(file, 'parser-exception', err instanceof Error ? err.message : String(err));
          continue;
        }
        const sha256 = await computeSha256(bytes);
        const dedupeKey = `${file.name}\0${file.size}\0${sha256}`;
        if (acceptedKeys.has(dedupeKey)) {
          reportFailure(file, 'duplicate');
          continue;
        }
        acceptedKeys.add(dedupeKey);
        const attachmentId = crypto.randomUUID();
        const kind = kindFromMime(file.type);
        const item: StagedAttachment = {
          attachmentId,
          file,
          bytes,
          filename: file.name,
          mimeType: file.type,
          byteLength: file.size,
          sha256,
          kind,
        };
        accepted.push(item);
        parseJobs.push({ item, file });
        runningTotal += file.size;
        emitStaged(
          eventBus,
          {
            attachmentId,
            threadId,
            filename: file.name,
            mimeType: file.type,
            byteLength: file.size,
            kind,
            sha256,
          },
          companyId,
        );
      }
      if (accepted.length > 0) {
        setStaged((prev) => [...prev, ...accepted]);
      }
      // Background parse — chip preview updates when ready; the parsed payload
      // is stored on the staged record itself (single source of truth), so the
      // send pipeline can read it back via getCachedParsed. Start this only
      // after the staged records are queued, otherwise tiny files can parse
      // before React has inserted their chip and the result is lost.
      for (const { item, file } of parseJobs) {
        void (async () => {
          try {
            const parsed = await parseAttachment(item.bytes, item.mimeType, item.filename);
            const summary = summaryFromParsed(parsed);
            setStaged((prev) =>
              prev.map((s) =>
                s.attachmentId === item.attachmentId ? { ...s, parsed, summary } : s,
              ),
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            reportFailure(file, 'parser-exception', msg, item.attachmentId);
            setStaged((prev) =>
              prev.map((s) =>
                s.attachmentId === item.attachmentId ? { ...s, error: { reason: msg } } : s,
              ),
            );
          }
        })();
      }
    },
    [storageAvailable, reportFailure, eventBus, threadId, companyId],
  );

  const removeStaged = useCallback((attachmentId: string) => {
    setStaged((prev) => prev.filter((s) => s.attachmentId !== attachmentId));
  }, []);

  const clear = useCallback(() => {
    setStaged([]);
    setErrors([]);
  }, []);

  const getCachedParsed = useCallback(
    (attachmentId: string) =>
      stagedRef.current.find((s) => s.attachmentId === attachmentId)?.parsed,
    [],
  );

  return {
    staged,
    errors,
    totalBytes,
    storageAvailable,
    handleStaging,
    reportExternalError,
    removeStaged,
    clear,
    getCachedParsed,
  };
}
