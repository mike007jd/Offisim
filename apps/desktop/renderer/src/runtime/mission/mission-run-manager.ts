import { safeErrorMessage } from '@/lib/error-message.js';
import {
  type DesktopAgentRuntime,
  getDesktopAgentRuntime,
} from '@/runtime/desktop-agent-runtime.js';
import { getRepos, runtimeEventBus } from '@/runtime/repos.js';
import { type MissionLoopResult, createDefaultEvaluatorRegistry } from '@offisim/core/browser';
import type { RuntimeEvent } from '@offisim/shared-types';
import { toast } from 'sonner';
import {
  MISSION_STATUS_CHANGED_EVENT,
  type MissionStatusChangedPayload,
} from './mission-events.js';
import { createMissionRunController } from './mission-run-controller.js';

/**
 * MissionRunManager (M2/M3 Tier C live wiring) — the renderer-side singleton that
 * actually STARTS a ready mission, the entry point the M3 Composer/Control surface
 * was missing. It assembles the live deps (the Pi agent runtime, the SQLite repos,
 * the default EvaluatorRegistry, the runtime event bus) and drives the deterministic
 * {@link createMissionRunController}'s `runMission` to a terminal status.
 *
 * It mirrors the {@link conversationRunController} shape deliberately:
 *  - In-flight run state is IN-MEMORY and per-session (a `Map` keyed by missionId).
 *    A reload mid-run abandons the in-memory run; the mission row stays
 *    `running`/`verifying` with a non-terminal attempt — that is the M4 durable
 *    recovery case (a later Tier C slice). This manager does NOT pretend to resume.
 *  - A double-start is rejected; concurrent runs of DIFFERENT missions are allowed
 *    (each is an independent entry).
 *
 * Mission STATUS is never written here — the loop's MissionService is the §18 single
 * writer. This manager only emits a presentation-level
 * {@link MISSION_STATUS_CHANGED_EVENT} (running at start, the terminal status at
 * end) so the Office Theater animates, and React Query liveness is driven by the
 * MissionControl surface (refetchInterval while active + invalidate on the
 * running↔idle edge).
 */

/** Thrown by {@link MissionRunManager.start} on a double-start. Internal — the
 *  Start handler surfaces it generically; named for clear stacks/diagnostics. */
class MissionAlreadyRunningError extends Error {
  constructor(missionId: string) {
    super(`Mission ${missionId} already has an active run.`);
    this.name = 'MissionAlreadyRunningError';
  }
}

interface ActiveMissionRun {
  missionId: string;
  companyId: string;
  startedAt: number;
  /** The run's runtime + thread, set once assembly succeeds, so a cancel can
   *  abort the in-flight agent call (collapsing the running↔cancelled window). */
  runtime: DesktopAgentRuntime | null;
  threadId: string | null;
}

class MissionRunManager {
  private readonly activeRuns = new Map<string, ActiveMissionRun>();
  private readonly listeners = new Set<() => void>();

  /**
   * Start a ready mission's run loop. Resolves once the loop has been handed off
   * (the run continues in the background, decoupled from any component lifecycle).
   * Throws {@link MissionAlreadyRunningError} on a double-start, or a plain error
   * if the deps could not be assembled (e.g. no desktop runtime) — the caller
   * surfaces that to the user.
   */
  async start(missionId: string, companyId: string): Promise<void> {
    if (this.activeRuns.has(missionId)) throw new MissionAlreadyRunningError(missionId);

    // Reserve the slot synchronously (before the first await) so isRunning() flips
    // immediately and the Start button disables without a frame of double-click risk.
    const entry: ActiveMissionRun = {
      missionId,
      companyId,
      startedAt: Date.now(),
      runtime: null,
      threadId: null,
    };
    this.activeRuns.set(missionId, entry);
    this.notify();

    let threadId: string;
    try {
      const repos = await getRepos();
      const mission = await repos.missions?.findById(missionId);
      if (!mission) throw new Error('This mission no longer exists.');
      threadId = mission.thread_id;
      const runtime = await getDesktopAgentRuntime(companyId);
      // Record the runtime + thread so a concurrent cancel can abort the in-flight
      // agent call (see requestAbort) instead of leaving the run spinning.
      entry.runtime = runtime;
      entry.threadId = threadId;
      const controller = createMissionRunController({
        agentRuntime: runtime,
        repos,
        evaluatorRegistry: createDefaultEvaluatorRegistry(),
        eventBus: runtimeEventBus,
      });
      // Office Theater: the run is beginning → a planning beat.
      this.emitStatus(companyId, threadId, missionId, 'running');
      // Drive the loop to a terminal status off this call's stack.
      void this.runToTerminal(controller, companyId, threadId, missionId);
    } catch (err) {
      // Assembly failed before the loop started: release the slot and rethrow so
      // the Start handler can toast it. No status event was emitted in this path.
      this.activeRuns.delete(missionId);
      this.notify();
      throw err;
    }
  }

