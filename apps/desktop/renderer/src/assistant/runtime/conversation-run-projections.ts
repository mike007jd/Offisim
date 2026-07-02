import {
  type SceneBeat,
  type SurfacedResourceSeverity,
  resourceSeverityRank,
  surfacedResourceSeverity,
} from '@offisim/shared-types';
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
  /** Up to three generic work chips shown in the single-actor workload bubble. */
  readonly workloadChips: readonly EmployeeWorkloadChip[];
  /** The single run that drives the visible performance; null when none active. */
  readonly dominant: {
    readonly runId: string;
    readonly state: 'working' | 'waiting';
    readonly beat: SceneBeat | null;
  } | null;
  /**
   * A full-member-set rollup of this employee's workload: every active member
   * PLUS any terminal (failed) delegation whose live beat still signals a
   * resource/failure issue. `total` >= `activeCount` and is never below the sum
   * of the grouped counts; the drilldown drawer + office markers read it.
   */
  readonly workloadSummary: WorkloadSummary;
}

interface EmployeeWorkloadChip {
  readonly runId: string;
  readonly label: string;
  readonly tone: 'work' | 'wait' | 'risk' | 'done';
}

/**
 * One member run that carries an issue signal worth surfacing (a resource
 * strain, a flow failure, or a pending approval). `terminal` marks a
 * live-issue-terminal member: a failed delegation whose beat is still live, kept
 * in the rollup even though it no longer counts toward `activeCount`.
 */
export interface WorkloadPriorityIssue {
  readonly runId: string;
  readonly kind: 'resource' | 'failure' | 'approval' | 'blocked';
  readonly label: string;
  readonly severity: SurfacedResourceSeverity;
  readonly terminal: boolean;
}

/**
 * The full-member-set rollup for one employee. `total` = size of the member set
 * (active members + live-issue-terminal members). `byWorkKind` and `byStatus`
 * each partition the member set (their values sum to `total`), so a caller can
 * trust either grouping as a complete, non-overlapping breakdown.
 */
export interface WorkloadSummary {
  readonly total: number;
  readonly byWorkKind: Readonly<Record<string, number>>;
  readonly byStatus: Readonly<Record<'working' | 'waiting' | 'blocked' | 'artifact', number>>;
  readonly priorityIssues: readonly WorkloadPriorityIssue[];
  readonly artifactCount: number;
  readonly approvalCount: number;
}

function workloadChipFor(
  runId: string,
  waiting: boolean,
  beat: SceneBeat | null,
): EmployeeWorkloadChip {
  if (waiting) return { runId, label: 'Approval', tone: 'wait' };
  if (!beat) return { runId, label: 'Work', tone: 'work' };
  if (beat.resource) return { runId, label: beat.resource.label, tone: 'risk' };
  if (beat.artifact) return { runId, label: 'Artifact', tone: 'done' };
  if (beat.visual.badges.length > 0) {
    const label = beat.visual.badges[0] ?? 'Work';
    return { runId, label: `${label.charAt(0).toUpperCase()}${label.slice(1)}`, tone: 'work' };
  }
  const fallback =
    beat.visual.phase === 'read'
      ? 'Read'
      : beat.visual.phase === 'compute'
        ? 'Compute'
        : beat.visual.phase === 'review'
          ? 'Review'
          : beat.visual.phase === 'wait'
            ? 'Wait'
            : beat.visual.phase === 'complete'
              ? 'Done'
              : 'Work';
  return { runId, label: fallback, tone: fallback === 'Done' ? 'done' : 'work' };
}

/** A member run of an employee's workload, joined to its live beat (or null). */
interface WorkloadMember {
  readonly runId: string;
  /** The run is awaiting approval / waiting for the user. */
  readonly waiting: boolean;
  /** A live-issue-terminal member: a failed delegation kept for its live beat. */
  readonly terminal: boolean;
  readonly beat: SceneBeat | null;
}

const UNCLASSIFIED_WORK_KIND = 'unclassified';

/** A beat's resource strain is blocking when exhausted or hard-blocked. */
function isBlockingResource(beat: SceneBeat | null): boolean {
  return beat?.resource?.severity === 'blocked' || beat?.resource?.severity === 'exhausted';
}

/** A beat carries a flow-level failure. */
function isFailureFlow(beat: SceneBeat | null): boolean {
  return beat?.flow?.kind === 'failure';
}

/** A live beat that signals a resource strain (any severity) or a flow failure. */
function hasLiveIssueBeat(beat: SceneBeat | null): boolean {
  return beat != null && (beat.resource != null || isFailureFlow(beat));
}

/**
 * Rank an issue kind for sorting: resource/failure outrank blocked, which
 * outranks approval. Higher wins.
 */
function issueKindRank(kind: WorkloadPriorityIssue['kind']): number {
  switch (kind) {
    case 'resource':
    case 'failure':
      return 3;
    case 'blocked':
      return 2;
    case 'approval':
      return 1;
  }
}

