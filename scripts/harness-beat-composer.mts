/**
 * Deterministic beat composer gate (Phase 2).
 *
 * Locks the dramaturgy composer invariants from the source plan §9 / §15:
 *  - byte-for-byte identical beats across repeated runs of a fixed fixture;
 *  - approval / failure beats are emitted immediately (interrupt), bypassing
 *    cooldowns, so they can preempt lower-priority beats;
 *  - read/search/tool chatter collapses into one stable activity beat (plus at
 *    most one sustained relocation) instead of per-tool movement spam;
 *  - parallel fan-out is flagged; director roots stage nothing; movement
 *    cooldown downgrades a relocation to in-place rather than dropping the beat.
 *
 * Pure Node via tsx against shared-types source — no DOM, no renderer, no Pi.
 */
import {
  type SceneBeat,
  type TimedAgentRunEvent,
  composeBeats,
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
function started(at: number, s: Scope, objective = 'x'): TimedAgentRunEvent {
  return { threadId: THREAD, rootRunId: ROOT, ...s, type: 'run.started', payload: { objective, access: 'write' }, timestamp: at };
}
function finished(at: number, s: Scope, status: 'completed' | 'failed' | 'cancelled'): TimedAgentRunEvent {
  return {
    threadId: THREAD,
    rootRunId: ROOT,
    ...s,
    type: status === 'completed' ? 'run.completed' : status === 'failed' ? 'run.failed' : 'run.cancelled',
    payload: { status },
    timestamp: at,
  };
}
function tool(at: number, s: Scope, toolName: string): TimedAgentRunEvent {
  return { threadId: THREAD, rootRunId: ROOT, ...s, type: 'tool.started', payload: { toolCallId: `${s.runId}:${at}`, toolName, status: 'started' }, timestamp: at };
}
function approval(at: number, s: Scope): TimedAgentRunEvent {
  return { threadId: THREAD, rootRunId: ROOT, ...s, type: 'approval.requested', payload: { uiRequestId: `${s.runId}:appr`, title: 'Approve?' }, timestamp: at };
}
function artifact(at: number, s: Scope, title = 'out.md'): TimedAgentRunEvent {
  return { threadId: THREAD, rootRunId: ROOT, ...s, type: 'artifact.created', payload: { title }, timestamp: at };
}
const byKind = (beats: SceneBeat[], kind: string) => beats.filter((b) => b.kind === kind);

console.log('beat-composer gate');

// ── Coalescing: read chatter collapses ──────────────────────────────────────
console.log('\n[coalesce] read/search chatter → one stable activity');
{
  // 10 read tools 200ms apart (span 1.8s < 4s sustained threshold).
  const evts: TimedAgentRunEvent[] = [];
  for (let i = 0; i < 10; i += 1) {
    evts.push(tool(i * 200, { runId: 'c1', employeeId: 'alex' }, i % 2 ? 'grep' : 'read_file'));
  }
  const beats = composeBeats(evts, CONFIG);
  const research = byKind(beats, 'research');
  check('10 read/search tools → 1 research beat (not 10)', research.length === 1, `got ${research.length}`);
  check('the research beat is a micro-action (no movement)', research[0]?.movement === false);
}

// ── Sustained relocation: long compute relocates once ───────────────────────
console.log('\n[sustained] long compute relocates once');
{
  const evts: TimedAgentRunEvent[] = [];
  for (let i = 0; i <= 6; i += 1) {
    evts.push(tool(i * 800, { runId: 'c1', employeeId: 'kai' }, 'bash')); // 0..4800ms, gaps 800
  }
  const beats = composeBeats(evts, CONFIG);
  const compute = byKind(beats, 'compute');
  check('long compute → exactly 2 beats (micro + 1 relocate)', compute.length === 2, `got ${compute.length}`);
  check('first compute beat is micro (no movement)', compute[0]?.movement === false);
  check('second compute beat is the sustained relocation (movement)', compute[1]?.movement === true);
  check('relocation targets server-inspect affordance', compute[1]?.affordance === 'server-inspect');
}

// ── Priority / interrupt: approval + failure bypass cooldown ─────────────────
console.log('\n[interrupt] approval and failure preempt');
{
  const beats = composeBeats(
    [
      tool(0, { runId: ROOT, employeeId: 'alex' }, 'bash'),
      approval(300, { runId: ROOT, employeeId: 'alex' }),
      finished(600, { runId: ROOT, employeeId: 'alex' }, 'failed'),
    ],
    CONFIG,
  );
  const appr = byKind(beats, 'approval')[0];
  const fail = byKind(beats, 'failure')[0];
  check('approval beat emitted', Boolean(appr));
  check('approval priority is 100', appr?.priority === 100);
  check('approval is an interrupt', appr?.interrupt === true);
  check('approval emitted despite recent activity (bypass cooldown)', appr?.at === 300);
  check('failure beat emitted with priority 90 interrupt', fail?.priority === 90 && fail?.interrupt === true);
}

// ── Parallel fan-out flag + invisible director root ─────────────────────────
console.log('\n[parallel] fan-out flagged, director root invisible');
{
  const beats = composeBeats(
    [
      started(0, { runId: ROOT }), // director root, no employeeId
      started(100, { runId: 'c1', parentRunId: ROOT, employeeId: 'alex', relation: 'parallel' }),
      started(200, { runId: 'c2', parentRunId: ROOT, employeeId: 'maya', relation: 'parallel' }),
      started(300, { runId: 'c3', parentRunId: ROOT, employeeId: 'kai', relation: 'parallel' }),
    ],
    CONFIG,
  );
  check('director root stages no beat', !beats.some((b) => b.runId === ROOT));
  const delegates = byKind(beats, 'delegate');
  check('3 delegate beats', delegates.length === 3, `got ${delegates.length}`);
  check('first child not flagged parallel', delegates.find((b) => b.runId === 'c1')?.parallel === false);
  check('second/third children flagged parallel', delegates.filter((b) => b.parallel).length === 2);
}

// ── Movement cooldown downgrades a relocation, never drops the beat ─────────
console.log('\n[cooldown] movement cooldown downgrades, keeps the beat');
{
  const beats = composeBeats(
    [
      started(0, { runId: 'c1', parentRunId: ROOT, employeeId: 'kai', relation: 'delegate' }),
      finished(3000, { runId: 'c1', parentRunId: ROOT, employeeId: 'kai' }, 'completed'), // join, within 8s
    ],
    CONFIG,
  );
  const delegate = byKind(beats, 'delegate')[0];
  const join = byKind(beats, 'join')[0];
  check('delegate beat moves', delegate?.movement === true);
  check('join beat is kept (not dropped)', Boolean(join));
  check('join within 8s downgraded to in-place (no movement)', join?.movement === false);
}

// ── Regression: equal-timestamp determinism (canonical order, not arrival) ──
console.log('\n[equal-ts] same-timestamp events resolve canonically');
{
  const fwd: TimedAgentRunEvent[] = [
    started(100, { runId: 'a', parentRunId: ROOT, employeeId: 'alex', relation: 'parallel' }),
    started(100, { runId: 'b', parentRunId: ROOT, employeeId: 'maya', relation: 'parallel' }),
  ];
  const rev = [...fwd].reverse();
  const a = composeBeats(fwd, CONFIG);
  const b = composeBeats(rev, CONFIG);
  check('equal-ts children → identical beats regardless of input order', JSON.stringify(a) === JSON.stringify(b));
  check('canonical: lower runId (a) not parallel, b parallel', a.find((x) => x.runId === 'a')?.parallel === false && a.find((x) => x.runId === 'b')?.parallel === true);

  // Same-run, same-ts start+complete must order start-before-terminal canonically.
  const order1 = composeBeats(
    [started(100, { runId: 'c', parentRunId: ROOT, employeeId: 'kai' }), finished(100, { runId: 'c', parentRunId: ROOT, employeeId: 'kai' }, 'completed')],
    CONFIG,
  );
  const order2 = composeBeats(
    [finished(100, { runId: 'c', parentRunId: ROOT, employeeId: 'kai' }, 'completed'), started(100, { runId: 'c', parentRunId: ROOT, employeeId: 'kai' })],
    CONFIG,
  );
  check('equal-ts start+complete order identical regardless of arrival', JSON.stringify(order1) === JSON.stringify(order2));
}

// ── Regression: relocation fires for realistic 0.8–2.5s tool loops ──────────
console.log('\n[slow-loop] sustained relocation across micro-min-sized gaps');
{
  const evts: TimedAgentRunEvent[] = [];
  for (let i = 0; i <= 4; i += 1) evts.push(tool(i * 1500, { runId: 'c1', employeeId: 'kai' }, 'bash')); // 0..6000, gaps 1500
  const compute = byKind(composeBeats(evts, CONFIG), 'compute');
  check('1.5s-gap compute loop still relocates once', compute.length === 2 && compute[1]?.movement === true, `got ${compute.length}`);
}

// ── Regression: artifact milestone is never swallowed by a produce stream ───
console.log('\n[artifact] milestone always emits mid-stream');
{
  const beats = composeBeats(
    [
      tool(0, { runId: 'c1', employeeId: 'alex' }, 'write_file'),
      tool(300, { runId: 'c1', employeeId: 'alex' }, 'write_file'), // coalesced
      artifact(500, { runId: 'c1', employeeId: 'alex' }),
    ],
    CONFIG,
  );
  const produce = byKind(beats, 'produce');
  check('produce beats = 2 (write micro + artifact milestone)', produce.length === 2, `got ${produce.length}`);
  check('artifact milestone has null activityKind (not a tool)', produce.some((b) => b.activityKind === null));
}

// ── Determinism: identical beats across repeated runs ───────────────────────
console.log('\n[determinism] byte-identical beats for a fixed fixture');
{
  const fixture: TimedAgentRunEvent[] = [
    started(0, { runId: ROOT, workKind: 'plan' }),
    started(500, { runId: 'a', parentRunId: ROOT, employeeId: 'alex', relation: 'parallel', workKind: 'implement' }),
    started(700, { runId: 'b', parentRunId: ROOT, employeeId: 'maya', relation: 'parallel', workKind: 'design' }),
    tool(900, { runId: 'a', employeeId: 'alex' }, 'read_file'),
    tool(1100, { runId: 'a', employeeId: 'alex' }, 'grep'),
    tool(1300, { runId: 'b', employeeId: 'maya' }, 'write_file'),
    approval(1500, { runId: 'a', employeeId: 'alex' }),
    finished(2000, { runId: 'b', parentRunId: ROOT, employeeId: 'maya' }, 'completed'),
    finished(2200, { runId: 'a', parentRunId: ROOT, employeeId: 'alex' }, 'failed'),
  ];
  const run1 = JSON.stringify(composeBeats(fixture, CONFIG));
  const run2 = JSON.stringify(composeBeats(fixture, CONFIG));
  const run3 = JSON.stringify(composeBeats([...fixture].reverse().reverse(), CONFIG));
  check('two runs produce byte-identical beats', run1 === run2);
  check('a copy of the fixture produces byte-identical beats', run1 === run3);
  check('variant is stable + bounded', JSON.parse(run1).every((b: SceneBeat) => b.variant >= 0 && b.variant < 3));
  // Out-of-order input is sorted deterministically by timestamp.
  const shuffled = [fixture[3], fixture[0], fixture[8], fixture[1], fixture[6], fixture[2], fixture[7], fixture[4], fixture[5]].filter(Boolean) as TimedAgentRunEvent[];
  check('timestamp-shuffled input → identical beats (stable sort)', JSON.stringify(composeBeats(shuffled, CONFIG)) === run1);
}

console.log(`\nbeat-composer: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`beat-composer gate FAILED with ${failures} failure(s)`);
  process.exit(1);
}
console.log('beat-composer gate PASSED');
