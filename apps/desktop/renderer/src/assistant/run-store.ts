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
  /** Clear the error banner. */
  dismissError: () => void;

  stageFiles: (files: Array<{ name: string; bytes: number }>) => void;
  removeStaged: (id: string) => void;
  clearStaged: () => void;
  setStorageAvailable: (available: boolean) => void;
}

const ACTIVE_PROVIDER_STAGES: PipelineStage[] = [
  { id: 'provider-request', label: 'Provider', state: 'active' },
  { id: 'assistant-response', label: 'Response', state: 'pending' },
];

export const useRunStore = create<RunStore>((set, get) => ({
  threadId: null,
  isRunning: false,
  pipeline: null,
  error: null,
  meeting: null,
  staged: [],
  storageAvailable: true,

  syncThread: (threadId, _runState) => {
    set({
      threadId,
      isRunning: false,
      pipeline: null,
      error: null,
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

  dismissError: () => set({ error: null }),

  stageFiles: (files) => {
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
    set((s) => {
      const next = [...s.staged];
      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        const id = `att-${file.name}-${file.bytes}`;
        let fail: AttachmentFailReason | null = null;
        if (next.filter((a) => a.status !== 'error').length >= MAX_ATTACHMENTS) fail = 'too-many';
        else if (file.bytes > 8 * 1024 * 1024) fail = 'too-large';
        else if (next.some((a) => a.id === id && a.status !== 'error')) fail = 'duplicate';
        else if (ext && !SUPPORTED_EXT.has(ext)) fail = 'unsupported-type';
        if (fail) {
          next.push(errorChip(id, file.name, fail));
          continue;
        }
        next.push({
          id,
          name: file.name,
          ext,
          sizeLabel: formatBytes(file.bytes),
          status: 'attached',
        });
      }
      return { staged: next };
    });
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