  isRunning(missionId: string): boolean {
    return this.activeRuns.has(missionId);
  }

  /**
   * Best-effort: abort the in-flight agent run for a mission so a user cancel
   * makes the Pi call return promptly — otherwise `isRunning` would stay true (and
   * the control strip would spin) until the agent finishes on its own, while the
   * status badge already reads `cancelled`. The authoritative DB cancel still goes
   * through MissionService (`useMissionTransition('cancel')`); this only nudges the
   * runtime. No-op if the run has not assembled its runtime yet.
   */
  requestAbort(missionId: string): void {
    const entry = this.activeRuns.get(missionId);
    if (!entry?.runtime || !entry.threadId) return;
    entry.runtime.abort(entry.threadId);
  }

  /** Stable subscribe (bound) so `useSyncExternalStore` does not resubscribe each
   *  render. Fires whenever the set of running missions changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private async runToTerminal(
    controller: ReturnType<typeof createMissionRunController>,
    companyId: string,
    threadId: string,
    missionId: string,
  ): Promise<void> {
    let result: MissionLoopResult | null = null;
    let error: unknown = null;
    try {
      // runMission resolves with a terminal MissionLoopResult on every stop path
      // (completed / blocked / failed / stuck / cancelled). It throws only on an
      // unexpected invariant violation (e.g. a zero-required mission that bypassed
      // creation) — handled below as an error.
      result = await controller.runMission(missionId);
    } catch (err) {
      error = err;
    } finally {
      this.activeRuns.delete(missionId);
      this.notify();
    }

    const finalStatus = result?.finalMissionStatus ?? 'failed';
    // Terminal beat for the Office Theater.
    this.emitStatus(companyId, threadId, missionId, finalStatus);

    if (error) {
      toast.error('Could not run mission', { description: safeErrorMessage(error) });
      return;
    }
    if (finalStatus === 'completed') {
      toast.success('Mission completed', {
        description: 'Every required criterion passed.',
      });
      return;
    }
    if (finalStatus === 'cancelled') {
      toast.message('Mission cancelled');
      return;
    }
    // blocked / failed / anything else non-terminal-success.
    toast.error(`Mission ${finalStatus}`, {
      description: stopReasonHint(result?.stopReason),
    });
  }

  private emitStatus(
    companyId: string,
    threadId: string,
    missionId: string,
    status: string,
    rootRunId?: string,
  ): void {
    const payload: MissionStatusChangedPayload = {
      missionId,
      status,
      ...(rootRunId ? { rootRunId } : {}),
    };
    const event: RuntimeEvent<MissionStatusChangedPayload> = {
      type: MISSION_STATUS_CHANGED_EVENT,
      entityId: missionId,
      entityType: 'runtime',
      companyId,
      threadId,
      timestamp: Date.now(),
      payload,
    };
    runtimeEventBus.emit(event);
  }
}

/** A short, user-legible reason for a non-completion stop. */
function stopReasonHint(stopReason: string | undefined): string {
  switch (stopReason) {
    case 'token_budget':
      return 'The token budget was exhausted.';
    case 'attempt_cap':
      return 'The attempt limit was reached.';
    case 'stuck':
      return 'The same verification kept failing.';
    case 'runtime_incompatible':
      return 'The agent runtime could not run (check the model credentials).';
    case 'cancelled':
      return 'The mission was cancelled.';
    default:
      return 'See the criteria below for what is still blocking it.';
  }
}

/** The single renderer-wide mission run manager. */
export const missionRunManager = new MissionRunManager();
