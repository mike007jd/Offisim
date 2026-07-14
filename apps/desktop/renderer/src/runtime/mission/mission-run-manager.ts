import { safeErrorMessage } from '@/lib/error-message.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import {
  type DesktopAgentRuntime,
  getDesktopAgentRuntime,
} from '@/runtime/desktop-agent-runtime.js';
import { getRepos, runtimeEventBus } from '@/runtime/repos.js';
import {
  type ThreadRunLease,
  conversationThreadLifecycle,
} from '@/runtime/thread-lifecycle-guard.js';
import { type MissionLoopResult, createDefaultEvaluatorRegistry } from '@offisim/core/browser';
import type { RuntimeEvent } from '@offisim/shared-types';
import { toast } from 'sonner';
import {
  MISSION_STATUS_CHANGED_EVENT,
  type MissionStatusChangedPayload,
} from './mission-events.js';
import {
  type MissionReloadRecoveryResult,
  bootstrapMissionReloadCompanies,
  convergeMissionReload,
} from './mission-reload-recovery.js';
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
 *    A reload cannot recreate the deterministic loop's lost promise. Startup
 *    therefore stops the Mission-owned native root and parks the durable attempt
 *    at `ready_to_resume`; it never pretends to continue the old loop.
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
  controller: ReturnType<typeof createMissionRunController> | null;
  threadId: string | null;
  threadRunLease: ThreadRunLease | null;
  removeAbortListener: (() => void) | null;
}

interface ActiveMissionRunSnapshot {
  missionId: string;
  companyId: string;
  startedAt: number;
  threadId: string | null;
}

class MissionRunManager {
  private readonly activeRuns = new Map<string, ActiveMissionRun>();
  private readonly listeners = new Set<() => void>();
  private readonly reloadBootstrapByCompany = new Map<
    string,
    Promise<MissionReloadRecoveryResult>
  >();
  private snapshot: readonly ActiveMissionRunSnapshot[] = [];

  /**
   * Converge Mission-owned roots before the company scope is exposed to the
   * Conversation recovery surface. Strict-mode remounts share one in-flight
   * pass; a failed pass is evicted so the next bootstrap can retry it.
   */
  async bootstrapRendererReload(companyId: string): Promise<MissionReloadRecoveryResult> {
    const cached = this.reloadBootstrapByCompany.get(companyId);
    if (cached) return cached;
    const pending = this.runRendererReloadBootstrap(companyId).catch((error) => {
      this.reloadBootstrapByCompany.delete(companyId);
      throw error;
    });
    this.reloadBootstrapByCompany.set(companyId, pending);
    return pending;
  }

  /**
   * Global startup barrier. Missions may be running in companies other than the
   * first scope shown after reload, so every active company must converge before
   * any Conversation UI is exposed.
   */
  async bootstrapAllRendererReload(
    companyIds: readonly string[],
  ): Promise<MissionReloadRecoveryResult[]> {
    return bootstrapMissionReloadCompanies(companyIds, (companyId) =>
      this.bootstrapRendererReload(companyId),
    );
  }

  /**
   * Start a ready mission's run loop. Resolves once the loop has been handed off
   * (the run continues in the background, decoupled from any component lifecycle).
   * Throws {@link MissionAlreadyRunningError} on a double-start, or a plain error
   * if the deps could not be assembled (e.g. no desktop runtime) — the caller
   * surfaces that to the user.
   */
  async start(
    missionId: string,
    companyId: string,
    transferredThreadRun?: ThreadRunLease,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.activeRuns.has(missionId)) throw new MissionAlreadyRunningError(missionId);

    // Reserve the slot synchronously (before the first await) so isRunning() flips
    // immediately and the Start button disables without a frame of double-click risk.
    const entry: ActiveMissionRun = {
      missionId,
      companyId,
      startedAt: Date.now(),
      runtime: null,
      controller: null,
      threadId: null,
      threadRunLease: transferredThreadRun ?? null,
      removeAbortListener: null,
    };
    this.activeRuns.set(missionId, entry);
    this.notify();