/**
 * The priority issue a member's live beat signals, or null when the member is
 * a plain working run. Resource strain (any severity) and flow failures always
 * surface; a waiting/approval member surfaces an `approval` issue.
 */
function priorityIssueForMember(member: WorkloadMember): WorkloadPriorityIssue | null {
  const beat = member.beat;
  const issue: Pick<WorkloadPriorityIssue, 'kind' | 'label' | 'severity'> | null = beat?.resource
    ? {
        kind: 'resource',
        label: beat.resource.label,
        severity: surfacedResourceSeverity(beat.resource.severity),
      }
    : isFailureFlow(beat)
      ? { kind: 'failure', label: beat?.flow?.label ?? 'Failure', severity: 'blocked' }
      : member.waiting
        ? { kind: 'approval', label: 'Approval', severity: 'warning' }
        : null;
  return issue ? { runId: member.runId, ...issue, terminal: member.terminal } : null;
}

/**
 * Bucket a member into exactly one status lane. Overlap resolves by the fixed
 * priority blocked > artifact > waiting > working, so the four lane counts sum
 * to the member-set size.
 */
function statusBucketForMember(
  member: WorkloadMember,
): 'working' | 'waiting' | 'blocked' | 'artifact' {
  if (isBlockingResource(member.beat) || isFailureFlow(member.beat)) return 'blocked';
  if (member.beat?.artifact) return 'artifact';
  if (member.waiting) return 'waiting';
  return 'working';
}

/** Roll a full member set up into the employee's workloadSummary. */
function summarizeWorkload(members: readonly WorkloadMember[]): WorkloadSummary {
  const byWorkKind: Record<string, number> = {};
  const byStatus: Record<'working' | 'waiting' | 'blocked' | 'artifact', number> = {
    working: 0,
    waiting: 0,
    blocked: 0,
    artifact: 0,
  };
  const priorityIssues: WorkloadPriorityIssue[] = [];
  let artifactCount = 0;
  let approvalCount = 0;

  for (const member of members) {
    const workKind = member.beat?.workKind ?? UNCLASSIFIED_WORK_KIND;
    byWorkKind[workKind] = (byWorkKind[workKind] ?? 0) + 1;
    byStatus[statusBucketForMember(member)] += 1;
    if (member.beat?.artifact) artifactCount += 1;
    if (member.waiting) approvalCount += 1;
    const issue = priorityIssueForMember(member);
    if (issue) priorityIssues.push(issue);
  }

  priorityIssues.sort((a, b) => {
    const kindDelta = issueKindRank(b.kind) - issueKindRank(a.kind);
    if (kindDelta !== 0) return kindDelta;
    const severityDelta = resourceSeverityRank(b.severity) - resourceSeverityRank(a.severity);
    if (severityDelta !== 0) return severityDelta;
    return a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0;
  });

  return {
    total: members.length,
    byWorkKind,
    byStatus,
    priorityIssues,
    artifactCount,
    approvalCount,
  };
}

/**
 * Rank an issue member for dominant selection: resource strain (by severity) and
 * flow failures share the top band, an approval-only member ranks below them.
 * Non-issue members return 0.
 */
function dominantIssueRank(member: WorkloadMember): number {
  if (member.beat?.resource) {
    return 10 + resourceSeverityRank(surfacedResourceSeverity(member.beat.resource.severity));
  }
  if (isFailureFlow(member.beat)) return 10; // failure ranks with the resource band
  if (member.waiting) return 1; // pending approval — the lowest issue band
  return 0;
}

/**
 * Select the dominant run the office performs. When any member signals an issue
 * (a live resource / flow.failure beat, OR a waiting-approval member), the
 * highest-ranked issue member wins so a blocked/exhausted actor no longer renders
 * a normal working state. A resource/failure issue always overrides; a plain
 * working member still outranks a bare approval (a sibling awaiting approval
 * never downgrades an employee already working). Otherwise the pre-existing
 * working>waiting + lexical tie-break holds.
 */
