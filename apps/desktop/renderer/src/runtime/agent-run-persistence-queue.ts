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
  terminalCheckpointMaxAttempts?: number;
  terminalCheckpointRetryBaseMs?: number;
  onError?: (label: string, error: unknown) => void;
}

const DEFAULT_CURSOR_THROTTLE_MS = 250;
const DEFAULT_TERMINAL_CHECKPOINT_MAX_ATTEMPTS = 3;
const DEFAULT_TERMINAL_CHECKPOINT_RETRY_BASE_MS = 50;
const MAX_TERMINAL_CHECKPOINT_ATTEMPTS = 8;
const MAX_TERMINAL_CHECKPOINT_RETRY_MS = 5_000;

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
  private readonly terminalCheckpointMaxAttempts: number;
  private readonly terminalCheckpointRetryBaseMs: number;
  private readonly onError: (label: string, error: unknown) => void;
  private disposed = false;

  constructor(options: AgentRunPersistenceQueueOptions = {}) {
    this.cursorThrottleMs = Math.max(0, options.cursorThrottleMs ?? DEFAULT_CURSOR_THROTTLE_MS);
    const configuredAttempts =
      options.terminalCheckpointMaxAttempts ?? DEFAULT_TERMINAL_CHECKPOINT_MAX_ATTEMPTS;
    this.terminalCheckpointMaxAttempts =
      Number.isSafeInteger(configuredAttempts) && configuredAttempts > 0
        ? Math.min(configuredAttempts, MAX_TERMINAL_CHECKPOINT_ATTEMPTS)
        : DEFAULT_TERMINAL_CHECKPOINT_MAX_ATTEMPTS;
    const configuredRetryBaseMs =
      options.terminalCheckpointRetryBaseMs ?? DEFAULT_TERMINAL_CHECKPOINT_RETRY_BASE_MS;
    this.terminalCheckpointRetryBaseMs =
      Number.isFinite(configuredRetryBaseMs) && configuredRetryBaseMs >= 0
        ? configuredRetryBaseMs
        : DEFAULT_TERMINAL_CHECKPOINT_RETRY_BASE_MS;
    this.onError =
      options.onError ??
      ((label, error) => {
        console.warn('[desktop-agent-runtime] persistence task failed', { label, error });
      });
  }

  enqueue(label: string, work: PersistenceWork): void {
    if (this.disposed) return;
    void this.schedule(label, work);
  }

  private schedule(label: string, work: PersistenceWork): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Persistence queue is disposed.'));
    const run = () => work();
    // The rejection handler is deliberate defensive recovery if an older tail
    // predates this class or an observer ever violates the no-throw boundary.
    const outcome = this.tail.then(run, run);
    this.tail = outcome.catch((error) => {
      try {
        this.onError(label, error);
      } catch (observerError) {
        console.warn('[desktop-agent-runtime] persistence error observer failed', {
          label,
          error: observerError,
        });
      }
    });
    return outcome;
  }

  enqueueTerminalCheckpoint(label: string, persistTerminal: PersistenceWork): Promise<void> {
    return this.schedule(label, async () => {
      let attempt = 1;
      for (;;) {
        try {
          await persistTerminal();
          break;
        } catch (error) {
          if (attempt >= this.terminalCheckpointMaxAttempts) throw error;
          const retryDelayMs = Math.min(
            MAX_TERMINAL_CHECKPOINT_RETRY_MS,
            this.terminalCheckpointRetryBaseMs * 2 ** (attempt - 1),
          );
          attempt += 1;
          if (retryDelayMs > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
          }
        }
      }
    });
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