    if (signal) {
      const abortFromSignal = () => this.requestAbort(missionId);
      signal.addEventListener('abort', abortFromSignal, { once: true });
      entry.removeAbortListener = () => signal.removeEventListener('abort', abortFromSignal);
    }

    let threadId: string;
    try {
      throwIfMissionStartAborted(signal);
      const repos = await getRepos();
      const mission = await repos.missions.findById(missionId);
      throwIfMissionStartAborted(signal);
      if (!mission) throw new Error('This mission no longer exists.');
      if (mission.company_id !== companyId) {
        throw new Error('This mission does not belong to the active company.');
      }
      threadId = mission.thread_id;
      if (entry.threadRunLease && entry.threadRunLease.threadId !== threadId) {
        throw new Error('The transferred run belongs to a different conversation.');
      }
      entry.threadRunLease ??= conversationThreadLifecycle.beginRun(threadId);
      if (!entry.threadRunLease) {
        throw new Error('This conversation already has an active run.');
      }
      entry.threadId = threadId;
      this.notify();
      const runtime = await getDesktopAgentRuntime(companyId);
      throwIfMissionStartAborted(signal);
      // Record the runtime + thread so a concurrent cancel can abort the in-flight
      // agent call (see requestAbort) instead of leaving the run spinning.
      entry.runtime = runtime;
      const controller = createMissionRunController({
        agentRuntime: runtime,
        repos,
        evaluatorRegistry: createDefaultEvaluatorRegistry(),
        eventBus: runtimeEventBus,
      });
      entry.controller = controller;
      throwIfMissionStartAborted(signal);
      // Office Theater: the run is beginning → a planning beat.
      this.emitStatus(companyId, threadId, missionId, 'running');
      // Drive the loop to a terminal status off this call's stack.
      void this.runToTerminal(controller, companyId, threadId, missionId);
    } catch (err) {
      // Assembly failed before the loop started: release the slot and rethrow so
      // the Start handler can toast it. No status event was emitted in this path.
      this.activeRuns.delete(missionId);
      entry.removeAbortListener?.();
      entry.threadRunLease?.release();
      this.notify();
      throw err;
    }
  }

  isRunning(missionId: string): boolean {
    return this.activeRuns.has(missionId);
  }

  isThreadRunning(threadId: string): boolean {
    return Array.from(this.activeRuns.values()).some((run) => run.threadId === threadId);
  }

  getSnapshot = (): readonly ActiveMissionRunSnapshot[] => this.snapshot;

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
    if (!entry) return;
    entry.controller?.abortMission(missionId);
    if (entry.runtime && entry.threadId) entry.runtime.abort(entry.threadId);
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
    this.snapshot = Array.from(this.activeRuns.values(), (run) => ({
      missionId: run.missionId,
      companyId: run.companyId,
      startedAt: run.startedAt,
      threadId: run.threadId,
    }));
    for (const listener of this.listeners) listener();
  }

  private async runRendererReloadBootstrap(
    companyId: string,
  ): Promise<MissionReloadRecoveryResult> {
    const repos = await getRepos();
    return convergeMissionReload({
      companyId,
      repos,
      host: {
        snapshot: (requestId) => invokeCommand('agent_runtime_stream_snapshot', { requestId }),
        abort: (requestId) => invokeCommand('agent_runtime_abort', { requestId }),
      },
      now: () => new Date().toISOString(),
      newId: () => crypto.randomUUID(),
    });
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
      const entry = this.activeRuns.get(missionId);
      this.activeRuns.delete(missionId);
      entry?.removeAbortListener?.();
      entry?.threadRunLease?.release();
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

function throwIfMissionStartAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Mission start was stopped before launch.');
  error.name = 'AbortError';
  throw error;
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
