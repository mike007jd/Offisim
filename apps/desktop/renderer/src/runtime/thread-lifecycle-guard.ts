/**
 * Renderer-wide exclusion between background Mission work and destructive
 * conversation mutations. Multiple Missions may share a thread, but a mutation
 * can own it only after every Mission has stopped; an owned mutation blocks new
 * Mission starts.
 */
export class ThreadLifecycleGuard {
  private readonly activeRuns = new Map<string, number>();
  private readonly mutations = new Set<string>();

  beginRun(threadId: string): (() => void) | null {
    if (this.mutations.has(threadId)) return null;
    this.activeRuns.set(threadId, (this.activeRuns.get(threadId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remaining = (this.activeRuns.get(threadId) ?? 1) - 1;
      if (remaining > 0) this.activeRuns.set(threadId, remaining);
      else this.activeRuns.delete(threadId);
    };
  }

  acquireMutation(threadId: string): (() => void) | null {
    if (this.mutations.has(threadId) || (this.activeRuns.get(threadId) ?? 0) > 0) return null;
    this.mutations.add(threadId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.mutations.delete(threadId);
    };
  }

  isRunActive(threadId: string): boolean {
    return (this.activeRuns.get(threadId) ?? 0) > 0;
  }
}

export const conversationThreadLifecycle = new ThreadLifecycleGuard();
