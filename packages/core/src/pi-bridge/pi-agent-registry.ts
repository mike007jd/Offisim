/**
 * Run-level registry of active pi agents, keyed by thread.
 *
 * Replaces `OrchestrationService.currentAborts` (a single AbortController per
 * thread) now that one thread can run N concurrent agents (a boss plus the
 * employees it delegates to). Whole-team cancel walks the thread's agent set and
 * calls `abort()` on each — pi's `execute` honors the abort and writes a
 * synthetic tool result so the transcript stays valid.
 */

import type { Agent } from '@offisim/pi-agent';

export class PiAgentRegistry {
  private readonly byThread = new Map<string, Set<Agent>>();

  /** Register an agent under a thread; returns a disposer that unregisters it. */
  register(threadId: string, agent: Agent): () => void {
    let set = this.byThread.get(threadId);
    if (!set) {
      set = new Set<Agent>();
      this.byThread.set(threadId, set);
    }
    set.add(agent);
    return () => {
      const current = this.byThread.get(threadId);
      if (!current) return;
      current.delete(agent);
      if (current.size === 0) this.byThread.delete(threadId);
    };
  }

  /** Abort every agent running under a thread (whole-team cancel). */
  abortThread(threadId: string): number {
    const set = this.byThread.get(threadId);
    if (!set) return 0;
    let count = 0;
    for (const agent of set) {
      agent.abort();
      count += 1;
    }
    return count;
  }

  /** Abort every agent across all threads (shutdown / dispose). */
  abortAll(): void {
    for (const set of this.byThread.values()) {
      for (const agent of set) agent.abort();
    }
  }

  hasActive(threadId: string): boolean {
    const set = this.byThread.get(threadId);
    return !!set && set.size > 0;
  }

  activeThreads(): string[] {
    return [...this.byThread.keys()];
  }
}