function selectDominant(
  members: readonly WorkloadMember[],
  fallbackRunId: string | null,
  fallbackState: 'working' | 'waiting',
): { runId: string; state: 'working' | 'waiting'; beat: SceneBeat | null } | null {
  // A real issue (resource / failure) overrides the working preference; a bare
  // approval only wins when the employee has nothing plainly working to keep
  // performing (fallbackState is already 'waiting' in that case).
  // Terminal (failed) members are excluded from dominant selection: a dead run
  // must never become the office's performed actor and override a still-running
  // sibling. Terminal-child visibility is routed through priorityIssues / the
  // rollup instead (PRD: dominant is scoped to active, unresolved work).
  const hardIssueMembers = members.filter(
    (m) => !m.terminal && hasLiveIssueBeat(m.beat) && dominantIssueRank(m) >= 10,
  );
  const issueMembers =
    hardIssueMembers.length > 0
      ? hardIssueMembers
      : fallbackState === 'waiting'
        ? members.filter((m) => m.waiting)
        : [];

  if (issueMembers.length > 0) {
    const chosen = [...issueMembers].sort((a, b) => {
      const delta = dominantIssueRank(b) - dominantIssueRank(a);
      if (delta !== 0) return delta;
      return a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0;
    })[0];
    if (chosen) {
      const isApproval = chosen.waiting && !hasLiveIssueBeat(chosen.beat);
      return { runId: chosen.runId, state: isApproval ? 'waiting' : 'working', beat: chosen.beat };
    }
  }
  return fallbackRunId
    ? {
        runId: fallbackRunId,
        state: fallbackState,
        beat: members.find((m) => m.runId === fallbackRunId)?.beat ?? null,
      }
    : null;
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
  // `terminalIssue` = failed delegations whose beat is still live with a resource
  // or flow.failure signal. They join the member-set rollup (total / priority
  // issues) but NEVER the active counts (activeRunIds / activeCount / waiting).
  const acc = new Map<string, { working: string[]; waiting: string[]; terminalIssue: string[] }>();
  if (!projectId) return new Map();

  const add = (
    employeeId: string,
    runId: string,
    bucket: 'working' | 'waiting' | 'terminalIssue',
  ) => {
    let entry = acc.get(employeeId);
    if (!entry) {
      entry = { working: [], waiting: [], terminalIssue: [] };
      acc.set(employeeId, entry);
    }
    entry[bucket].push(runId);
  };

  // Memoize per projection call: a failed delegation's beat is probed once in the
  // scan loop and reused when its member is built, so beatForRun runs at most once
  // per runId even on the warm office-render path.
  const beatCache = new Map<string, SceneBeat | null>();
  const liveBeat = (runId: string): SceneBeat | null => {
    if (beatCache.has(runId)) return beatCache.get(runId) ?? null;
    const resolved = beatForRun?.(runId) ?? null;
    beatCache.set(runId, resolved);
    return resolved;
  };

  for (const run of snapshot.runs) {
    if (run.projectId !== projectId) continue;
    const rootActive = isConversationRunActive(run.phase);
    if (rootActive && run.employeeId && run.attemptId) {
      add(run.employeeId, run.attemptId, run.phase === 'awaiting-approval' ? 'waiting' : 'working');
    } else if (
      run.phase === 'failed' &&
      run.employeeId &&
      run.attemptId &&
      hasLiveIssueBeat(liveBeat(run.attemptId))
    ) {
      // A failed ROOT run whose failure beat is still live keeps its employee
      // on the board exactly like a failed delegation does — the actor marker,
      // bubble, and drilldown must show the blocked state (PRD), not have the
      // employee silently drop out of the workload map.
      add(run.employeeId, run.attemptId, 'terminalIssue');
    }
    for (const delegation of run.delegations) {
      if (!delegation.employeeId) continue;
      if (delegation.state === 'running') {
        // Delegated child runs still in flight light up their teammate too — this
        // is what makes the office show multiple agents working in parallel. Only
        // an active root contributes in-flight children; a dead root's "running"
        // child is treated as orphaned and not surfaced as active work.
        if (rootActive) add(delegation.employeeId, delegation.runId, 'working');
      } else if (delegation.state === 'failed' && hasLiveIssueBeat(liveBeat(delegation.runId))) {
        // A just-failed delegation whose beat still carries a live resource/failure
        // signal stays visible as a live-issue-terminal member (beats expire ~120s),
        // even after its own root run has finished — PRD terminal-child visibility.
        add(delegation.employeeId, delegation.runId, 'terminalIssue');
      }
    }
  }

  const out = new Map<string, EmployeeWorkloadProjection>();
  for (const [employeeId, { working, waiting, terminalIssue }] of acc) {
    const isWorking = working.length > 0;
    const pool = isWorking ? working : waiting;
    const state: 'working' | 'waiting' = isWorking ? 'working' : 'waiting';
    // pool is a freshly-built local array (working/waiting), safe to sort in place
    // for a deterministic tie-break; activeRunIds is a separate new array.
    const fallbackRunId = pool.sort()[0] ?? null;
    const activeRunIds = [...working, ...waiting];
    const waitingSet = new Set(waiting);
    // Every member (active + live-issue-terminal) joined to its live beat once.
    const members: WorkloadMember[] = [
      ...activeRunIds.map((runId) => ({
        runId,
        waiting: waitingSet.has(runId),
        terminal: false,
        beat: liveBeat(runId),
      })),
      ...terminalIssue.map((runId) => ({
        runId,
        waiting: false,
        terminal: true,
        beat: liveBeat(runId),
      })),
    ];
    const beatByRun = new Map(members.map((m) => [m.runId, m.beat] as const));
    out.set(employeeId, {
      employeeId,
      activeRunIds,
      activeCount: activeRunIds.length,
      waitingCount: waiting.length,
      workloadChips: activeRunIds
        .map((activeRunId) =>
          workloadChipFor(
            activeRunId,
            waitingSet.has(activeRunId),
            beatByRun.get(activeRunId) ?? null,
          ),
        )
        .slice(0, 3),
      dominant: selectDominant(members, fallbackRunId, state),
      workloadSummary: summarizeWorkload(members),
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
