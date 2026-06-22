/**
 * Replay + performance gate (Phase 6, source plan §14 / §15).
 *
 * Three guarantees, all pure Node via tsx against shared-types source:
 *  1. REPLAY determinism — replayDramaturgy over a stored source (events +
 *     version) is byte-identical run-to-run and order-independent; bumping the
 *     dramaturgy version intentionally changes the output. Replay consumes only
 *     stored facts + version, never a generated action script.
 *  2. PERFORMANCE — a 30-employee, deep-tree run stays within a compute budget
 *     for one staging frame, and the office never stages more walkers than the
 *     active mode's cap (no movement spam).
 *  3. CHILD-RUN STRESS — deep nesting + wide fan-out produces a valid run
 *     hierarchy (every actor traces to root), with NO anchor double-booking.
 */
import {
  DRAMATURGY_VERSION,
  type DramaturgyModeOptions,
  type StagingPrefab,
  type TimedAgentRunEvent,
  applyDramaturgyMode,
  captureReplaySource,
  composeBeats,
  projectOfficeStaging,
  replayDramaturgy,
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

const THREAD = 'thread-stress';
const ROOT = 'root-stress';

interface Scope {
  runId: string;
  parentRunId?: string;
  employeeId?: string;
  relation?: TimedAgentRunEvent['relation'];
}
const started = (at: number, s: Scope): TimedAgentRunEvent => ({
  threadId: THREAD,
  rootRunId: ROOT,
  ...s,
  type: 'run.started',
  payload: { objective: 'work', access: 'write' },
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
const prefab = (instanceId: string, prefabId: string, x: number, z: number): StagingPrefab => ({
  instanceId,
  prefabId,
  x,
  z,
  rotation: 0,
});

// A real-ish office with the full set of relocation affordances and enough
// workstations for 30 employees to have a home.
const office: StagingPrefab[] = [];
for (let i = 0; i < 30; i += 1) {
  office.push(
    prefab(`w${i}`, 'workstation-standard', -8 + (i % 6) * 2, -6 + Math.floor(i / 6) * 2),
  );
}
office.push(prefab('stand1', 'standing-table', 6, 0));
office.push(prefab('stand2', 'standing-table', 6, 2));
office.push(prefab('wb1', 'whiteboard', 8, 0));
office.push(prefab('wb2', 'whiteboard', 8, 2));
office.push(prefab('m1', 'meeting-table-4', 0, 8));
office.push(prefab('m2', 'meeting-table-4', 4, 8));

const OFFICE_MODE: DramaturgyModeOptions = { mode: 'office' };
const CINEMATIC: DramaturgyModeOptions = { mode: 'cinematic' };

// ---- Build a deep, wide run: root → 6 leads (delegate) → each 4 workers
// (delegate), workers do staggered work; several leads relocate (delegate/join).
function buildStream(): TimedAgentRunEvent[] {
  const s: TimedAgentRunEvent[] = [started(0, { runId: ROOT })];
  let emp = 0;
  for (let lead = 0; lead < 6; lead += 1) {
    const leadRun = `lead${lead}`;
    const leadEmp = `emp${emp++}`;
    s.push(
      started(100 + lead * 10, {
        runId: leadRun,
        parentRunId: ROOT,
        employeeId: leadEmp,
        relation: 'delegate',
      }),
    );
    for (let w = 0; w < 4; w += 1) {
      const wRun = `${leadRun}-w${w}`;
      const wEmp = `emp${emp++}`;
      // Child of a child → depth 2 from root, exercising nested hierarchy.
      s.push(
        started(300 + lead * 40 + w * 7, {
          runId: wRun,
          parentRunId: leadRun,
          employeeId: wEmp,
          relation: 'delegate',
        }),
      );
      // Worker activity: rotate read/write/inspect so beats vary.
      const toolName = w % 3 === 0 ? 'read_file' : w % 3 === 1 ? 'write_file' : 'grep';
      s.push(tool(900 + lead * 40 + w * 7, { runId: wRun, employeeId: wEmp }, toolName));
    }
    // Half the leads finish past the 8s movement cooldown → real join relocation.
    if (lead % 2 === 0) {
      s.push(
        finished(9500 + lead * 50, { runId: leadRun, parentRunId: ROOT, employeeId: leadEmp }),
      );
    }
  }
  return s;
}

const stream = buildStream();
const totalEmployees = new Set(
  stream.filter((e) => e.employeeId && e.runId !== ROOT).map((e) => e.employeeId),
).size;

console.log('dramaturgy replay + performance gate');
console.log(`\n[scenario] ${totalEmployees} employees, ${stream.length} source events`);
check('scenario has 30 employees (20-30 target)', totalEmployees === 30, `got ${totalEmployees}`);

// ---- 1. REPLAY DETERMINISM ----
console.log('\n[replay] deterministic from stored source + version');
{
  const source = captureReplaySource(stream);
  check(
    'captured source carries the active version',
    source.dramaturgyVersion === DRAMATURGY_VERSION,
  );
  check(
    'captured source copies the events (not a live ref)',
    source.events !== stream && source.events.length === stream.length,
  );

  const r1 = replayDramaturgy(source, office, OFFICE_MODE);
  const r2 = replayDramaturgy(source, office, OFFICE_MODE);
  check('replay is byte-identical run-to-run', JSON.stringify(r1) === JSON.stringify(r2));

  // Order-independence (smoke): a shuffled stored log replays to the same staging.
  const shuffled = captureReplaySource([...stream].reverse());
  const r3 = replayDramaturgy(shuffled, office, OFFICE_MODE);
  check(
    'replay is order-independent (shuffled source → same staging)',
    JSON.stringify(r1.staging) === JSON.stringify(r3.staging),
  );

  // Order-independence (rigorous): the stress stream above has no two events at
  // the SAME timestamp, so the reverse() smoke never exercises the discriminator
  // tie-break — the exact path that keeps replay stable when real async events
  // arrive same-millisecond in delivery order. Feed two same-timestamp
  // delegations in BOTH arrival orders and require identical beats AND staging:
  // only a canonical (arrival-order-independent) sort can satisfy this, and
  // because both delegations relocate and contend for relocation anchors, an
  // unstable order would assign anchors differently.
  {
    const TIE = 5000;
    const tieRoot = started(0, { runId: ROOT });
    const tieA = started(TIE, {
      runId: 'tieA',
      parentRunId: ROOT,
      employeeId: 'tieEmpA',
      relation: 'delegate',
    });
    const tieB = started(TIE, {
      runId: 'tieB',
      parentRunId: ROOT,
      employeeId: 'tieEmpB',
      relation: 'delegate',
    });
    const fwd = replayDramaturgy(captureReplaySource([tieRoot, tieA, tieB]), office, CINEMATIC);
    const rev = replayDramaturgy(captureReplaySource([tieRoot, tieB, tieA]), office, CINEMATIC);
    check(
      'same-timestamp delegations both relocate (anchor contention exists)',
      fwd.staging.length === 2 && fwd.staging.every((s) => s.staging !== null),
      `staged ${fwd.staging.length}`,
    );
    check(
      'same-timestamp events sort canonically — identical beats regardless of arrival order',
      JSON.stringify(fwd.beats) === JSON.stringify(rev.beats),
    );
    check(
      'same-timestamp events → identical anchor assignment regardless of arrival order',
      JSON.stringify(fwd.staging) === JSON.stringify(rev.staging),
    );
  }

  // Replay equals the live pipeline (replay is not a separate code path).
  const liveBeats = composeBeats(stream, { dramaturgyVersion: DRAMATURGY_VERSION });
  const liveStaging = applyDramaturgyMode(projectOfficeStaging(liveBeats, office), OFFICE_MODE);
  check(
    'replay matches the live pipeline output',
    JSON.stringify(r1.staging) === JSON.stringify(liveStaging),
  );

  // Version is a real seed input: a different version changes the output. Guard
  // first that the corpus actually produced beats, so a broken zero-beat
  // composer fails THIS check loudly instead of making the version-bump pass or
  // fail for the wrong reason.
  check(
    'corpus produced beats (version-bump premise holds)',
    r1.beats.length > 0,
    `${r1.beats.length} beats`,
  );
  const bumped = replayDramaturgy(
    { dramaturgyVersion: 'v-future', events: stream },
    office,
    OFFICE_MODE,
  );
  check(
    'bumping the version changes the projection',
    JSON.stringify(bumped) !== JSON.stringify(r1),
  );
}

// ---- 2. PERFORMANCE BUDGET ----
console.log('\n[performance] one staging frame within budget');
{
  const source = captureReplaySource(stream);
  // Warm up (JIT) then measure a representative batch of frames.
  for (let i = 0; i < 5; i += 1) replayDramaturgy(source, office, CINEMATIC);
  const FRAMES = 200;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < FRAMES; i += 1) replayDramaturgy(source, office, CINEMATIC);
  const t1 = process.hrtime.bigint();
  const perFrameMs = Number(t1 - t0) / 1e6 / FRAMES;
  // Generous budget: the full 30-employee compose+project+mode must be well
  // under one 60fps frame so it never blocks the render loop.
  check(`per-frame compute < 8ms (got ${perFrameMs.toFixed(3)}ms)`, perFrameMs < 8);
}

// ---- 3. CHILD-RUN STRESS: hierarchy + no double-booking + walker cap ----
console.log('\n[stress] valid hierarchy, no anchor collisions, no movement spam');
{
  const beats = composeBeats(stream, { dramaturgyVersion: DRAMATURGY_VERSION });

  // Every actor's run traces back to root through started events.
  const parentOf = new Map<string, string | undefined>();
  for (const e of stream) {
    if (e.type === 'run.started') parentOf.set(e.runId, e.parentRunId);
  }
  const tracesToRoot = (runId: string): boolean => {
    let cur: string | undefined = runId;
    for (let hops = 0; hops < 20 && cur; hops += 1) {
      if (cur === ROOT) return true;
      cur = parentOf.get(cur);
    }
    return false;
  };
  check(
    'every beat run traces to the root run',
    beats.every((b) => tracesToRoot(b.runId)),
  );

  // Office mode caps walkers; cinematic relocates all eligible. Neither may
  // double-book a relocation anchor.
  for (const [label, opts] of [
    ['office', OFFICE_MODE],
    ['cinematic', CINEMATIC],
  ] as const) {
    const staging = applyDramaturgyMode(projectOfficeStaging(beats, office), opts);
    const staged = staging.filter((s) => s.staging !== null);
    const anchorIds = staged.map((s) => s.staging?.anchorId).filter(Boolean) as string[];
    const positions = staged.map((s) => `${s.staging?.x},${s.staging?.z}`);
    check(
      `[${label}] no anchorId double-booked`,
      new Set(anchorIds).size === anchorIds.length,
      `${anchorIds.length} anchors`,
    );
    check(
      `[${label}] no two actors on the same relocation spot`,
      new Set(positions).size === positions.length,
      `${positions.length} spots`,
    );
    check(
      `[${label}] only movement beats relocate`,
      staged.every((s) => s.beat.movement),
    );
    if (label === 'office') {
      check(
        '[office] walkers capped at 4 (no movement spam)',
        staged.length <= 4,
        `staged ${staged.length}`,
      );
    }
  }
}

console.log(`\ndramaturgy-replay: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`dramaturgy-replay gate FAILED with ${failures} failure(s)`);
  process.exit(1);
}
console.log('dramaturgy-replay gate PASSED');
