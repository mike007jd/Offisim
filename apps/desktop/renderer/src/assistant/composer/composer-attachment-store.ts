import {
  ATTACHMENT_FAIL_MESSAGE,
  type AttachmentFailReason,
  type StagedAttachment,
} from '@/data/types.js';
import { sha256Hex } from '@offisim/install-core';
import { CHAT_ATTACHMENT_MAX_BYTES, kindFromMime } from '@offisim/shared-types';
import { create } from 'zustand';

const MAX_ATTACHMENTS = 6;
const SUPPORTED_EXT = new Set([
  'pdf',
  'md',
  'txt',
  'csv',
  'json',
  'png',
  'jpg',
  'jpeg',
  'fig',
  'docx',
  'xlsx',
]);

interface StageFileInput {
  name: string;
  bytes: number;
  type?: string;
  file?: { arrayBuffer(): Promise<ArrayBuffer> };
}

export interface ComposerAttachmentScope {
  companyId: string | null;
  projectId: string | null;
  threadId: string;
}

export function composerAttachmentScopeKey(scope: ComposerAttachmentScope): string {
  return JSON.stringify([scope.companyId, scope.projectId, scope.threadId]);
}

interface ComposerAttachmentStore {
  stagedByScope: Record<string, StagedAttachment[]>;
  storageAvailable: boolean;
  stageFiles: (scope: ComposerAttachmentScope, files: StageFileInput[]) => Promise<void>;
  removeStaged: (scope: ComposerAttachmentScope, id: string) => void;
  consumeStaged: (scope: ComposerAttachmentScope, ids: readonly string[]) => void;
  setStorageAvailable: (available: boolean) => void;
}

type StoreSet = (
  partial:
    | Partial<ComposerAttachmentStore>
    | ((state: ComposerAttachmentStore) => Partial<ComposerAttachmentStore>),
) => void;

export const useComposerAttachmentStore = create<ComposerAttachmentStore>((set, get) => ({
  stagedByScope: {},
  storageAvailable: true,

  stageFiles: async (scope, files) => {
    const scopeKey = composerAttachmentScopeKey(scope);
    if (!get().storageAvailable) {
      set((s) => ({
        stagedByScope: {
          ...s.stagedByScope,
          [scopeKey]: [
            ...(s.stagedByScope[scopeKey] ?? []),
            errorChip('storage', files[0]?.name ?? 'file', 'storage-unavailable'),
          ],
        },
      }));
      return;
    }
    const prepared: StagedAttachment[] = [];
    const hydrationTasks: Promise<void>[] = [];
    const alreadyStaged = get().stagedByScope[scopeKey] ?? [];
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const id = `att-${file.name}-${file.bytes}`;
      let fail: AttachmentFailReason | null = null;
      const existing = [...alreadyStaged, ...prepared];
      if (existing.filter((a) => a.status !== 'error').length >= MAX_ATTACHMENTS) fail = 'too-many';
      else if (file.bytes > CHAT_ATTACHMENT_MAX_BYTES) fail = 'too-large';
      else if (existing.some((a) => a.id === id && a.status !== 'error')) fail = 'duplicate';
      else if (ext && !SUPPORTED_EXT.has(ext)) fail = 'unsupported-type';
      if (fail) {
        prepared.push(errorChip(id, file.name, fail));
        continue;
      }
      const mimeType = file.type || mimeFromExt(ext);
      const kind = kindFromMime(mimeType);
      const attachmentId = file.file ? crypto.randomUUID() : undefined;
      if (file.file) {
        hydrationTasks.push(
          hydrateStagedFile(scopeKey, id, attachmentId, file.name, file.file, set),
        );
      }
      prepared.push({
        id,
        name: file.name,
        ext,
        sizeLabel: formatBytes(file.bytes),
        status: 'attached',
        mimeType,
        byteLength: file.bytes,
        attachmentId,
        file: file.file,
        kind,
      });
    }
    if (prepared.length) {
      set((s) => ({
        stagedByScope: {
          ...s.stagedByScope,
          [scopeKey]: [...(s.stagedByScope[scopeKey] ?? []), ...prepared],
        },
      }));
    }
    await Promise.all(hydrationTasks);
  },

  removeStaged: (scope, id) => {
    const scopeKey = composerAttachmentScopeKey(scope);
    set((s) => ({
      stagedByScope: withoutEmptyScope(
        s.stagedByScope,
        scopeKey,
        (s.stagedByScope[scopeKey] ?? []).filter((attachment) => attachment.id !== id),
      ),
    }));
  },
  consumeStaged: (scope, ids) => {
    if (ids.length === 0) return;
    const scopeKey = composerAttachmentScopeKey(scope);
    const consumed = new Set(ids);
    set((s) => ({
      stagedByScope: withoutEmptyScope(
        s.stagedByScope,
        scopeKey,
        (s.stagedByScope[scopeKey] ?? []).filter((attachment) => !consumed.has(attachment.id)),
      ),
    }));
  },
  setStorageAvailable: (storageAvailable) => set({ storageAvailable }),
}));

function withoutEmptyScope(
  current: Record<string, StagedAttachment[]>,
  scopeKey: string,
  next: StagedAttachment[],
): Record<string, StagedAttachment[]> {
  if (next.length > 0) return { ...current, [scopeKey]: next };
  const { [scopeKey]: _removed, ...rest } = current;
  return rest;
}

function errorChip(id: string, name: string, reason: AttachmentFailReason): StagedAttachment {
  return {
    id: `${id}-err`,
    name,
    ext: name.split('.').pop()?.toLowerCase() ?? '',
    sizeLabel: ATTACHMENT_FAIL_MESSAGE[reason],
    status: 'error',
    failReason: reason,
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case 'md':
      return 'text/markdown';
    case 'txt':
      return 'text/plain';
    case 'csv':
      return 'text/csv';
    case 'json':
      return 'application/json';
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    default:
      return 'application/octet-stream';
  }
}

async function hydrateStagedFile(
  scopeKey: string,
  id: string,
  attachmentId: string | undefined,
  name: string,
  file: { arrayBuffer(): Promise<ArrayBuffer> },
  set: StoreSet,
): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = await sha256Hex(bytes);
    set((s) => ({
      stagedByScope: {
        ...s.stagedByScope,
        [scopeKey]: (s.stagedByScope[scopeKey] ?? []).map((attachment) =>
          attachment.id === id && attachment.attachmentId === attachmentId
            ? { ...attachment, bytes, sha256 }
            : attachment,
        ),
      },
    }));
  } catch {
    set((s) => ({
      stagedByScope: {
        ...s.stagedByScope,
        [scopeKey]: (s.stagedByScope[scopeKey] ?? []).map((attachment) =>
          attachment.id === id && attachment.attachmentId === attachmentId
            ? errorChip(id, name, 'storage-unavailable')
            : attachment,
        ),
      },
    }));
  }
}
