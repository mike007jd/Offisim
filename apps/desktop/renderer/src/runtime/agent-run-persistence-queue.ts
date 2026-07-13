type PersistenceWork = () => Promise<void>;
type CursorPersist = (cursor: number) => Promise<void>;

interface PendingCursor {
  latest: number;
  persisted: number;
  persist: CursorPersist;
  timer: ReturnType<typeof setTimeout> | null;
  writeScheduled: boolean;
}

export interface AgentRunPersistenceQueueOptions {
  cursorThrottleMs?: number;
  onError?: (label: string, error: unknown) => void;
}

const DEFAULT_CURSOR_THROTTLE_MS = 250;

/**
 * Keeps agent-run persistence ordered without allowing one rejected write to
 * poison the queue. Stream cursors are retained per run and collapsed to the
 * latest value before they enter that queue; terminal/start checkpoints can
 * force the pending value in immediately with `flushCursor`.
 */
export class AgentRunPersistenceQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly cursors = new Map<string, PendingCursor>();
  private readonly cursorThrottleMs: number;
  private readonly onError: (label: string, error: unknown) => void;
  private disposed = false;

  constructor(options: AgentRunPersistenceQueueOptions = {}) {
    this.cursorThrottleMs = Math.max(0, options.cursorThrottleMs ?? DEFAULT_CURSOR_THROTTLE_MS);
    this.onError =
      options.onError ??
      ((label, error) => {
        console.warn('[desktop-agent-runtime] persistence task failed', { label, error });
      });
  }

  enqueue(label: string, work: PersistenceWork): void {
    if (this.disposed) return;
    const run = async () => {
      try {
        await work();
      } catch (error) {
        try {
          this.onError(label, error);
        } catch (observerError) {
          console.warn('[desktop-agent-runtime] persistence error observer failed', {
            label,
            error: observerError,
          });
        }
      }
    };
    // The rejection handler is deliberate defensive recovery if an older tail
    // predates this class or an observer ever violates the no-throw boundary.
    this.tail = this.tail.then(run, run);
  }

  queueCursor(runId: string, cursor: number, persist: CursorPersist): void {
    if (this.disposed || !Number.isSafeInteger(cursor) || cursor <= 0) return;
    const existing = this.cursors.get(runId);
    const state =
      existing ??
      ({
        latest: 0,
        persisted: 0,
        persist,
        timer: null,
        writeScheduled: false,
      } satisfies PendingCursor);
    state.latest = Math.max(state.latest, cursor);
    state.persist = persist;
    if (!existing) this.cursors.set(runId, state);
    if (!state.timer && !state.writeScheduled && state.latest > state.persisted) {
      this.scheduleCursor(runId, state);
    }
  }

  flushCursor(runId: string): void {
    const state = this.cursors.get(runId);
    if (!state || this.disposed) return;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    this.enqueueCursorWrite(runId, state);
  }

  async drain(): Promise<void> {
    await this.tail;
  }

  dispose(): void {
    this.disposed = true;
    for (const state of this.cursors.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.cursors.clear();
  }

  private scheduleCursor(runId: string, state: PendingCursor): void {
    state.timer = setTimeout(() => {
      state.timer = null;
      this.enqueueCursorWrite(runId, state);
    }, this.cursorThrottleMs);
  }

  private enqueueCursorWrite(runId: string, state: PendingCursor): void {
    if (
      this.disposed ||
      state.writeScheduled ||
      state.latest <= state.persisted ||
      this.cursors.get(runId) !== state
    ) {
      return;
    }
    state.writeScheduled = true;
    this.enqueue(`persist stream cursor for ${runId}`, async () => {
      const target = state.latest;
      let succeeded = false;
      try {
        await state.persist(target);
        state.persisted = Math.max(state.persisted, target);
        succeeded = true;
      } finally {
        state.writeScheduled = false;
        if (!this.disposed && this.cursors.get(runId) === state) {
          if (succeeded && state.latest <= state.persisted) {
            this.cursors.delete(runId);
          } else if (succeeded && !state.timer) {
            this.scheduleCursor(runId, state);
          }
        }
        // On failure retain the latest cursor without spinning. The next cursor
        // event or semantic `flushCursor` checkpoint retries it.
      }
    });
  }
}
