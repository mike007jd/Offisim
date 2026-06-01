import {
  ATTACHMENT_FAIL_MESSAGE,
  type AttachmentFailReason,
  type MeetingState,
  type PipelineStage,
  type RunError,
  type RunPipeline,
  type RunState,
  type StagedAttachment,
} from '@/data/types.js';
import { CHAT_ATTACHMENT_MAX_BYTES, kindFromMime } from '@offisim/shared-types';
import { create } from 'zustand';

/**
 * The chat run-state store. This is the *external store* the assistant-ui
 * runtime is built over: the runtime reads `isRunning` from here and routes its
 * Stop control into `stop()`, while the composer's send routes into `start()`.
 * The Office stage pipeline pill and the in-thread error
 * banner all read the same store, so "what the run is doing" is one source of
 * truth shared across the diegetic stage and the conversation.
 */

const MAX_ATTACHMENTS = 6;
// Extension allowlist is a renderer-only UX policy (the Rust sandbox enforces
// the byte cap but not the type); it gates which files the composer offers to
// stage and is not a security boundary.
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

interface RunStore {
  threadId: string | null;
  isRunning: boolean;
  pipeline: RunPipeline | null;
  error: RunError | null;
  meeting: MeetingState | null;
  staged: StagedAttachment[];
  storageAvailable: boolean;

  /** Bind the store to the active thread; seeds run/error/meeting from its state. */
  syncThread: (threadId: string, runState: RunState) => void;
  /** Begin a real in-flight provider/runtime request. */
  start: (title?: string, assigneeId?: string | null) => void;
  /** Mark the current provider/runtime request complete. */
  finish: () => void;
  /** Stop the live run (assistant-ui Cancel). */
  stop: () => void;
  /** Surface a real run failure into the in-thread error banner. */
  setError: (error: RunError) => void;
  /** Clear the error banner. */
  dismissError: () => void;

  stageFiles: (files: StageFileInput[]) => Promise<void>;
  removeStaged: (id: string) => void;
  clearStaged: () => void;
  setStorageAvailable: (available: boolean) => void;
}

type RunStoreSet = (partial: Partial<RunStore> | ((state: RunStore) => Partial<RunStore>)) => void;

const ACTIVE_PROVIDER_STAGES: PipelineStage[] = [
  { id: 'provider-request', label: 'Provider', state: 'active' },
  { id: 'assistant-response', label: 'Response', state: 'pending' },
];

/** Seed a pipeline for a thread that is already mid-run when it is opened, so
 *  the stage pill reflects the persisted run state rather than showing nothing. */
function seedPipeline(): RunPipeline {
  return {
    title: 'Provider response',
    assigneeId: null,
    stepTotal: ACTIVE_PROVIDER_STAGES.length,
    stepDone: 1,
    stages: ACTIVE_PROVIDER_STAGES.map((stage) => ({ ...stage })),
  };
}

/** Seed an error banner for a thread persisted in the `error` state. The prior
 *  failure detail is not persisted per-thread, so this is an honest generic
 *  banner (no fabricated transport/auth specifics) until the run is retried. */
function seedError(): RunError {
  return {
    id: 'thread-error',
    message: 'The previous run on this conversation ended in an error.',
    technicalDetail: 'No detail was captured for the prior failure.',
  };
}

export const useRunStore = create<RunStore>((set, get) => ({
  threadId: null,
  isRunning: false,
  pipeline: null,
  error: null,
  meeting: null,
  staged: [],
  storageAvailable: true,

  syncThread: (threadId, runState) => {
    const running = runState === 'running' || runState === 'paused';
    set({
      threadId,
      isRunning: running,
      pipeline: running ? seedPipeline() : null,
      error: runState === 'error' ? seedError() : null,
      // No producer emits MeetingState yet, so this stays null and
      // MeetingTray/MeetingRegion render nothing rather than asserting a meeting.
      meeting: null,
      staged: [],
    });
  },

  start: (title, assigneeId) => {
    const pipeline: RunPipeline = {
      title: title ?? 'Provider response',
      assigneeId: assigneeId ?? null,
      stepTotal: ACTIVE_PROVIDER_STAGES.length,
      stepDone: 1,
      stages: ACTIVE_PROVIDER_STAGES.map((stage) => ({ ...stage })),
    };
    set({ isRunning: true, pipeline, error: null });
  },

  finish: () => {
    const current = get().pipeline;
    set({
      isRunning: false,
      pipeline: current
        ? {
            ...current,
            stepDone: current.stepTotal,
            stages: current.stages.map((stage) => ({ ...stage, state: 'done' })),
          }
        : null,
    });
  },

  stop: () => {
    set({ isRunning: false });
  },

  setError: (error) => set({ error }),

  dismissError: () => set({ error: null }),

  stageFiles: async (files) => {
    if (!get().storageAvailable) {
      // Storage unavailable: surface a single error chip, attach nothing.
      set((s) => ({
        staged: [
          ...s.staged,
          errorChip('storage', files[0]?.name ?? 'file', 'storage-unavailable'),
        ],
      }));
      return;
    }
    const prepared: StagedAttachment[] = [];
    const hydrationTasks: Promise<void>[] = [];
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const id = `att-${file.name}-${file.bytes}`;
      let fail: AttachmentFailReason | null = null;
      const existing = [...get().staged, ...prepared];
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
        hydrationTasks.push(hydrateStagedFile(id, attachmentId, file.name, file.file, set));
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
    if (prepared.length) set((s) => ({ staged: [...s.staged, ...prepared] }));
    await Promise.all(hydrationTasks);
  },

  removeStaged: (id) => set((s) => ({ staged: s.staged.filter((a) => a.id !== id) })),
  clearStaged: () => set({ staged: [] }),
  setStorageAvailable: (storageAvailable) => set({ storageAvailable }),
}));

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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `bytes` is typed Uint8Array<ArrayBufferLike>; copy into a plain ArrayBuffer
  // so digest's BufferSource type is satisfied under TS 5.7+ (no SharedArrayBuffer).
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hydrateStagedFile(
  id: string,
  attachmentId: string | undefined,
  name: string,
  file: { arrayBuffer(): Promise<ArrayBuffer> },
  set: RunStoreSet,
): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = await sha256Hex(bytes);
    set((s) => ({
      staged: s.staged.map((attachment) =>
        attachment.id === id && attachment.attachmentId === attachmentId
          ? { ...attachment, bytes, sha256 }
          : attachment,
      ),
    }));
  } catch {
    set((s) => ({
      staged: s.staged.map((attachment) =>
        attachment.id === id && attachment.attachmentId === attachmentId
          ? errorChip(id, name, 'storage-unavailable')
          : attachment,
      ),
    }));
  }
}
