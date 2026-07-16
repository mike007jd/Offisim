/**
 * Renderer-wide exclusion between Conversation work, Mission work, and
 * destructive conversation mutations. A thread has at most one active root.
 */
export interface ThreadRunLease {
  readonly threadId: string;
  release(): void;
  /** Atomically hand the same exclusive slot to another lane. The old lease is
   * invalidated, so its later cleanup cannot release the new owner's slot. */
  transfer(): ThreadRunLease | null;
}

interface ThreadRunLeaseState {
  threadId: string;
  generation: number;
  active: boolean;
}

export class ThreadLifecycleGuard {
  private readonly activeRuns = new Map<string, ThreadRunLeaseState>();
  private readonly mutations = new Set<string>();

  beginRun(threadId: string): ThreadRunLease | null {
    if (this.mutations.has(threadId) || this.activeRuns.has(threadId)) return null;
    const state: ThreadRunLeaseState = { threadId, generation: 0, active: true };
    this.activeRuns.set(threadId, state);
    return this.makeLease(state, state.generation);
  }

  acquireMutation(threadId: string): (() => void) | null {
    if (this.mutations.has(threadId) || this.activeRuns.has(threadId)) return null;
    this.mutations.add(threadId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.mutations.delete(threadId);
    };
  }

  isRunActive(threadId: string): boolean {
    return this.activeRuns.has(threadId);
  }

  private makeLease(state: ThreadRunLeaseState, generation: number): ThreadRunLease {
    return {
      threadId: state.threadId,
      release: () => {
        if (!state.active || state.generation !== generation) return;
        state.active = false;
        if (this.activeRuns.get(state.threadId) === state) {
          this.activeRuns.delete(state.threadId);
        }
      },
      transfer: () => {
        if (!state.active || state.generation !== generation) return null;
        state.generation += 1;
        return this.makeLease(state, state.generation);
      },
    };
  }
}

export const conversationThreadLifecycle = new ThreadLifecycleGuard();
