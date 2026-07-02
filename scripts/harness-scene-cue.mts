import type {
  ConversationRunSnapshot,
  ConversationRunsSnapshot,
} from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.js';
import { projectEmployeeWorkloads } from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-projections.js';
import {
  type SceneCueFrame,
  type SceneCueInput,
  projectSceneCues,
} from '../apps/desktop/renderer/src/assistant/runtime/scene-cue-projection.js';
/**
 * SceneCue projection gate (production-work-dramaturgy I2).
 *
 * Acceptance oracle for `projectSceneCues` — the single render-facing contract
 * the 2D/3D scenes, workload drilldown, and delivery shelf will consume. Drives
 * the REAL pipeline end-to-end: a timestamped AgentRunEvent stream →
 * `composeBeats` → beats, a run snapshot → `projectEmployeeWorkloads` →
 * workloads, then one `projectSceneCues` call per scenario. Locks:
 *
 *  - fan-out/fan-in bundling: N delegated children collapse to ONE actor cue
 *    (×N from the snapshot-derived workload) and bundled flow cues, never one
 *    line per child;
 *  - purpose routing + the single-source target fallback (no flow.target:
 *    resource→tool else delivery) and the semantic ink roles;
 *  - the resource marker hierarchy: a blocked-severity issue takes the bubble's
 *    primary slot, matches the actor's ResourceCue, and wins attention over a
 *    selected thread;
 *  - delivery chip budget (3) + recentCount/overflow/latest;
 *  - graceful degradation with inputState omitted (false, never undefined);
 *  - reduced-motion / focus-mode staging clears (applyDramaturgyMode reuse);
 *  - typed failure integration (failureKind 'token' → {token, exhausted}) and
 *    the neutral cancelled state (no resource cue, no flow);
 *  - determinism: byte-identical output for identical input, beat input order
 *    (equal timestamps) irrelevant;
 *  - 58-run high concurrency: tier large, exactly 4 grouped chips, flows capped.
 */
import {
  IDLE_PERFORMANCE,
  type SceneBeat,
  type StagingPrefab,
  type TimedAgentRunEvent,
  composeBeats,
} from '../packages/shared-types/src/index.js';

let checks = 0;
let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const THREAD = 'thread-1';
const PRJ = 'prj';
const CONFIG = { dramaturgyVersion: 'v1' };

// ── Fixture factories (house pattern: events → composeBeats, snapshot → workloads)

interface Scope {
  runId: string;
  rootRunId?: string;
  parentRunId?: string;
  employeeId?: string;
  relation?: TimedAgentRunEvent['relation'];
  workKind?: TimedAgentRunEvent['workKind'];
}
const scopeOf = (s: Scope) => ({
  threadId: THREAD,
  rootRunId: s.rootRunId ?? 'root-1',
  ...s,
});
const started = (at: number, s: Scope): TimedAgentRunEvent => ({
  ...scopeOf(s),
  type: 'run.started',
  payload: { objective: 'x', access: 'write' },
  timestamp: at,
});
const finished = (at: number, s: Scope): TimedAgentRunEvent => ({
  ...scopeOf(s),
  type: 'run.completed',
  payload: { status: 'completed' },
  timestamp: at,
});
const failed = (at: number, s: Scope, failureKind: 'token' | 'tool'): TimedAgentRunEvent => ({
  ...scopeOf(s),
  type: 'run.failed',
  payload: { status: 'failed', failureKind },
  timestamp: at,
});
const cancelled = (at: number, s: Scope): TimedAgentRunEvent => ({
  ...scopeOf(s),
  type: 'run.cancelled',
  payload: { status: 'cancelled' },
  timestamp: at,
});
const tool = (at: number, s: Scope, toolName: string): TimedAgentRunEvent => ({
  ...scopeOf(s),
  type: 'tool.started',
  payload: { toolCallId: `${s.runId}:${at}`, toolName, status: 'started' },
  timestamp: at,
});
const artifactCreated = (at: number, s: Scope, title: string): TimedAgentRunEvent => ({
  ...scopeOf(s),
  type: 'artifact.created',
  payload: { title, kind: 'doc' },
  timestamp: at,
});
const approval = (at: number, s: Scope): TimedAgentRunEvent => ({
  ...scopeOf(s),
  type: 'approval.requested',
  payload: { uiRequestId: `${s.runId}:a`, title: 'ok?' },
  timestamp: at,
});

