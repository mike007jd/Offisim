import {
  ATTACHMENT_FAIL_MESSAGE,
  type AttachmentFailReason,
  type StagedAttachment,
} from '@/data/types.js';
import { sha256Hex } from '@offisim/install-core';
import { CHAT_ATTACHMENT_MAX_BYTES, kindFromMime } from '@offisim/shared-types';
import { create } from 'zustand';

const MAX_ATTACHMENTS = 6;
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  fig: 'application/octet-stream',
  md: 'text/markdown',
  markdown: 'text/markdown',
  mdx: 'text/markdown',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  jsonc: 'text/x-jsonc',
  json5: 'text/x-json5',
  jsonl: 'application/x-ndjson',
  ndjson: 'application/x-ndjson',
  ipynb: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  xml: 'application/xml',
  plist: 'application/xml',
  ini: 'text/plain',
  cfg: 'text/plain',
  conf: 'text/plain',
  config: 'text/plain',
  env: 'text/plain',
  properties: 'text/plain',
  lock: 'text/plain',
  gitignore: 'text/plain',
  npmrc: 'text/plain',
  editorconfig: 'text/plain',
  dockerfile: 'text/plain',
  makefile: 'text/plain',
  diff: 'text/x-diff',
  patch: 'text/x-diff',
  js: 'text/javascript',
  jsx: 'text/jsx',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/x-typescript',
  tsx: 'text/x-typescript',
  mts: 'text/x-typescript',
  cts: 'text/x-typescript',
  py: 'text/x-python',
  rb: 'text/x-ruby',
  php: 'text/x-php',
  java: 'text/x-java',
  kt: 'text/x-kotlin',
  kts: 'text/x-kotlin',
  swift: 'text/x-swift',
  go: 'text/x-go',
  rs: 'text/x-rust',
  c: 'text/x-c',
  h: 'text/x-c',
  cc: 'text/x-c++',
  cpp: 'text/x-c++',
  cxx: 'text/x-c++',
  hpp: 'text/x-c++',
  cs: 'text/x-csharp',
  scala: 'text/x-scala',
  sh: 'application/x-sh',
  bash: 'application/x-sh',
  zsh: 'application/x-sh',
  fish: 'application/x-sh',
  ps1: 'text/x-powershell',
  sql: 'text/x-sql',
  graphql: 'text/x-graphql',
  gql: 'text/x-graphql',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  scss: 'text/x-scss',
  sass: 'text/x-sass',
  less: 'text/x-less',
  vue: 'text/x-vue',
  svelte: 'text/x-svelte',
  astro: 'text/x-astro',
  proto: 'text/x-protobuf',
  gradle: 'text/x-groovy',
  tf: 'text/x-hcl',
  tfvars: 'text/x-hcl',
  hcl: 'text/x-hcl',
};
const SUPPORTED_EXT = new Set(Object.keys(MIME_BY_EXT));

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
    const hydrationTasks: Array<() => Promise<void>> = [];
    const alreadyStaged = get().stagedByScope[scopeKey] ?? [];
    for (const file of files) {
      const ext = attachmentExtension(file.name);
      const source = file.file;
      const attachmentId = source ? crypto.randomUUID() : undefined;
      const id = `att-${attachmentId ?? crypto.randomUUID()}`;
      let fail: AttachmentFailReason | null = null;
      const existing = [...alreadyStaged, ...prepared];
      if (existing.filter((a) => a.status !== 'error').length >= MAX_ATTACHMENTS) fail = 'too-many';
      else if (file.bytes > CHAT_ATTACHMENT_MAX_BYTES) fail = 'too-large';
      else if (ext && !SUPPORTED_EXT.has(ext)) fail = 'unsupported-type';
      if (fail) {
        prepared.push(errorChip(id, file.name, fail));
        continue;
      }
      const mimeType = resolveMimeType(file.type, ext);
      const kind = kindFromMime(mimeType);
      if (source) {
        hydrationTasks.push(() =>
          hydrateStagedFile(scopeKey, id, attachmentId, file.name, source, set),
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
        file: source,
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
    for (const hydrate of hydrationTasks) await hydrate();
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
    ext: attachmentExtension(name),
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
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

function resolveMimeType(declared: string | undefined, ext: string): string {
  const normalized = declared?.split(';', 1)[0]?.trim().toLowerCase();
  if (!normalized || normalized === 'application/octet-stream') return mimeFromExt(ext);
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function attachmentExtension(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (/^\.env(?:\.|$)/.test(normalized)) return 'env';
  if (/^dockerfile(?:\.|$)/.test(normalized)) return 'dockerfile';
  if (/^makefile(?:\.|$)/.test(normalized)) return 'makefile';
  return normalized.split('.').pop() ?? '';
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
    if (bytes.byteLength > CHAT_ATTACHMENT_MAX_BYTES) {
      set((s) => ({
        stagedByScope: {
          ...s.stagedByScope,
          [scopeKey]: (s.stagedByScope[scopeKey] ?? []).map((attachment) =>
            attachment.id === id && attachment.attachmentId === attachmentId
              ? errorChip(id, name, 'too-large')
              : attachment,
          ),
        },
      }));
      return;
    }
    const sha256 = await sha256Hex(bytes);
    set((s) => ({
      stagedByScope: {
        ...s.stagedByScope,
        [scopeKey]: (s.stagedByScope[scopeKey] ?? []).map((attachment, _index, staged) => {
          if (attachment.id !== id || attachment.attachmentId !== attachmentId) return attachment;
          const duplicate = staged.some(
            (candidate) =>
              candidate.id !== id && candidate.status === 'attached' && candidate.sha256 === sha256,
          );
          return duplicate
            ? errorChip(id, name, 'duplicate')
            : {
                ...attachment,
                bytes,
                byteLength: bytes.byteLength,
                sizeLabel: formatBytes(bytes.byteLength),
                sha256,
              };
        }),
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
