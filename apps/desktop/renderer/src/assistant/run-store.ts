import { activeMeeting, activeRunPipeline } from '@/data/fixtures.js';
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
 * The Office stage (pipeline pill + Live run-axis) and the in-thread error
 * banner all read the same store, so "what the run is doing" is one source of
 * truth shared across the diegetic stage and the conversation.
 *
 * The advance/complete lifecycle is fixture-simulated today; this is the seam
 * where the real harness run feed lands (it already speaks the same shape).
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
  /** Begin a run (composer send / Retry). Advances the pipeline to completion. */
  start: (title?: string, assigneeId?: string | null) => void;
  /** Stop the live run (assistant-ui Cancel). */
  stop: () => void;
  /** Clear the error banner. */
  dismissError: () => void;
  /** Retry after a failure: clear error and start a fresh run. */
  retry: () => void;
  /** Swap the run to another employee (re-dispatch). */
  swapPerson: (employeeId: string) => void;
  toggleActionItem: (id: string) => void;

  stageFiles: (files: Array<{ name: string; bytes: number }>) => void;
  removeStaged: (id: string) => void;
  clearStaged: () => void;
  setStorageAvailable: (available: boolean) => void;
}

let advanceTimer: ReturnType<typeof setInterval> | null = null;

function clearTimer() {
  if (advanceTimer) {
    clearInterval(advanceTimer);
    advanceTimer = null;
  }
}

function stagesAtStep(
  stages: PipelineStage[],
  stepDone: number,
  stepTotal: number,
): PipelineStage[] {
  // Map run progress (0..total) onto the 5 ceremony stages so the pill and the
  // Live axis advance together. The final stage only lights once work is done.
  const ratio = stepTotal === 0 ? 0 : stepDone / stepTotal;
  const activeIdx = Math.min(stages.length - 1, Math.floor(ratio * (stages.length - 1)));
  return stages.map((stage, i) => ({
    ...stage,
    state: i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending',
  }));
}

function seedError(threadId: string): RunError {
  return {
    id: `err-${threadId}`,
    reason: 'auth',
    message: 'The run couldn’t start — the remote agent rejected the request.',
    technicalDetail: 'Remote agent transport returned 401 Unauthorized before run start.',
    history: [
      {
        id: 'te1',
        at: Date.now() - 60_000,
        reason: 'auth',
        message: 'Transport authorization failed (401)',
      },
      {
        id: 'te2',
        at: Date.now() - 3_600_000,
        reason: 'transport',
        message: 'Connection reset during handshake',
      },
    ],
    swapCandidateIds: ['emp-mara', 'emp-sela'],
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
    clearTimer();
    const running = runState === 'running';
    set({
      threadId,
      isRunning: running,
      pipeline: running ? { ...activeRunPipeline } : null,
      error: runState === 'error' ? seedError(threadId) : null,
      meeting: threadId === activeMeeting.threadId ? { ...activeMeeting } : null,
      staged: [],
    });
    if (running) get().start(activeRunPipeline.title, activeRunPipeline.assigneeId);
  },

  start: (title, assigneeId) => {
    clearTimer();
    const base = get().pipeline ?? activeRunPipeline;
    const total = base.stepTotal || 7;
    // Resume mid-run, else start fresh — and never resume a finished pipeline
    // (Retry/Swap on a completed run must replay from 0).
    const resume = get().isRunning && get().pipeline ? (get().pipeline?.stepDone ?? 0) : 0;
    let step = resume >= total ? 0 : resume;
    const pipeline: RunPipeline = {
      title: title ?? base.title,
      assigneeId: assigneeId ?? base.assigneeId,
      stepTotal: total,
      stepDone: step,
      stages: stagesAtStep(base.stages, step, total),
    };
    set({ isRunning: true, pipeline, error: null });
    advanceTimer = setInterval(() => {
      const current = get().pipeline;
      if (!current) return clearTimer();
      step = current.stepDone + 1;
      if (step >= current.stepTotal) {
        clearTimer();
        set({
          isRunning: false,
          pipeline: {
            ...current,
            stepDone: current.stepTotal,
            stages: current.stages.map((s) => ({ ...s, state: 'done' })),
          },
        });
        return;
      }
      set({
        pipeline: {
          ...current,
          stepDone: step,
          stages: stagesAtStep(current.stages, step, current.stepTotal),
        },
      });
    }, 1400);
  },

  stop: () => {
    clearTimer();
    set({ isRunning: false });
  },

  dismissError: () => set({ error: null }),

  retry: () => {
    set({ error: null });
    get().start();
  },

  swapPerson: (employeeId) => {
    const p = get().pipeline ?? activeRunPipeline;
    set({ error: null, pipeline: { ...p, assigneeId: employeeId } });
    get().start(p.title, employeeId);
  },

  toggleActionItem: (id) => {
    const meeting = get().meeting;
    if (!meeting) return;
    set({
      meeting: {
        ...meeting,
        actionItems: meeting.actionItems.map((a) => (a.id === id ? { ...a, done: !a.done } : a)),
      },
    });
  },

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
          status: 'parsing',
        });
      }
      return { staged: next };
    });
    // Resolve "parsing" chips to "parsed" shortly after (read-by-ref settle).
    setTimeout(() => {
      set((s) => ({
        staged: s.staged.map((a) => (a.status === 'parsing' ? { ...a, status: 'parsed' } : a)),
      }));
    }, 600);
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