/** A hand-built beat for shapes composeBeats never emits (flowless fallbacks). */
function rawBeat(
  runId: string,
  at: number,
  over: Partial<Pick<SceneBeat, 'flow' | 'artifact' | 'resource' | 'employeeId'>> = {},
): SceneBeat {
  return {
    id: `raw-${runId}`,
    kind: 'activity',
    priority: 10,
    threadId: THREAD,
    rootRunId: 'root-1',
    runId,
    employeeId: over.employeeId ?? null,
    workKind: null,
    activityKind: null,
    affordance: null,
    movement: false,
    parallel: false,
    interrupt: false,
    variant: 0,
    visual: { phase: 'produce', intensity: 1, emotion: 'neutral', affordance: null, badges: [] },
    flow: over.flow ?? null,
    artifact: over.artifact ?? null,
    resource: over.resource ?? null,
    at,
    lifecycle: { startedAt: at, endsAt: at + 10_000 },
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

/** Join each run to its LAST composed beat — the same join the live store makes. */
function beatForFrom(beats: readonly SceneBeat[]): (runId: string) => SceneBeat | null {
  const byRun = new Map<string, SceneBeat>();
  for (const beat of beats) byRun.set(beat.runId, beat);
  return (runId) => byRun.get(runId) ?? null;
}

const OFFICE: StagingPrefab[] = [
  { instanceId: 'w1', prefabId: 'workstation-standard', x: -4, z: 0, rotation: 0 },
  { instanceId: 'w2', prefabId: 'workstation-standard', x: -2, z: 0, rotation: 0 },
  { instanceId: 'stand', prefabId: 'standing-table', x: 2, z: 0, rotation: 0 },
];

function input(over: Partial<SceneCueInput> & Pick<SceneCueInput, 'beats' | 'now'>): SceneCueInput {
  return {
    roster: over.roster ?? [],
    workloads: over.workloads ?? new Map(),
    beats: over.beats,
    now: over.now,
    prefabs: over.prefabs ?? OFFICE,
    mode: over.mode ?? 'office',
    reducedMotion: over.reducedMotion ?? false,
    threadByEmployee: over.threadByEmployee ?? new Map(),
    ...(over.actorPositions ? { actorPositions: over.actorPositions } : {}),
    ...(over.inputState ? { inputState: over.inputState } : {}),
  };
}

const json = (v: unknown) => JSON.stringify(v);

console.log('[scene-cue] projectSceneCues render contract');

// ── fan-out / fan-in ─────────────────────────────────────────────────────────
console.log('\n[fan-out / fan-in] one actor, bundled flows');
const fanStream: TimedAgentRunEvent[] = [
  started(1000, { runId: 'root-1', employeeId: 'emp-a' }),
  // Two children share a timestamp on purpose (equal-ms determinism below).
  started(1100, { runId: 'd1', parentRunId: 'root-1', employeeId: 'emp-a', relation: 'delegate' }),
  started(1100, { runId: 'd2', parentRunId: 'root-1', employeeId: 'emp-a', relation: 'delegate' }),
  started(1200, { runId: 'd3', parentRunId: 'root-1', employeeId: 'emp-a', relation: 'delegate' }),
  started(1300, { runId: 'd4', parentRunId: 'root-1', employeeId: 'emp-a', relation: 'delegate' }),
  started(1400, { runId: 'd5', parentRunId: 'root-1', employeeId: 'emp-a', relation: 'delegate' }),
  finished(1600, { runId: 'd1', parentRunId: 'root-1', employeeId: 'emp-a' }),
];
const fanBeats = composeBeats(fanStream, CONFIG);
const fanSnap = snapshot([
  runSnapshot({
    attemptId: 'root-1',
    employeeId: 'emp-a',
    delegations: [
      { runId: 'd1', parentRunId: 'root-1', employeeId: 'emp-a', objective: 'x', state: 'done' },
      { runId: 'd2', parentRunId: 'root-1', employeeId: 'emp-a', objective: 'x', state: 'running' },
      { runId: 'd3', parentRunId: 'root-1', employeeId: 'emp-a', objective: 'x', state: 'running' },
      { runId: 'd4', parentRunId: 'root-1', employeeId: 'emp-a', objective: 'x', state: 'running' },
      { runId: 'd5', parentRunId: 'root-1', employeeId: 'emp-a', objective: 'x', state: 'running' },
    ],
  }),
]);
const fanInput = input({
  workloads: projectEmployeeWorkloads(fanSnap, PRJ, beatForFrom(fanBeats)),
  beats: fanBeats,
  now: 2000,
  threadByEmployee: new Map([['emp-a', THREAD]]),
  inputState: { selectedThreadId: THREAD },
});
{
  const frame = projectSceneCues(fanInput);
  const actor = frame.actors.find((a) => a.employeeId === 'emp-a');
  check('one actor cue for N concurrent runs', frame.actors.length === 1, `${frame.actors.length}`);
  check(
    '×N from workload activeCount (root + 4 running)',
    actor?.workload.activeCount === 5 && actor.workload.countLabel === '×5',
    `${actor?.workload.countLabel}`,
  );
  check(
    'actor running + selected via thread join',
    actor?.running === true && actor.selected === true,
  );
  const fanOut = frame.flows.find((f) => f.kind === 'fan-out');
  const fanIn = frame.flows.find((f) => f.kind === 'fan-in');
  check(
    'fan-out bundles per (target, kind), not one line per child',
    frame.flows.length === 2 && fanOut?.bundleCount === 6,
    `flows ${frame.flows.length}, bundle ${fanOut?.bundleCount}`,
  );
  check(
    'fan-out targets the workstation with work ink',
    fanOut?.target === 'workstation' && fanOut.ink === 'work',
  );
  check(
    "child completion joins toward review as 'fan-in'",
    fanIn?.target === 'review' && fanIn.bundleCount === 1,
    json(fanIn),
  );
  check(
    'attention follows the selected thread (no severe issue)',
    frame.attention?.reason === 'selected-thread' && frame.attention.employeeId === 'emp-a',
    json(frame.attention),
  );
}

// ── purpose routing + ink ────────────────────────────────────────────────────
console.log('\n[purpose routing] targets, inks, fallback rule');
{
  // The approval comes LAST: a later same-run event resolves a lingering
  // approval beat (composeBeats issue resolution), which is itself correct —
  // an answered approval must not keep signaling.
  const stream: TimedAgentRunEvent[] = [
    started(1000, { runId: 'root-c', rootRunId: 'root-c', employeeId: 'emp-c' }),
    tool(1100, { runId: 'root-c', rootRunId: 'root-c', employeeId: 'emp-c' }, 'bash'),
    artifactCreated(1200, { runId: 'root-c', rootRunId: 'root-c', employeeId: 'emp-c' }, 'Report'),
    approval(1300, { runId: 'root-c', rootRunId: 'root-c', employeeId: 'emp-c' }),
  ];
  const beats: SceneBeat[] = [
    ...composeBeats(stream, CONFIG),
    // Flowless beats: the fallback rule + recovery vocabulary.
    rawBeat('raw-warn', 1350, {
      employeeId: 'emp-c',
      resource: { kind: 'runtime', severity: 'warning', label: 'retrying' },
    }),
    rawBeat('raw-recover', 1355, {
      employeeId: 'emp-c',
      resource: { kind: 'runtime', severity: 'recovering', label: 'recovering' },
    }),
    rawBeat('raw-art', 1360, { employeeId: 'emp-c', artifact: { title: 'Loose', kind: 'doc' } }),
  ];
  const frame = projectSceneCues(input({ beats, now: 1400 }));
  const by = (kind: string, target: string) =>
    frame.flows.find((f) => f.kind === kind && f.target === target);
  check(
    "tool beat → 'tool' target, work ink",
    by('tool', 'tool')?.ink === 'work',
    json(frame.flows),
  );
  check(
    "approval → 'user' target + 'approval' ink",
    by('approval', 'user')?.ink === 'approval',
    json(by('approval', 'user')),
  );
  check(
    "artifact → 'delivery' target + 'artifact' ink (bundled with flowless artifact)",
    by('artifact', 'delivery')?.ink === 'artifact' && by('artifact', 'delivery')?.bundleCount === 2,
    json(by('artifact', 'delivery')),
  );
  check(
    "fallback: flowless resource beat → 'tool' target, risk ink",
    by('failure', 'tool')?.ink === 'risk',
    json(frame.flows),
  );
  check("recovering resource → 'recovery' kind", by('recovery', 'tool') != null, json(frame.flows));
  check(
    'recovery reads NEUTRAL ink (quiet return, never the failure red — PRD)',
    by('recovery', 'tool')?.ink === 'neutral',
    json(by('recovery', 'tool')),
  );
  check(
    'flowless cue labels fall back to the visual phase (the 3D line-text rule)',
    by('failure', 'tool')?.label === 'produce',
    json(frame.flows.map((f) => f.label)),
  );
}

// ── resource hierarchy + typed failure + attention precedence ────────────────
console.log('\n[resource hierarchy] blocked issue leads, typed strain, attention');
{
  const stream: TimedAgentRunEvent[] = [
    started(1000, { runId: 'root-d', rootRunId: 'root-d', employeeId: 'emp-d' }),
    started(1100, {
      runId: 'd-tok',
      parentRunId: 'root-d',
      rootRunId: 'root-d',
      employeeId: 'emp-d',
      relation: 'delegate',
    }),
    failed(
      1200,
      { runId: 'd-tok', parentRunId: 'root-d', rootRunId: 'root-d', employeeId: 'emp-d' },
      'token',
    ),
  ];
  const beats = composeBeats(stream, CONFIG);
  const snap = snapshot([
    runSnapshot({
      attemptId: 'root-d',
      employeeId: 'emp-d',
      delegations: [
        {
          runId: 'd-tok',
          parentRunId: 'root-d',
          employeeId: 'emp-d',
          objective: 'x',
          state: 'failed',
          failureKind: 'token',
        },
      ],
    }),
  ]);
  const frame = projectSceneCues(
    input({
      workloads: projectEmployeeWorkloads(snap, PRJ, beatForFrom(beats)),
      beats,
      now: 1500,
      threadByEmployee: new Map([
        ['emp-d', THREAD],
        ['emp-z', 'thread-z'],
      ]),
      inputState: { selectedThreadId: 'thread-z' },
    }),
  );
  const actor = frame.actors.find((a) => a.employeeId === 'emp-d');
  const cue = frame.resources.find((r) => r.employeeId === 'emp-d');
  check(
    "blocked-severity issue → workload primary 'issue'",
    actor?.workload.primary === 'issue',
    `${actor?.workload.primary}`,
  );
  check(
    "run.failed failureKind 'token' → ResourceCue {token, exhausted}",
    cue?.resourceKind === 'token' && cue.severity === 'exhausted',
    json(cue),
  );
  check(
    'ResourceCue mirrors the actor topIssue (label/severity/terminal)',
    cue != null &&
      actor?.workload.topIssue != null &&
      cue.label === actor.workload.topIssue.label &&
      cue.severity === actor.workload.topIssue.severity &&
      cue.terminal === actor.workload.topIssue.terminal,
    json(cue),
  );
  check(
    'terminal failed child stays visible without inflating activeCount',
    cue?.terminal === true && actor?.workload.activeCount === 1,
    `active ${actor?.workload.activeCount}`,
  );
  check(
    'attention: severe issue beats the selected thread',
    frame.attention?.reason === 'severe-issue' && frame.attention.employeeId === 'emp-d',
    json(frame.attention),
  );
  check(
    'selected actor still reads selected (attention is a separate cue)',
    frame.actors.find((a) => a.employeeId === 'emp-z')?.selected === true,
  );
}

// ── cancelled = neutral ──────────────────────────────────────────────────────
console.log('\n[cancelled] neutral stop: no resource cue, no flow');
{
  const stream: TimedAgentRunEvent[] = [
    started(1000, { runId: 'root-x', rootRunId: 'root-x', employeeId: 'emp-x' }),
    cancelled(6500, { runId: 'root-x', rootRunId: 'root-x', employeeId: 'emp-x' }),
  ];
  // now is past the receive-task TTL: only the cancelled beat is live.
  const frame = projectSceneCues(
    input({
      beats: composeBeats(stream, CONFIG),
      now: 7500,
      threadByEmployee: new Map([['emp-x', 'thread-x']]),
    }),
  );
  const actor = frame.actors.find((a) => a.employeeId === 'emp-x');
  check('cancelled run → NO resource cue', frame.resources.length === 0, json(frame.resources));
  check('cancelled beat emits no flow signal', frame.flows.length === 0, json(frame.flows));
  check(
    'actor rests: not running, idle performance, no staging',
    actor?.running === false &&
      actor.staging === null &&
      json(actor.performance) === json(IDLE_PERFORMANCE),
  );
}

// ── delivery grouping ────────────────────────────────────────────────────────
console.log('\n[delivery] chip budget 3, counts, latest');
{
  const scope = { runId: 'root-e', rootRunId: 'root-e', employeeId: 'emp-e' };
  const stream: TimedAgentRunEvent[] = [
    started(1000, scope),
    artifactCreated(1100, scope, 'A1'),
    artifactCreated(1150, scope, 'A2'),
    artifactCreated(1200, scope, 'A3'),
    artifactCreated(1250, scope, 'A4'),
    artifactCreated(1300, scope, 'A5'),
  ];
  const frame = projectSceneCues(input({ beats: composeBeats(stream, CONFIG), now: 1400 }));
  const d = frame.delivery;
  check('5 artifacts → 3 chips', d.chips.length === 3, `${d.chips.length}`);
  check(
    'recentCount 5, overflowCount 2',
    d.recentCount === 5 && d.overflowCount === 2,
    `${d.recentCount}/${d.overflowCount}`,
  );
  check('latest is the newest artifact (A5)', d.latest?.title === 'A5', `${d.latest?.title}`);
  check(
    'chips are the newest three, oldest first',
    json(d.chips.map((c) => c.title)) === json(['A3', 'A4', 'A5']),
    json(d.chips.map((c) => c.title)),
  );
  check(
    'claims carry the owning threadId (claim contract)',
    d.chips.every((c) => c.threadId === THREAD),
  );
  check(
    'no severe/selected → attention falls to the fresh delivery',
    frame.attention?.target === 'delivery' && frame.attention.reason === 'delivery',
    json(frame.attention),
  );
}

// ── graceful degradation ─────────────────────────────────────────────────────
console.log('\n[degradation] inputState omitted → false, never undefined');
{
  // Rebuilt WITHOUT inputState (the property is absent, not undefined).
  const bare = input({
    workloads: fanInput.workloads,
    beats: fanInput.beats,
    now: fanInput.now,
    threadByEmployee: fanInput.threadByEmployee,
  });
  const frame = projectSceneCues(bare);
  check(
    'all selected/hovered/dragging are exactly false',
    frame.actors.every((a) => a.selected === false && a.hovered === false && a.dragging === false),
  );
  check(
    'frame still complete (actors + flows + delivery)',
    frame.actors.length === 1 && frame.flows.length === 2 && frame.delivery.recentCount === 0,
  );
  check(
    'no selection → attention null (nothing severe, no delivery)',
    frame.attention === null,
    json(frame.attention),
  );
}

// ── dramaturgy mode / reduced motion passthrough ─────────────────────────────
console.log('\n[modes] applyDramaturgyMode semantics pass through');
{
  const stream: TimedAgentRunEvent[] = [
    started(1000, { runId: 'root-g', rootRunId: 'root-g' }), // director root, no employee
    started(1050, {
      runId: 'child-g',
      parentRunId: 'root-g',
      rootRunId: 'root-g',
      employeeId: 'emp-g',
      relation: 'delegate',
    }),
  ];
  const beats = composeBeats(stream, CONFIG);
  const snap = snapshot([
    runSnapshot({
      attemptId: 'root-g',
      delegations: [
        {
          runId: 'child-g',
          parentRunId: 'root-g',
          employeeId: 'emp-g',
          objective: 'x',
          state: 'running',
        },
      ],
    }),
  ]);
  const workloads = projectEmployeeWorkloads(snap, PRJ, beatForFrom(beats));
  const base = { workloads, beats, now: 1500 } as const;
  const moving = projectSceneCues(input({ ...base }));
  const reduced = projectSceneCues(input({ ...base, reducedMotion: true }));
  const focus = projectSceneCues(input({ ...base, mode: 'focus' }));
  const at = (f: SceneCueFrame) => f.actors.find((a) => a.employeeId === 'emp-g');
  check(
    'movement beat relocates in office mode',
    at(moving)?.staging?.anchorId != null,
    json(at(moving)?.staging),
  );
  check(
    'reduced motion clears staging, keeps performance',
    at(reduced)?.staging === null &&
      json(at(reduced)?.performance) === json(at(moving)?.performance),
  );
  check('focus mode clears staging too', at(focus)?.staging === null);
}

// ── bundle merge semantics ───────────────────────────────────────────────────
console.log('\n[bundle merge] ink escalation, newest label/anchor, pulse OR');
{
  const flowOf = (label: string, pulse: boolean) => ({
    kind: 'tool' as const,
    label,
    target: 'tool' as const,
    pulse,
  });
  const beats: SceneBeat[] = [
    { ...rawBeat('m1', 1000, { employeeId: 'emp-m', flow: flowOf('first', false) }), id: 'm-1' },
    { ...rawBeat('m2', 1100, { employeeId: 'emp-m', flow: flowOf('middle', true) }), id: 'm-2' },
    {
      ...rawBeat('m3', 1200, {
        employeeId: 'emp-m',
        flow: flowOf('newest', false),
        resource: { kind: 'runtime', severity: 'blocked', label: 'runtime blocked' },
      }),
      id: 'm-3',
    },
  ];
  const frame = projectSceneCues(input({ beats, now: 1300 }));
  const bundle = frame.flows.find((f) => f.kind === 'tool' && f.target === 'tool');
  check('three same-group beats → one bundle of 3', bundle?.bundleCount === 3, json(frame.flows));
  check(
    'ink escalates to the highest-precedence member (risk wins)',
    bundle?.ink === 'risk',
    `${bundle?.ink}`,
  );
  check(
    'label and animation anchor follow the NEWEST member',
    bundle?.label === 'newest' && bundle.at === 1200,
    `${bundle?.label}@${bundle?.at}`,
  );
  check('pulse is the OR of members (any pulsing member pulses)', bundle?.pulse === true);
}

// ── roster universe ──────────────────────────────────────────────────────────
console.log('\n[roster] every hire stands on the floor, resting when idle');
{
  const frame = projectSceneCues(
    input({
      roster: ['emp-idle', 'emp-a'],
      workloads: fanInput.workloads,
      beats: fanInput.beats,
      now: fanInput.now,
      threadByEmployee: fanInput.threadByEmployee,
    }),
  );
  const idle = frame.actors.find((a) => a.employeeId === 'emp-idle');
  check(
    'never-messaged roster hire still gets an actor cue',
    frame.actors.length === 2 && idle != null,
    json(frame.actors.map((a) => a.employeeId)),
  );
  check(
    'idle hire rests: no thread, not running, idle bubble, no artifacts',
    idle?.threadId === null &&
      idle.running === false &&
      idle.workload.activeCount === 0 &&
      idle.workload.primary === 'count' &&
      idle.artifacts.length === 0,
    json(idle),
  );
}

// ── per-actor artifacts (the drilldown attribution rule) ─────────────────────
console.log('\n[actor artifacts] employee-named + active-run attribution, cap 8');
{
  const scope = { runId: 'root-r', rootRunId: 'root-r', employeeId: 'emp-r' };
  const stream: TimedAgentRunEvent[] = [
    started(1000, scope),
    ...Array.from({ length: 9 }, (_v, i) => artifactCreated(1100 + i * 10, scope, `R${i + 1}`)),
  ];
  const beats: SceneBeat[] = [
    ...composeBeats(stream, CONFIG),
    // A delegated child's artifact beat carrying NO employeeId: attributed to
    // emp-r because child-r is in emp-r's active runs (the drilldown rule).
    rawBeat('child-r', 1250, { artifact: { title: 'ChildArtifact', kind: 'doc' } }),
  ];
  const snap = snapshot([
    runSnapshot({
      attemptId: 'root-r',
      employeeId: 'emp-r',
      delegations: [
        {
          runId: 'child-r',
          parentRunId: 'root-r',
          employeeId: 'emp-r',
          objective: 'x',
          state: 'running',
        },
      ],
    }),
  ]);
  const frame = projectSceneCues(
    input({
      workloads: projectEmployeeWorkloads(snap, PRJ, beatForFrom(beats)),
      beats,
      now: 1400,
    }),
  );
  const actor = frame.actors.find((a) => a.employeeId === 'emp-r');
  check(
    '10 claims → capped at the 8 newest (inspector budget)',
    actor?.artifacts.length === 8,
    `${actor?.artifacts.length}`,
  );
  check(
    "child run's employeeId-less artifact attributed via active runs",
    actor?.artifacts.some((c) => c.title === 'ChildArtifact') === true,
    json(actor?.artifacts.map((c) => c.title)),
  );
  check(
    'newest artifact last, oldest beyond the cap dropped (drilldown ordering)',
    actor?.artifacts[actor.artifacts.length - 1]?.title === 'ChildArtifact' &&
      actor.artifacts[0]?.title === 'R3',
    json(actor?.artifacts.map((c) => c.title)),
  );
  check(
    'global shelf keeps employee-named claims only (unchanged semantics)',
    frame.delivery.recentCount === 9 &&
      frame.delivery.chips.every((c) => c.title !== 'ChildArtifact'),
    `${frame.delivery.recentCount}`,
  );
}

// ── determinism ──────────────────────────────────────────────────────────────
console.log('\n[determinism] byte-identical, beat order irrelevant');
{
  const a = json(projectSceneCues(fanInput));
  const b = json(projectSceneCues(fanInput));
  check('two identical invocations → byte-identical frames', a === b);
  const reversed = projectSceneCues({ ...fanInput, beats: [...fanInput.beats].reverse() });
  check('reversed beat input (incl. equal timestamps) → identical frame', json(reversed) === a);
}

// ── high concurrency ─────────────────────────────────────────────────────────
console.log('\n[high concurrency] 58 active runs');
{
  // No 'plan' here: plan-work children compose as plan beats (task→review) by
  // design, which would legitimately split the fan-out bundle across targets.
  const kinds = ['research', 'implement', 'review', 'design', 'test'] as const;
  const children = Array.from({ length: 57 }, (_v, i) => ({
    runId: `h-${String(i).padStart(3, '0')}`,
    at: 1010 + i * 10,
    workKind: kinds[i % kinds.length] as (typeof kinds)[number],
  }));
  const stream: TimedAgentRunEvent[] = [
    started(1000, { runId: 'root-h', rootRunId: 'root-h', employeeId: 'emp-h' }),
    ...children.map((c) =>
      started(c.at, {
        runId: c.runId,
        parentRunId: 'root-h',
        rootRunId: 'root-h',
        employeeId: 'emp-h',
        relation: 'delegate' as const,
        workKind: c.workKind,
      }),
    ),
  ];
  const beats = composeBeats(stream, CONFIG);
  const snap = snapshot([
    runSnapshot({
      attemptId: 'root-h',
      employeeId: 'emp-h',
      delegations: children.map((c) => ({
        runId: c.runId,
        parentRunId: 'root-h',
        employeeId: 'emp-h',
        objective: 'x',
        state: 'running' as const,
      })),
    }),
  ]);
  const frame = projectSceneCues(
    input({ workloads: projectEmployeeWorkloads(snap, PRJ, beatForFrom(beats)), beats, now: 1600 }),
  );
  const w = frame.actors.find((a) => a.employeeId === 'emp-h')?.workload;
  check(
    "58 active runs → tier 'large', ×58",
    w?.tier === 'large' && w.countLabel === '×58',
    `${w?.tier} ${w?.countLabel}`,
  );
  check('exactly 4 grouped chips (fixed bubble dims)', w?.chips.length === 4, `${w?.chips.length}`);
  check('overflow → drilldown affordance (6 groups > 4 shown)', w?.overflow === true);
  const bundled = frame.flows.reduce((sum, f) => sum + f.bundleCount, 0);
  check(
    'flows stay within the noise cap (≤8 signal beats total)',
    frame.flows.length <= 8 && bundled === 8,
    `groups ${frame.flows.length}, bundled ${bundled}`,
  );
  check(
    '58 children still ONE fan-out cue',
    frame.flows.filter((f) => f.kind === 'fan-out').length === 1,
    json(frame.flows),
  );
}

console.log(`\nscene-cue: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`scene-cue gate FAILED with ${failures} failure(s)`);
  process.exit(1);
}
console.log('scene-cue gate PASSED');
