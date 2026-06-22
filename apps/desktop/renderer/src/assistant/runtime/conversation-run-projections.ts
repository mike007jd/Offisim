import type { SceneBeat } from '@offisim/shared-types';
import {
  type ConversationRunsSnapshot,
  isConversationRunActive,
} from './conversation-run-controller.js';

export { isConversationRunActive };

/**
 * One employee's aggregated workload across every active run touching them.
 *
 * `employee = stable identity, AgentRun = transient instance`: concurrent runs
 * on one employee collapse into a single actor (never a duplicate) carrying the
 * full count + the one dominant performance the office should play.
 */
export interface EmployeeWorkloadProjection {
  readonly employeeId: string;
  /** Every active run/delegation runId attributed to this employee. */
  readonly activeRunIds: readonly string[];
  readonly activeCount: number;
  readonly waitingCount: number;
  /** The single run that drives the visible performance; null when none active. */
  readonly dominant: {
    readonly runId: string;
    readonly state: 'working' | 'waiting';
    readonly beat: SceneBeat | null;
  } | null;
}

/**
 * Aggregate every active run touching an employee into ONE workload entry.
 *
 * The dominant run drives the single visible performance: a working run is
 * preferred over a waiting one (a sibling awaiting approval never downgrades an
 * employee already working), and a deterministic sorted-runId tie-break keeps the
 * choice stable across renders. `beatForRun` joins the dominant run's current
 * scene beat from the office timeline when supplied; without it (pure-data tests)
 * the beat is null. Keyed by employeeId so the office shows one actor + an
 * activeCount badge, while chat detail can still walk the individual runs.
 *
 * Selecting the dominant from the ACTIVE run set is what stops a just-finished
 * run B's terminal beat from overriding a still-running run A: B is no longer
 * active, so its runId never becomes the dominant the office plays.
 */
export function projectEmployeeWorkloads(
  snapshot: ConversationRunsSnapshot,
  projectId: string | null,
  beatForRun?: (runId: string) => SceneBeat | null,
): Map<string, EmployeeWorkloadProjection> {
  const acc = new Map<string, { working: string[]; waiting: string[] }>();
  if (!projectId) return new Map();

  const add = (employeeId: string, runId: string, waiting: boolean) => {
    let entry = acc.get(employeeId);
    if (!entry) {
      entry = { working: [], waiting: [] };
      acc.set(employeeId, entry);
    }
    (waiting ? entry.waiting : entry.working).push(runId);
  };

  for (const run of snapshot.runs) {
    if (run.projectId !== projectId) continue;
    if (!isConversationRunActive(run.phase)) continue;
    if (run.employeeId && run.attemptId) {
      add(run.employeeId, run.attemptId, run.phase === 'awaiting-approval');
    }
    // Delegated child runs still in flight light up their teammate too — this is
    // what makes the office show multiple agents working in parallel.
    for (const delegation of run.delegations) {
      if (delegation.state === 'running' && delegation.employeeId) {
        add(delegation.employeeId, delegation.runId, false);
      }
    }
  }

  const out = new Map<string, EmployeeWorkloadProjection>();
  for (const [employeeId, { working, waiting }] of acc) {
    const isWorking = working.length > 0;
    const pool = isWorking ? working : waiting;
    const state: 'working' | 'waiting' = isWorking ? 'working' : 'waiting';
    // pool is a freshly-built local array (working/waiting), safe to sort in place
    // for a deterministic tie-break; activeRunIds is a separate new array.
    const runId = pool.sort()[0] ?? null;
    const activeRunIds = [...working, ...waiting];
    out.set(employeeId, {
      employeeId,
      activeRunIds,
      activeCount: activeRunIds.length,
      waitingCount: waiting.length,
      dominant: runId ? { runId, state, beat: beatForRun?.(runId) ?? null } : null,
    });
  }
  return out;
}

/**
 * Flatten each employee's dominant ACTIVE beat into the office staging input —
 * one beat per actor, never a stale just-finished run's. Shared by both scene
 * render modes so 2D and 3D stage from the same set.
 */
export function dominantBeatsFrom(
  workloads: ReadonlyMap<string, EmployeeWorkloadProjection>,
): SceneBeat[] {
  return Array.from(workloads.values()).flatMap((w) => (w.dominant?.beat ? [w.dominant.beat] : []));
}
