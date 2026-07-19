import { createHarness } from './lib/harness-runner.mjs';

const h = createHarness();

/**
 * Dramaturgy performance + child-run stress gate (Phase 6, source plan §15).
 *
 * Two guarantees, pure Node via tsx against dramaturgy source:
 *  1. PERFORMANCE — a 30-employee, deep-tree run's live staging pipeline
 *     (compose → project → mode) stays within a per-frame compute budget so it
 *     never blocks the render loop, and is byte-identical run-to-run.
 *  2. CHILD-RUN STRESS — deep nesting + wide fan-out produces a valid run
 *     hierarchy (every actor traces to root), with NO anchor double-booking and
 *     the office walker cap honored (no movement spam).
 *
 * (Replay determinism moved out with the deleted pure-function replay module;
 * the composer's byte-identical determinism is covered here + in harness-beat-composer.)
 */
import {
  DRAMATURGY_VERSION,
  type DramaturgyModeOptions,
  type StagingPrefab,
  type TimedAgentRunEvent,
  applyDramaturgyMode,
  composeBeats,
  projectOfficeStaging,
} from '../packages/dramaturgy/src/index.js';
const check = h.check;

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

/** The live staging pipeline the scene runs: compose beats → project onto the
 *  office → apply the mode's walker density. */
function stage(events: readonly TimedAgentRunEvent[], mode: DramaturgyModeOptions) {
  const beats = composeBeats(events, { dramaturgyVersion: DRAMATURGY_VERSION });
  return applyDramaturgyMode(projectOfficeStaging(beats, office), mode);
}

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

console.log('dramaturgy stress + performance gate');
console.log(`\n[scenario] ${totalEmployees} employees, ${stream.length} source events`);
check('scenario has 30 employees (20-30 target)', totalEmployees === 30, `got ${totalEmployees}`);

// ---- 1. PERFORMANCE BUDGET + live determinism ----
console.log('\n[performance] one staging frame within budget');
{
  check(
    'live staging is byte-identical run-to-run',
    // biome-ignore lint/suspicious/noSelfCompare: two independent stage() calls; intentional run-to-run determinism assertion
    JSON.stringify(stage(stream, OFFICE_MODE)) === JSON.stringify(stage(stream, OFFICE_MODE)),
  );
  // The version is a real seed input baked into every variant hash, so bumping it
  // intentionally restages. Guard the premise (corpus produced beats) first so a
  // broken zero-beat composer fails loudly instead of making this pass trivially.
  const baseBeats = composeBeats(stream, { dramaturgyVersion: DRAMATURGY_VERSION });
  const bumpedBeats = composeBeats(stream, { dramaturgyVersion: 'v-future' });
  check(
    'corpus produced beats (version-bump premise holds)',
    baseBeats.length > 0,
    `${baseBeats.length} beats`,
  );
  check(
    'bumping the dramaturgy version changes the beats',
    JSON.stringify(baseBeats) !== JSON.stringify(bumpedBeats),
  );
  // Warm up (JIT) then measure a representative batch of frames.
  for (let i = 0; i < 5; i += 1) stage(stream, CINEMATIC);
  const FRAMES = 200;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < FRAMES; i += 1) stage(stream, CINEMATIC);
  const t1 = process.hrtime.bigint();
  const perFrameMs = Number(t1 - t0) / 1e6 / FRAMES;
  // Generous budget: the full 30-employee compose+project+mode must be well
  // under one 60fps frame so it never blocks the render loop.
  check(`per-frame compute < 8ms (got ${perFrameMs.toFixed(3)}ms)`, perFrameMs < 8);
}

// ---- 2. CHILD-RUN STRESS: hierarchy + no double-booking + walker cap ----
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

console.log(`\ndramaturgy-stress: ${h.checks - h.failures}/${h.checks} checks passed`);
if (h.failures > 0) {
  console.error(`dramaturgy-stress gate FAILED with ${h.failures} failure(s)`);
  process.exit(1);
}
console.log('dramaturgy-stress gate PASSED');

if (!process.exitCode) h.report();
