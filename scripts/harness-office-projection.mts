/**
 * Office projection gate (Phase 4 core, source plan §6 / §13).
 *
 * Locks the "office moves only for high-value beats" invariant end-to-end:
 * a timestamped AgentRunEvent stream → composeBeats → projectOfficeStaging
 * against a real prefab office yields per-employee performance, and a reserved
 * relocation anchor ONLY for high-value movement beats (delegate / plan / join /
 * complete) — micro-action beats (read / write / inspect) change performance in
 * place with no anchor, and approval/failure react in place. Deterministic, so
 * 2D and 3D direct the same actor to the same place.
 *
 * Pure Node via tsx against shared-types source — no DOM, no renderer, no Pi.
 */
import type { SceneBeat } from '../packages/shared-types/src/index.js';
import {
  type StagingPrefab,
  type TimedAgentRunEvent,
  composeBeats,
  performanceForBeat,
  projectOfficeStaging,
} from '../packages/shared-types/src/index.js';
import type {
  ConversationRunSnapshot,
  ConversationRunsSnapshot,
} from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.js';
import { projectEmployeeWorkloads } from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-projections.js';

let failures = 0;
let checks = 0;
function check(name: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const THREAD = 'thread-1';
const ROOT = 'root-1';
const CONFIG = { dramaturgyVersion: 'v1' };

interface Scope {
  runId: string;
  parentRunId?: string;
  employeeId?: string;
  relation?: TimedAgentRunEvent['relation'];
  workKind?: TimedAgentRunEvent['workKind'];
}
const started = (at: number, s: Scope): TimedAgentRunEvent => ({
  threadId: THREAD,
  rootRunId: ROOT,
  ...s,
  type: 'run.started',
  payload: { objective: 'x', access: 'write' },
  timestamp: at,
});
const finished = (at: number, s: Scope): TimedAgentRunEvent => ({
  threadId: THREAD,
  rootRunId: ROOT,
  ...s,
  type: 'run.completed',
  payload: { status: 'completed' },
  timestamp: at,
});
const tool = (at: number, s: Scope, toolName: string): TimedAgentRunEvent => ({
  threadId: THREAD,
  rootRunId: ROOT,
  ...s,
  type: 'tool.started',
  payload: { toolCallId: `${s.runId}:${at}`, toolName, status: 'started' },
  timestamp: at,
});
const approval = (at: number, s: Scope): TimedAgentRunEvent => ({
  threadId: THREAD,
  rootRunId: ROOT,
  ...s,
  type: 'approval.requested',
  payload: { uiRequestId: `${s.runId}:a`, title: 'ok?' },
  timestamp: at,
});
const prefab = (instanceId: string, prefabId: string, x = 0, z = 0): StagingPrefab => ({
  instanceId,
  prefabId,
  x,
  z,
  rotation: 0,
});

console.log('office-projection gate');

const office: StagingPrefab[] = [
  prefab('w1', 'workstation-standard', -4, 0),
  prefab('w2', 'workstation-standard', -2, 0),
  prefab('stand', 'standing-table', 2, 0), // standing-review anchors
  prefab('wb', 'whiteboard', 4, 0), // board-presenter
  prefab('m', 'meeting-table-4', 0, -4), // meeting-seats
];

// Each employee's LAST beat determines their current scene direction.
const stream: TimedAgentRunEvent[] = [
  started(0, { runId: ROOT }), // director root, no employee
  // mover: a fresh delegation, nothing after → current beat = delegate (movement)
  started(100, { runId: 'd1', parentRunId: ROOT, employeeId: 'mover', relation: 'delegate' }),
  // worker: delegated, then writing → current beat = produce (micro, in place)
  started(150, { runId: 'd2', parentRunId: ROOT, employeeId: 'worker', relation: 'delegate' }),
  tool(400, { runId: 'd2', employeeId: 'worker' }, 'write_file'),
  // researcher: delegated, then reading → current beat = research (micro, in place)
  started(160, { runId: 'd3', parentRunId: ROOT, employeeId: 'researcher', relation: 'delegate' }),
  tool(420, { runId: 'd3', employeeId: 'researcher' }, 'read_file'),
  // waiter: delegated, then approval → current beat = approval (in place)
  started(170, { runId: 'd4', parentRunId: ROOT, employeeId: 'waiter', relation: 'delegate' }),
  approval(500, { runId: 'd4', employeeId: 'waiter' }),
  // finisher: delegated, then completed well past the movement cooldown so the
  // join beat is a real relocation (a quick start→complete would correctly
  // downgrade to in-place under the 8s movement cooldown).
  started(180, { runId: 'd5', parentRunId: ROOT, employeeId: 'finisher', relation: 'review' }),
  finished(9000, { runId: 'd5', parentRunId: ROOT, employeeId: 'finisher' }),
];

const beats = composeBeats(stream, CONFIG);
const staging = projectOfficeStaging(beats, office);
const byEmp = new Map(staging.map((s) => [s.employeeId, s]));

console.log('\n[high-value movement]');
check(
  'mover (delegate) relocates',
  byEmp.get('mover')?.staging != null && byEmp.get('mover')?.beat.kind === 'delegate',
);
check(
  'finisher (join) relocates',
  byEmp.get('finisher')?.staging != null && byEmp.get('finisher')?.beat.kind === 'join',
);

console.log('\n[micro-action stays home]');
check(
  'worker (produce) does NOT relocate',
  byEmp.get('worker')?.staging === null && byEmp.get('worker')?.beat.kind === 'produce',
);
check(
  'researcher (research) does NOT relocate',
  byEmp.get('researcher')?.staging === null && byEmp.get('researcher')?.beat.kind === 'research',
);
check(
  'waiter (approval) reacts in place',
  byEmp.get('waiter')?.staging === null && byEmp.get('waiter')?.beat.kind === 'approval',
);

console.log('\n[invariant] only movement beats relocate');
{
  const staged = staging.filter((s) => s.staging !== null);
  check(
    'exactly the movement-beat employees are staged',
    staged.every((s) => s.beat.movement) && staged.length === 2,
    `staged ${staged.length}`,
  );
  check('director root is not an actor', !byEmp.has(ROOT));
}

console.log('\n[performance] matches performanceForBeat');
check(
  'worker performance is type (produce/write)',
  byEmp.get('worker')?.performance.workGesture === 'type',
);
check(
  'researcher performance is read',
  byEmp.get('researcher')?.performance.workGesture === 'read',
);
check(
  'waiter performance is worried (approval)',
  byEmp.get('waiter')?.performance.expression === 'worried',
);
check(
  'performance equals performanceForBeat(beat)',
  staging.every(
    (s) => JSON.stringify(s.performance) === JSON.stringify(performanceForBeat(s.beat)),
  ),
);

console.log('\n[determinism]');
{
  const a = JSON.stringify(projectOfficeStaging(composeBeats(stream, CONFIG), office));
  const b = JSON.stringify(
    projectOfficeStaging(composeBeats([...stream].reverse(), CONFIG), office),
  );
  check('same stream → identical office projection (order-independent)', a === b);
}

// ---------------------------------------------------------------------------
// projectEmployeeWorkloads — workloadSummary / priorityIssues / dominant (INC-2)
//
// Oracle for the renderer projection rollup: total = full member set (active +
// live-issue-terminal), byWorkKind and byStatus each partition it (each summing
// to total), a blocked/exhausted beat drives the dominant, a FAILED delegation
// with a live failure/resource beat survives in priorityIssues (terminal true)
// without inflating activeCount, and no-live-beat members still count.
// ---------------------------------------------------------------------------
console.log('\n[workload summary] projectEmployeeWorkloads rollup');

const PRJ = 'prj';

/** A minimal complete SceneBeat with only the fields the rollup reads set. */
function beat(
  runId: string,
  over: Partial<
    Pick<SceneBeat, 'workKind' | 'flow' | 'artifact' | 'resource' | 'employeeId'>
  > = {},
): SceneBeat {
  return {
    id: `beat-${runId}`,
    kind: 'activity',
    priority: 10,
    threadId: THREAD,
    rootRunId: ROOT,
    runId,
    employeeId: over.employeeId ?? null,
    workKind: over.workKind ?? null,
    activityKind: null,
    affordance: null,
    movement: false,
    parallel: false,
    interrupt: false,
    variant: 0,
    visual: {
      phase: 'produce',
      intensity: 1,
      emotion: 'neutral',
      affordance: null,
      badges: [],
    },
    flow: over.flow ?? null,
    artifact: over.artifact ?? null,
    resource: over.resource ?? null,
    at: 0,
    lifecycle: { startedAt: 0, endsAt: 1_000 },
  };
}

function runSnapshot(over: Partial<ConversationRunSnapshot>): ConversationRunSnapshot {
  return {
    threadId: over.threadId ?? THREAD,
    companyId: 'co',
    projectId: PRJ,
    attemptId: over.attemptId ?? null,
    phase: over.phase ?? 'running',
    employeeId: over.employeeId ?? null,
    source: 'office',
    liveMessages: [],
    activity: [],
    activityTotal: 0,
    delegations: over.delegations ?? [],
    approval: null,
    error: null,
  };
}

function snapshot(runs: ConversationRunSnapshot[]): ConversationRunsSnapshot {
  return { runs, activeRuns: runs, pendingApprovals: [] };
}

const sum = (record: Readonly<Record<string, number>>): number =>
  Object.values(record).reduce((a, b) => a + b, 0);

// --- 1 active run → total 1 -------------------------------------------------
{
  const snap = snapshot([
    runSnapshot({ attemptId: 'a1', employeeId: 'e-solo', phase: 'running' }),
  ]);
  const w = projectEmployeeWorkloads(snap, PRJ).get('e-solo');
  check('1 active run → activeCount 1', w?.activeCount === 1, `got ${w?.activeCount}`);
  check('1 active run → summary.total 1', w?.workloadSummary.total === 1, `got ${w?.workloadSummary.total}`);
}

// --- 3 active runs (1 direct + 2 running delegations) → total 3 -------------
{
  const snap = snapshot([
    runSnapshot({
      attemptId: 'a3',
      employeeId: 'e-lead',
      phase: 'running',
      delegations: [
        { runId: 'd-a', parentRunId: 'a3', employeeId: 'e-lead', objective: 'x', state: 'running' },
        { runId: 'd-b', parentRunId: 'a3', employeeId: 'e-lead', objective: 'y', state: 'running' },
      ],
    }),
  ]);
  const w = projectEmployeeWorkloads(snap, PRJ).get('e-lead');
  check('3 members → activeCount 3', w?.activeCount === 3, `got ${w?.activeCount}`);
  check('3 members → summary.total 3', w?.workloadSummary.total === 3, `got ${w?.workloadSummary.total}`);
}

// --- 58 members → total 58 AND both groupings sum to 58 ---------------------
{
  const N = 58; // distinct expected number, not derived from the arrays below
  const delegations = Array.from({ length: N - 1 }, (_v, i) => ({
    runId: `big-d-${String(i).padStart(3, '0')}`,
    parentRunId: 'a58',
    employeeId: 'e-big',
    objective: 'o',
    state: 'running' as const,
  }));
  const snap = snapshot([
    runSnapshot({ attemptId: 'a58', employeeId: 'e-big', phase: 'running', delegations }),
  ]);
  // Half the members carry a workKind beat, the rest have NO live beat at all,
  // so both byWorkKind (unclassified bucket) and byStatus must still sum to 58.
  const kinds = ['implement', 'research', 'review'] as const;
  const beatFor = (runId: string): SceneBeat | null => {
    const idx = Number(runId.slice(-3));
    if (Number.isNaN(idx) || idx % 2 === 1) return runId === 'a58' ? null : null; // odd → no beat
    return beat(runId, { workKind: kinds[idx % kinds.length] });
  };
  const w = projectEmployeeWorkloads(snap, PRJ, beatFor).get('e-big');
  check('58 members → summary.total 58', w?.workloadSummary.total === 58, `got ${w?.workloadSummary.total}`);
  check(
    '58 members → sum(byWorkKind) === 58',
    w != null && sum(w.workloadSummary.byWorkKind) === 58,
    `got ${w ? sum(w.workloadSummary.byWorkKind) : 'n/a'}`,
  );
  check(
    '58 members → sum(byStatus) === 58',
    w != null && sum(w.workloadSummary.byStatus) === 58,
    `got ${w ? sum(w.workloadSummary.byStatus) : 'n/a'}`,
  );
  check(
    '58 members → activeCount 58 (never below total)',
    w?.activeCount === 58 && w.workloadSummary.total >= w.activeCount,
    `activeCount ${w?.activeCount}`,
  );
}

// --- blocked/exhausted beat drives the dominant over a plain working sibling -
{
  const snap = snapshot([
    runSnapshot({
      attemptId: 'w-normal', // lexically first, would win the old tie-break
      employeeId: 'e-block',
      phase: 'running',
      delegations: [
        { runId: 'z-blocked', parentRunId: 'w-normal', employeeId: 'e-block', objective: 'q', state: 'running' },
      ],
    }),
  ]);
  const blockedBeat = beat('z-blocked', {
    workKind: 'compute',
    resource: { kind: 'token', severity: 'exhausted', label: 'Token budget spent' },
  });
  const beatFor = (runId: string): SceneBeat | null =>
    runId === 'z-blocked' ? blockedBeat : runId === 'w-normal' ? beat('w-normal', { workKind: 'implement' }) : null;
  const w = projectEmployeeWorkloads(snap, PRJ, beatFor).get('e-block');
  check(
    'blocked beat outranks working → dominant is the blocked run',
    w?.dominant?.runId === 'z-blocked' && w.dominant.beat === blockedBeat,
    `dominant ${w?.dominant?.runId}`,
  );
  check(
    'blocked member lands in byStatus.blocked (=1)',
    w?.workloadSummary.byStatus.blocked === 1,
    `blocked ${w?.workloadSummary.byStatus.blocked}`,
  );
  check(
    'blocked resource issue is exhausted severity',
    w?.workloadSummary.priorityIssues[0]?.severity === 'exhausted',
    `sev ${w?.workloadSummary.priorityIssues[0]?.severity}`,
  );
}

// --- FAILED delegation with a live failure beat: priorityIssues terminal true,
//     excluded from activeCount -----------------------------------------------
{
  const snap = snapshot([
    runSnapshot({
      attemptId: 'root-f',
      employeeId: 'e-fail',
      phase: 'running',
      delegations: [
        { runId: 'child-failed', parentRunId: 'root-f', employeeId: 'e-fail', objective: 'boom', state: 'failed' },
      ],
    }),
  ]);
  const failBeat = beat('child-failed', {
    flow: { kind: 'failure', label: 'Build failed', target: 'workstation', pulse: true },
  });
  const beatFor = (runId: string): SceneBeat | null =>
    runId === 'child-failed' ? failBeat : runId === 'root-f' ? beat('root-f', { workKind: 'implement' }) : null;
  const w = projectEmployeeWorkloads(snap, PRJ, beatFor).get('e-fail');
  // root-f is the only ACTIVE member; the failed child joins only the rollup.
  check(
    'failed-with-live-beat: activeCount excludes it (=1)',
    w?.activeCount === 1,
    `activeCount ${w?.activeCount}`,
  );
  check(
    'failed-with-live-beat: summary.total includes it (=2)',
    w?.workloadSummary.total === 2,
    `total ${w?.workloadSummary.total}`,
  );
  const termIssue = w?.workloadSummary.priorityIssues.find((i) => i.runId === 'child-failed');
  check(
    'failed-with-live-beat: priorityIssue present with terminal true',
    termIssue?.kind === 'failure' && termIssue.terminal === true,
    `issue ${JSON.stringify(termIssue)}`,
  );
  check(
    'failed-with-live-beat: total >= activeCount',
    w != null && w.workloadSummary.total >= w.activeCount,
  );
}

// --- terminal member must NOT win dominant over an active running sibling ----
{
  const snap = snapshot([
    runSnapshot({
      attemptId: 'root-live',
      employeeId: 'e-mix2',
      phase: 'running',
      delegations: [
        // An active, currently-running child with a plain beat (issue rank 0)...
        { runId: 'child-running', parentRunId: 'root-live', employeeId: 'e-mix2', objective: 'go', state: 'running' },
        // ...and a DEAD failed child whose beat still carries a live failure (rank 10).
        { runId: 'child-dead', parentRunId: 'root-live', employeeId: 'e-mix2', objective: 'boom', state: 'failed' },
      ],
    }),
  ]);
  const deadBeat = beat('child-dead', {
    flow: { kind: 'failure', label: 'Build failed', target: 'workstation', pulse: true },
  });
  const beatFor = (runId: string): SceneBeat | null =>
    runId === 'child-dead'
      ? deadBeat
      : runId === 'child-running'
        ? beat('child-running', { workKind: 'implement' })
        : runId === 'root-live'
          ? beat('root-live', { workKind: 'coordinate' })
          : null;
  const w = projectEmployeeWorkloads(snap, PRJ, beatFor).get('e-mix2');
  // The dominant the office PERFORMS must be an active member, never the dead run.
  check(
    'terminal failed member does NOT become dominant over an active sibling',
    w?.dominant?.runId !== 'child-dead' && w?.dominant?.beat !== deadBeat,
    `dominant ${w?.dominant?.runId}`,
  );
  // But the dead child is still visible in the rollup as a terminal issue.
  check(
    'terminal failed member still surfaces in priorityIssues (terminal true)',
    w?.workloadSummary.priorityIssues.some((i) => i.runId === 'child-dead' && i.terminal === true) === true,
    `issues ${JSON.stringify(w?.workloadSummary.priorityIssues)}`,
  );
}

// --- failed child stays visible even after its ROOT run has finished ---------
{
  const snap = snapshot([
    runSnapshot({
      attemptId: 'root-done',
      employeeId: 'e-late',
      phase: 'completed', // root is NO LONGER active
      delegations: [
        { runId: 'late-fail', parentRunId: 'root-done', employeeId: 'e-late', objective: 'boom', state: 'failed' },
      ],
    }),
  ]);
  const lateBeat = beat('late-fail', {
    flow: { kind: 'failure', label: 'Crashed', target: 'workstation', pulse: true },
  });
  const beatFor = (runId: string): SceneBeat | null => (runId === 'late-fail' ? lateBeat : null);
  const w = projectEmployeeWorkloads(snap, PRJ, beatFor).get('e-late');
  check(
    'terminal-root failed child with live beat still projects an employee entry',
    w != null,
    `entry ${w == null ? 'missing' : 'present'}`,
  );
  check(
    'terminal-root failed child: activeCount 0 but total 1 (visible issue)',
    w?.activeCount === 0 && w.workloadSummary.total === 1,
    `activeCount ${w?.activeCount} total ${w?.workloadSummary.total}`,
  );
  check(
    'terminal-root failed child appears in priorityIssues (terminal true)',
    w?.workloadSummary.priorityIssues.some((i) => i.runId === 'late-fail' && i.terminal === true) === true,
    `issues ${JSON.stringify(w?.workloadSummary.priorityIssues)}`,
  );
}

// --- FAILED delegation WITHOUT a live beat is dropped entirely ---------------
{
  const snap = snapshot([
    runSnapshot({
      attemptId: 'root-g',
      employeeId: 'e-drop',
      phase: 'running',
      delegations: [
        { runId: 'child-gone', parentRunId: 'root-g', employeeId: 'e-drop', objective: 'z', state: 'failed' },
      ],
    }),
  ]);
  // beatFor returns null for the failed child → it is NOT a live-issue member.
  const beatFor = (runId: string): SceneBeat | null =>
    runId === 'root-g' ? beat('root-g', { workKind: 'implement' }) : null;
  const w = projectEmployeeWorkloads(snap, PRJ, beatFor).get('e-drop');
  check(
    'failed-without-beat: dropped from the rollup (total 1)',
    w?.activeCount === 1 && w.workloadSummary.total === 1,
    `activeCount ${w?.activeCount} total ${w?.workloadSummary.total}`,
  );
}

// --- no-live-beat member → unclassified byWorkKind, total >= activeCount -----
{
  const snap = snapshot([
    runSnapshot({ attemptId: 'nb1', employeeId: 'e-nobeat', phase: 'running' }),
  ]);
  // beatForRun supplied but returns null for this run: a no-live-beat member.
  const w = projectEmployeeWorkloads(snap, PRJ, () => null).get('e-nobeat');
  check(
    'no-live-beat member → unclassified byWorkKind (=1)',
    w?.workloadSummary.byWorkKind.unclassified === 1,
    `unclassified ${w?.workloadSummary.byWorkKind.unclassified}`,
  );
  check(
    'no-live-beat member → falls into a byStatus bucket (working =1)',
    w?.workloadSummary.byStatus.working === 1 && sum(w.workloadSummary.byStatus) === 1,
    `working ${w?.workloadSummary.byStatus.working}`,
  );
  check(
    'no-live-beat member → total (1) >= activeCount (1)',
    w != null && w.workloadSummary.total === 1 && w.workloadSummary.total >= w.activeCount,
  );
}

// --- approvalCount / artifactCount reflect injected beats --------------------
{
  const snap = snapshot([
    // Two members awaiting approval + two producing an artifact = 4 members.
    runSnapshot({ attemptId: 'ap1', employeeId: 'e-mix', phase: 'awaiting-approval' }),
    runSnapshot({
      attemptId: 'ap-root',
      employeeId: 'e-mix',
      phase: 'awaiting-approval',
      delegations: [
        { runId: 'art-1', parentRunId: 'ap-root', employeeId: 'e-mix', objective: 'a', state: 'running' },
        { runId: 'art-2', parentRunId: 'ap-root', employeeId: 'e-mix', objective: 'b', state: 'running' },
      ],
    }),
  ]);
  // ap1 + ap-root are awaiting-approval (2 approvals); art-1 + art-2 carry an
  // artifact beat (2 artifacts). Distinct expected numbers: approvals 2 !== artifacts 2
  // but they come from different members, and total is 4.
  const artifactBeat = (runId: string): SceneBeat =>
    beat(runId, { workKind: 'publish', artifact: { title: 'Report', kind: 'doc' } });
  const beatFor = (runId: string): SceneBeat | null =>
    runId === 'art-1' || runId === 'art-2' ? artifactBeat(runId) : null;
  const w = projectEmployeeWorkloads(snap, PRJ, beatFor).get('e-mix');
  check('mixed rollup → total 4', w?.workloadSummary.total === 4, `total ${w?.workloadSummary.total}`);
  check(
    'approvalCount reflects the 2 awaiting-approval members',
    w?.workloadSummary.approvalCount === 2,
    `approvalCount ${w?.workloadSummary.approvalCount}`,
  );
  check(
    'artifactCount reflects the 2 artifact beats',
    w?.workloadSummary.artifactCount === 2,
    `artifactCount ${w?.workloadSummary.artifactCount}`,
  );
  check(
    'byStatus partitions the 4 members (waiting 2 + artifact 2)',
    w?.workloadSummary.byStatus.waiting === 2 &&
      w.workloadSummary.byStatus.artifact === 2 &&
      sum(w.workloadSummary.byStatus) === 4,
    `byStatus ${JSON.stringify(w?.workloadSummary.byStatus)}`,
  );
}

console.log(`\noffice-projection: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`office-projection gate FAILED with ${failures} failure(s)`);
  process.exit(1);
}
console.log('office-projection gate PASSED');
