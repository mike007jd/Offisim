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
import { sha256Hex } from '@/lib/utils.js';
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

/** One tool call surfaced live while a run is in flight. Fed from the graph's
 *  `tool.execution.telemetry` stream so the user can see builtin, workstation,
 *  runtime-profile, and MCP tools actually working. */
export interface RunToolActivity {
  id: string;
  tool: string;
  state: 'running' | 'done' | 'error';
}

/** Cap on retained `activity` entries. Only the last few ever render, so a long
 *  agentic run (MAX_TOOL_ROUNDS up to 200) must not grow this unbounded; the
 *  true count is preserved separately via `activityTotal`. */
const MAX_ACTIVITY_ENTRIES = 12;

interface RunStore {
  threadId: string | null;
  isRunning: boolean;
  pipeline: RunPipeline | null;
  error: RunError | null;
  meeting: MeetingState | null;
  staged: StagedAttachment[];
  storageAvailable: boolean;
  /** Live tool activity for the in-flight run (cleared when a new run starts).
   *  Capped to the last MAX_ACTIVITY_ENTRIES; older entries are dropped. */
  activity: RunToolActivity[];
  /** Total tool calls noted this run, including ones evicted from `activity`.
   *  Source of monotonic activity ids and the strip's "+N hidden" count. */
  activityTotal: number;

  /** Bind the store to the active thread; seeds run/error/meeting from its state. */
  syncThread: (threadId: string, runState: RunState) => void;
  /** Begin a real in-flight provider/runtime request. */
  start: (title?: string, assigneeId?: string | null) => void;
  /** Mark the current provider/runtime request complete. */
  finish: () => void;
  /** Stop the live run (assistant-ui Cancel). */
  stop: () => void;
  /**
   * Real provider-abort handler registered by the active thread's runtime
   * (AbortController + llm_fetch_abort). The stage pill lives outside the
   * runtime tree, so it requests a stop through the store rather than holding
   * the handler directly. Null when no run is mounted.
   */
  stopHandler: (() => void) | null;
  /** Register (or clear) the active runtime's real abort handler. */
  setStopHandler: (handler: (() => void) | null) => void;
  /**
   * Re-dispatch closure for the last failed send, registered by the active
   * runtime alongside the error it surfaces. Null when the failure cannot be
   * re-dispatched (e.g. a seeded historical error), in which case the banner
   * honestly stays dismiss-only.
   */
  retryHandler: (() => void) | null;
  /** Register (or clear) the runtime's retry closure for the surfaced error. */
  setRetryHandler: (handler: (() => void) | null) => void;
  /**
   * Request a stop from outside the runtime (the diegetic stage pill). Invokes
   * the registered runtime abort when present; otherwise flips the local
   * running flag so the control is never inert.
   */
  requestStop: () => void;
  /** Record that a tool call started (appends a `running` activity entry). */
  noteToolCalled: (tool: string) => void;
  /** Resolve the most recent `running` entry for a tool to done/error. */
  noteToolResult: (tool: string, success: boolean) => void;
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

function makePipeline(title: string, assigneeId: string | null): RunPipeline {
  return {
    title,
    assigneeId,
    stepTotal: ACTIVE_PROVIDER_STAGES.length,
    stepDone: 1,
    stages: ACTIVE_PROVIDER_STAGES.map((stage) => ({ ...stage })),
  };
}

/** Seed an error banner for a thread persisted in the `error` state. The prior
 *  failure detail is not persisted per-thread, so this is an honest generic
 *  banner (no fabricated transport/auth specifics, no Details) until retried. */
function seedError(): RunError {
  return {
    id: 'thread-error',
    message: 'Last run failed.',
    technicalDetail: '',
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
  stopHandler: null,
  retryHandler: null,
  activity: [],
  activityTotal: 0,

  syncThread: (threadId, runState) => {
    const running = runState === 'running' || runState === 'paused';
    set({
      threadId,
      isRunning: running,
      pipeline: running ? makePipeline('Chat reply', null) : null,
      error: runState === 'error' ? seedError() : null,
      // A seeded error has no re-dispatchable input; any prior thread's retry
      // closure is stale here either way.
      retryHandler: null,
      // No producer emits MeetingState yet, so this stays null and
      // MeetingTray/MeetingRegion render nothing rather than asserting a meeting.
      meeting: null,
      staged: [],
      activity: [],
      activityTotal: 0,
    });
  },

  start: (title, assigneeId) => {
    set({
      isRunning: true,
      pipeline: makePipeline(title ?? 'Chat reply', assigneeId ?? null),
      error: null,
      // A new attempt supersedes the previous failure's retry closure.
      retryHandler: null,
      activity: [],
      activityTotal: 0,
    });
  },

  noteToolCalled: (tool) =>
    set((s) => {
      const total = s.activityTotal + 1;
      // Id is keyed off the monotonic total so it stays unique past eviction.
      const activity = [
        ...s.activity,
        { id: `act-${total}-${tool}`, tool, state: 'running' as const },
      ].slice(-MAX_ACTIVITY_ENTRIES);
      return { activity, activityTotal: total };
    }),

  noteToolResult: (tool, success) =>
    set((s) => {
      // Resolve the latest still-running entry for this tool name.
      let target = -1;
      for (let i = s.activity.length - 1; i >= 0; i--) {
        if (s.activity[i]?.tool === tool && s.activity[i]?.state === 'running') {
          target = i;
          break;
        }
      }
      if (target < 0) return {};
      return {
        activity: s.activity.map((entry, i) =>
          i === target ? { ...entry, state: success ? ('done' as const) : ('error' as const) } : entry,
        ),
      };
    }),

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

  setStopHandler: (stopHandler) => set({ stopHandler }),

  setRetryHandler: (retryHandler) => set({ retryHandler }),

  requestStop: () => {
    const handler = get().stopHandler;
    if (handler) {
      // The runtime's onCancel performs the real abort and calls stop() itself.
      handler();
    } else {
      set({ isRunning: false });
    }
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
