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
import {
  type StagingPrefab,
  type TimedAgentRunEvent,
  composeBeats,
  performanceForBeat,
  projectOfficeStaging,
} from '../packages/shared-types/src/index.js';

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
const started = (at: number, s: Scope): TimedAgentRunEvent => ({ threadId: THREAD, rootRunId: ROOT, ...s, type: 'run.started', payload: { objective: 'x', access: 'write' }, timestamp: at });
const finished = (at: number, s: Scope): TimedAgentRunEvent => ({ threadId: THREAD, rootRunId: ROOT, ...s, type: 'run.completed', payload: { status: 'completed' }, timestamp: at });
const tool = (at: number, s: Scope, toolName: string): TimedAgentRunEvent => ({ threadId: THREAD, rootRunId: ROOT, ...s, type: 'tool.started', payload: { toolCallId: `${s.runId}:${at}`, toolName, status: 'started' }, timestamp: at });
const approval = (at: number, s: Scope): TimedAgentRunEvent => ({ threadId: THREAD, rootRunId: ROOT, ...s, type: 'approval.requested', payload: { uiRequestId: `${s.runId}:a`, title: 'ok?' }, timestamp: at });
const prefab = (instanceId: string, prefabId: string, x = 0, z = 0): StagingPrefab => ({ instanceId, prefabId, x, z, rotation: 0 });

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
check('mover (delegate) relocates', byEmp.get('mover')?.staging != null && byEmp.get('mover')?.beat.kind === 'delegate');
check('finisher (join) relocates', byEmp.get('finisher')?.staging != null && byEmp.get('finisher')?.beat.kind === 'join');

console.log('\n[micro-action stays home]');
check('worker (produce) does NOT relocate', byEmp.get('worker')?.staging === null && byEmp.get('worker')?.beat.kind === 'produce');
check('researcher (research) does NOT relocate', byEmp.get('researcher')?.staging === null && byEmp.get('researcher')?.beat.kind === 'research');
check('waiter (approval) reacts in place', byEmp.get('waiter')?.staging === null && byEmp.get('waiter')?.beat.kind === 'approval');

console.log('\n[invariant] only movement beats relocate');
{
  const staged = staging.filter((s) => s.staging !== null);
  check('exactly the movement-beat employees are staged', staged.every((s) => s.beat.movement) && staged.length === 2, `staged ${staged.length}`);
  check('director root is not an actor', !byEmp.has(ROOT));
}

console.log('\n[performance] matches performanceForBeat');
check('worker performance is type (produce/write)', byEmp.get('worker')?.performance.workGesture === 'type');
check('researcher performance is read', byEmp.get('researcher')?.performance.workGesture === 'read');
check('waiter performance is worried (approval)', byEmp.get('waiter')?.performance.expression === 'worried');
check('performance equals performanceForBeat(beat)', staging.every((s) => JSON.stringify(s.performance) === JSON.stringify(performanceForBeat(s.beat))));

console.log('\n[determinism]');
{
  const a = JSON.stringify(projectOfficeStaging(composeBeats(stream, CONFIG), office));
  const b = JSON.stringify(projectOfficeStaging(composeBeats([...stream].reverse(), CONFIG), office));
  check('same stream → identical office projection (order-independent)', a === b);
}

console.log(`\noffice-projection: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`office-projection gate FAILED with ${failures} failure(s)`);
  process.exit(1);
}
console.log('office-projection gate PASSED');
