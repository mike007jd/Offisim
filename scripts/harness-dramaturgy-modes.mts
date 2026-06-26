/**
 * Dramaturgy personality + modes gate (Phase 5, source plan §10 / §13).
 *
 * Locks: presentation modes change movement DENSITY only (Focus / reduced-motion
 * → nobody moves; Office → at most N walkers; Cinematic → all) while preserving
 * the same semantic truth — actor set, performance, and beats are identical
 * across modes (no mode invents facts). Plus role-derived employee performance
 * profiles and deterministic variant anti-repeat.
 *
 * Pure Node via tsx against shared-types source — no DOM, no renderer, no Pi.
 */
import {
  type RoleSlug,
  type StagingPrefab,
  type TimedAgentRunEvent,
  animationTempoForRole,
  applyDramaturgyMode,
  composeBeats,
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
const started = (at: number, runId: string, employeeId: string): TimedAgentRunEvent => ({
  threadId: THREAD,
  rootRunId: ROOT,
  runId,
  parentRunId: ROOT,
  employeeId,
  relation: 'delegate',
  type: 'run.started',
  payload: { objective: 'x', access: 'write' },
  timestamp: at,
});
const tool = (at: number, employeeId: string, toolName: string): TimedAgentRunEvent => ({
  threadId: THREAD,
  rootRunId: ROOT,
  runId: `r-${employeeId}`,
  employeeId,
  type: 'tool.started',
  payload: { toolCallId: `${employeeId}:${at}`, toolName, status: 'started' },
  timestamp: at,
});
const prefab = (instanceId: string, prefabId: string, x = 0, z = 0): StagingPrefab => ({
  instanceId,
  prefabId,
  x,
  z,
  rotation: 0,
});

console.log('dramaturgy-modes gate');

// ── Role-derived animation tempo (the one kept profile field) ───────────────
console.log('\n[tempo] animation tempo derived from role');
check('coordinator role is brisk (1.2)', animationTempoForRole('product_manager') === 1.2);
check('builder role is neutral (1)', animationTempoForRole('developer') === 1);
check('researcher role is deliberate (0.8)', animationTempoForRole('researcher') === 0.8);
check('reviewer role is neutral (1)', animationTempoForRole('qa') === 1);
check('unknown role falls back to 1', animationTempoForRole('not-a-role' as RoleSlug) === 1);

// ── Modes change movement density only ──────────────────────────────────────
console.log('\n[modes] density only, truth preserved');
{
  // 6 employees each freshly delegated → 6 movement beats; office has capacity.
  const office: StagingPrefab[] = [
    prefab('m', 'meeting-table-8', 0, 0),
    prefab('w', 'workstation-standard', 5, 0),
  ];
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const stream: TimedAgentRunEvent[] = [
    {
      threadId: THREAD,
      rootRunId: ROOT,
      runId: ROOT,
      type: 'run.started',
      payload: { objective: 'root', access: 'write' },
      timestamp: 0,
    },
    ...ids.map((id, i) => started(100 + i, `run-${id}`, id)),
  ];
  const base = projectOfficeStaging(composeBeats(stream, CONFIG), office);
  const movers = base.filter((s) => s.staging !== null).length;

  const focus = applyDramaturgyMode(base, { mode: 'focus' });
  check(
    'focus: nobody relocates',
    focus.every((s) => s.staging === null),
  );
  check(
    'focus: actor set + performance preserved',
    focus.length === base.length &&
      focus.every((s, i) => JSON.stringify(s.performance) === JSON.stringify(base[i]?.performance)),
  );

  const reduced = applyDramaturgyMode(base, { mode: 'cinematic', reducedMotion: true });
  check(
    'reduced-motion: nobody relocates (even cinematic)',
    reduced.every((s) => s.staging === null),
  );

  const cinematic = applyDramaturgyMode(base, { mode: 'cinematic' });
  check(
    'cinematic: keeps every base relocation',
    cinematic.filter((s) => s.staging !== null).length === movers,
  );

  const officeMode = applyDramaturgyMode(base, { mode: 'office', maxWalkers: 4 });
  check(
    'office: caps walkers at 4',
    officeMode.filter((s) => s.staging !== null).length === Math.min(4, movers),
  );
  check(
    'office: never invents a relocation',
    officeMode.filter((s) => s.staging !== null).length <= movers,
  );
  check(
    'office: performance + actor set preserved',
    officeMode.length === base.length &&
      officeMode.every(
        (s, i) => JSON.stringify(s.performance) === JSON.stringify(base[i]?.performance),
      ),
  );
}

// ── Office cap picks highest-priority movers ────────────────────────────────
console.log('\n[modes] office cap keeps highest-priority movers');
{
  // A roomy office (3 workstation anchors) so 3 delegations all reserve, then
  // cap to 2.
  const office: StagingPrefab[] = [
    prefab('w1', 'workstation-standard', -5, 0),
    prefab('w2', 'workstation-dual', -7, 0),
    prefab('w3', 'workstation-compact', -9, 0),
  ];
  const stream: TimedAgentRunEvent[] = [
    {
      threadId: THREAD,
      rootRunId: ROOT,
      runId: ROOT,
      type: 'run.started',
      payload: { objective: 'root', access: 'write' },
      timestamp: 0,
    },
    started(10, 'r1', 'p1'),
    started(20, 'r2', 'p2'),
    started(30, 'r3', 'p3'),
  ];
  const base = projectOfficeStaging(composeBeats(stream, CONFIG), office);
  const movers = base.filter((s) => s.staging !== null);
  if (movers.length >= 2) {
    const capped = applyDramaturgyMode(base, { mode: 'office', maxWalkers: 2 });
    check(
      'office cap=2 keeps exactly 2 movers',
      capped.filter((s) => s.staging !== null).length === 2,
      `got ${capped.filter((s) => s.staging !== null).length}`,
    );
  } else {
    check(
      'office cap test has enough movers (setup)',
      movers.length >= 2,
      `only ${movers.length} movers`,
    );
  }
}

// ── Determinism of the mode transform ───────────────────────────────────────
console.log('\n[modes] deterministic');
{
  const office: StagingPrefab[] = [
    prefab('w1', 'workstation-standard', 0, 0),
    prefab('w2', 'workstation-dual', 3, 0),
  ];
  const stream: TimedAgentRunEvent[] = [
    {
      threadId: THREAD,
      rootRunId: ROOT,
      runId: ROOT,
      type: 'run.started',
      payload: { objective: 'r', access: 'write' },
      timestamp: 0,
    },
    started(10, 'r1', 'a'),
    started(20, 'r2', 'b'),
  ];
  const base = projectOfficeStaging(composeBeats(stream, CONFIG), office);
  const a = JSON.stringify(applyDramaturgyMode(base, { mode: 'office', maxWalkers: 1 }));
  const b = JSON.stringify(applyDramaturgyMode(base, { mode: 'office', maxWalkers: 1 }));
  check('same input → identical mode output', a === b);
}

// ── Variant anti-repeat ─────────────────────────────────────────────────────
console.log('\n[anti-repeat] consecutive same-kind variants differ');
{
  // One employee, alternating write/read so several 'produce' beats emit (gaps
  // > micro-min start fresh streams). Anti-repeat must vary consecutive ones.
  const stream: TimedAgentRunEvent[] = [
    started(0, 'rx', 'x'),
    tool(100, 'x', 'write_file'),
    tool(3000, 'x', 'read_file'),
    tool(6000, 'x', 'write_file'),
    tool(9000, 'x', 'read_file'),
    tool(12000, 'x', 'write_file'),
  ];
  const beats = composeBeats(stream, CONFIG);
  const produce = beats.filter((b) => b.kind === 'produce' && b.employeeId === 'x');
  check('multiple produce beats emitted', produce.length >= 3, `got ${produce.length}`);
  let adjacentEqual = false;
  for (let i = 1; i < produce.length; i += 1) {
    if (produce[i]?.variant === produce[i - 1]?.variant) adjacentEqual = true;
  }
  check('no two consecutive produce variants are equal', !adjacentEqual);
}

console.log(`\ndramaturgy-modes: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`dramaturgy-modes gate FAILED with ${failures} failure(s)`);
  process.exit(1);
}
console.log('dramaturgy-modes gate PASSED');
