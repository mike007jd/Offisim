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
 * Pure Node via tsx against dramaturgy source — no DOM, no renderer, no Pi.
 */
import {
  type RunFailureKind,
  type SceneBeat,
  type TimedAgentRunEvent,
  composeBeats,
} from '../packages/dramaturgy/src/index.js';

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
  return {
    threadId: THREAD,
    rootRunId: ROOT,
    ...s,
    type: 'run.started',
    payload: { objective, access: 'write' },
    timestamp: at,
  };
}
function finished(
  at: number,
  s: Scope,
  status: 'completed' | 'failed' | 'cancelled',
  failureKind?: RunFailureKind,
): TimedAgentRunEvent {
  return {
    threadId: THREAD,
    rootRunId: ROOT,
    ...s,
    type:
      status === 'completed'
        ? 'run.completed'
        : status === 'failed'
          ? 'run.failed'
          : 'run.cancelled',
    payload: { status, ...(failureKind ? { failureKind } : {}) },
    timestamp: at,
  };
}
function tool(at: number, s: Scope, toolName: string): TimedAgentRunEvent {
  return {
    threadId: THREAD,
    rootRunId: ROOT,
    ...s,
    type: 'tool.started',
    payload: { toolCallId: `${s.runId}:${at}`, toolName, status: 'started' },
    timestamp: at,
  };
}
function toolFailed(at: number, s: Scope, toolName: string): TimedAgentRunEvent {
  return {
    threadId: THREAD,
    rootRunId: ROOT,
    ...s,
    type: 'tool.completed',
    payload: { toolCallId: `${s.runId}:${at}`, toolName, status: 'failed' },
    timestamp: at,
  };
}
function approval(at: number, s: Scope): TimedAgentRunEvent {
  return {
    threadId: THREAD,
    rootRunId: ROOT,
    ...s,
    type: 'approval.requested',
    payload: { uiRequestId: `${s.runId}:appr`, title: 'Approve?' },
    timestamp: at,
  };
}
function artifact(at: number, s: Scope, title = 'out.md'): TimedAgentRunEvent {
  return {
    threadId: THREAD,
    rootRunId: ROOT,
    ...s,
    type: 'artifact.created',
    payload: { title, kind: 'report', deliverableId: `${s.runId}:artifact` },
    timestamp: at,
  };
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
  check(
    '10 read/search tools → 1 research beat (not 10)',
    research.length === 1,
    `got ${research.length}`,
  );
  check('the research beat is a micro-action (no movement)', research[0]?.movement === false);
  check(
    'beat carries a lifecycle starting at its event time',
    research[0]?.lifecycle.startedAt === research[0]?.at,
  );
  check(
    'activity beat lifespan is ~3s (deterministic, derived from at + TTL)',
    research[0] ? research[0].lifecycle.endsAt - research[0].lifecycle.startedAt === 3_000 : false,
  );
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
  check(
    'long compute → exactly 2 beats (micro + 1 relocate)',
    compute.length === 2,
    `got ${compute.length}`,
  );
  check('first compute beat is micro (no movement)', compute[0]?.movement === false);
  check(
    'second compute beat is the sustained relocation (movement)',
    compute[1]?.movement === true,
  );
  check(
    'relocation targets server-inspect affordance',
    compute[1]?.affordance === 'server-inspect',
  );
}

// ── Distinct visual phases per activity kind ─────────────────────────────────
console.log('\n[work-phases] activity kinds stage distinct visual phases');
{
  // One micro beat per tool name (fresh runId each ⇒ fresh stream, no coalesce);
  // the PRD requires reading/searching vs writing/editing vs shell/build/test to
  // read as DISTINCT visual phases, not one generic "working" look.
  const beatFor = (toolName: string): SceneBeat | undefined =>
    composeBeats([tool(0, { runId: `wp-${toolName}`, employeeId: 'alex' }, toolName)], CONFIG)[0];
  const read = beatFor('read_file');
  const search = beatFor('grep');
  const write = beatFor('write_file');
  const edit = beatFor('apply_patch');
  const shell = beatFor('bash');
  const build = beatFor('compile');
  const test = beatFor('run_tests');
  check(
    "reading: read tool → research beat, phase 'read', reading-seat, document prop",
    read?.kind === 'research' &&
      read.activityKind === 'read' &&
      read.visual.phase === 'read' &&
      read.affordance === 'reading-seat' &&
      read.visual.prop === 'document',
    JSON.stringify(read?.visual),
  );
  check(
    "searching: search tool → research beat, phase 'read', activityKind 'search'",
    search?.kind === 'research' &&
      search.activityKind === 'search' &&
      search.visual.phase === 'read',
    JSON.stringify(search?.visual),
  );
  check(
    "writing: write tool → produce beat, phase 'produce', workstation, laptop prop",
    write?.kind === 'produce' &&
      write.activityKind === 'write' &&
      write.visual.phase === 'produce' &&
      write.affordance === 'workstation' &&
      write.visual.prop === 'laptop',
    JSON.stringify(write?.visual),
  );
  check(
    "editing: edit tool → produce beat, phase 'produce', activityKind 'edit'",
    edit?.kind === 'produce' && edit.activityKind === 'edit' && edit.visual.phase === 'produce',
    JSON.stringify(edit?.visual),
  );
  check(
    "shell: shell tool → compute beat, phase 'compute', server-inspect, terminal prop, tool route",
    shell?.kind === 'compute' &&
      shell.activityKind === 'shell' &&
      shell.visual.phase === 'compute' &&
      shell.affordance === 'server-inspect' &&
      shell.visual.prop === 'terminal' &&
      shell.flow?.target === 'tool',
    JSON.stringify(shell?.visual),
  );
  check(
    "build/test: both stage compute beats (phase 'compute') with their own activityKind",
    build?.kind === 'compute' &&
      build.activityKind === 'build' &&
      build.visual.phase === 'compute' &&
      test?.kind === 'compute' &&
      test.activityKind === 'test' &&
      test.visual.phase === 'compute',
    `build ${JSON.stringify(build?.visual)} test ${JSON.stringify(test?.visual)}`,
  );
  check(
    'the three activity families are pairwise distinct phases (read/produce/compute)',
    new Set([read?.visual.phase, write?.visual.phase, shell?.visual.phase]).size === 3,
    `${read?.visual.phase}/${write?.visual.phase}/${shell?.visual.phase}`,
  );
}

// ── Completed root: celebration beat ─────────────────────────────────────────
console.log('\n[complete] root completion stages a celebration');
{
  const beats = composeBeats(
    [
      started(0, { runId: ROOT, employeeId: 'alex' }),
      finished(9000, { runId: ROOT, employeeId: 'alex' }, 'completed'),
    ],
    CONFIG,
  );
  const complete = byKind(beats, 'complete')[0];
  check('root run.completed stages a complete beat (not a join)', Boolean(complete));
  check(
    "complete visual celebrates: phase 'complete', emotion 'celebrating', package prop",
    complete?.visual.phase === 'complete' &&
      complete.visual.emotion === 'celebrating' &&
      complete.visual.prop === 'package',
    JSON.stringify(complete?.visual),
  );
  check(
    'complete flows to delivery and presents at the board (movement beat)',
    complete?.flow?.kind === 'artifact' &&
      complete.flow.target === 'delivery' &&
      complete.affordance === 'board-presenter' &&
      complete.movement === true,
    JSON.stringify(complete?.flow),
  );
  check('complete carries no resource marker (celebration, not risk)', complete?.resource === null);
}

// ── Universal work signals: flow / artifact / resource ─────────────────────
console.log('\n[signals] flow, artifact, and resource intents');
{
  const beats = composeBeats(
    [
      started(0, { runId: ROOT, employeeId: 'alex', workKind: 'plan' }),
      tool(300, { runId: ROOT, employeeId: 'alex' }, 'run_tests'),
      toolFailed(450, { runId: ROOT, employeeId: 'alex' }, 'run_tests'),
      approval(600, { runId: ROOT, employeeId: 'alex' }),
      artifact(900, { runId: ROOT, employeeId: 'alex' }, 'qa-report.md'),
      finished(1200, { runId: ROOT, employeeId: 'alex' }, 'failed'),
    ],
    CONFIG,
  );
  const artifactBeat = beats.find((beat) => beat.artifact);
  const approvalBeat = byKind(beats, 'approval')[0];
  const failures = byKind(beats, 'failure');
  check(
    'artifact beat carries an artifact intent',
    artifactBeat?.artifact?.title === 'qa-report.md',
  );
  check('artifact beat flows to delivery', artifactBeat?.flow?.target === 'delivery');
  check(
    'approval is an amber wait signal, not a blocked permission resource',
    approvalBeat?.resource === null &&
      approvalBeat.visual.phase === 'wait' &&
      approvalBeat.visual.emotion === 'thinking' &&
      approvalBeat.visual.prop === 'document',
  );
  check('tool failure and run failure both stage failure beats', failures.length === 2);
  check(
    'failure beats carry blocked/exhausted resource state',
    failures.every((beat) => beat.resource?.severity === 'blocked'),
  );
  check(
    'every emitted beat has a visual intent',
    beats.every((beat) => beat.visual.phase && beat.visual.emotion),
  );
}

// ── Typed failure kinds: total map, no keyword parsing ──────────────────────
console.log('\n[failure-kind] typed failureKind → exact distinct resource intents');
{
  // resource.kind must equal the failureKind itself (ResourceKind aliases
  // RunFailureKind 1:1) — asserted directly rather than tabulated twice.
  const expected: ReadonlyArray<readonly [RunFailureKind, 'blocked' | 'exhausted', string]> = [
    ['token', 'exhausted', 'token exhausted'],
    ['budget', 'exhausted', 'budget exhausted'],
    ['permission', 'blocked', 'permission blocked'],
    ['context', 'blocked', 'context blocked'],
    ['runtime', 'blocked', 'runtime blocked'],
    ['tool', 'blocked', 'tool failed'],
  ];
  for (const [failureKind, severity, label] of expected) {
    const beats = composeBeats(
      [finished(0, { runId: `fk-${failureKind}`, employeeId: 'alex' }, 'failed', failureKind)],
      CONFIG,
    );
    const failure = byKind(beats, 'failure')[0];
    check(
      `failureKind '${failureKind}' → {${failureKind}, ${severity}, '${label}'}`,
      failure?.resource?.kind === failureKind &&
        failure?.resource?.severity === severity &&
        failure?.resource?.label === label,
      `got ${JSON.stringify(failure?.resource)}`,
    );
  }

  // A failed run whose emitter stamped no kind stages the generic block — the
  // summary text is never parsed (a 'token'-laden summary must NOT reclassify).
  const generic = byKind(
    composeBeats(
      [
        {
          threadId: THREAD,
          rootRunId: ROOT,
          runId: 'fk-none',
          employeeId: 'alex',
          type: 'run.failed',
          payload: { status: 'failed', summary: 'token budget permission context runtime' },
          timestamp: 0,
        },
      ],
      CONFIG,
    ),
    'failure',
  )[0];
  check(
    "failed run without failureKind → generic {tool, blocked, 'run blocked'} (summary ignored)",
    generic?.resource?.kind === 'tool' &&
      generic?.resource?.severity === 'blocked' &&
      generic?.resource?.label === 'run blocked',
    `got ${JSON.stringify(generic?.resource)}`,
  );

  // The payload rides the wire as unvalidated JSON — an out-of-vocabulary kind
  // from a skewed emitter must degrade to the generic marker, never vanish.
  const outOfVocab = byKind(
    composeBeats(
      [
        {
          threadId: THREAD,
          rootRunId: ROOT,
          runId: 'fk-skew',
          employeeId: 'alex',
          type: 'run.failed',
          payload: {
            status: 'failed',
            failureKind: 'provider' as unknown as RunFailureKind,
          },
          timestamp: 0,
        },
      ],
      CONFIG,
    ),
    'failure',
  )[0];
  check(
    'out-of-vocabulary failureKind → generic marker (never a missing resource)',
    outOfVocab?.resource?.kind === 'tool' &&
      outOfVocab?.resource?.severity === 'blocked' &&
      outOfVocab?.resource?.label === 'run blocked',
    `got ${JSON.stringify(outOfVocab?.resource)}`,
  );
}

// ── Cancelled: neutral stopped state, never a blocked/risk marker ───────────
console.log('\n[cancelled] run.cancelled stages a neutral stop, no resource intent');
{
  const beats = composeBeats(
    [
      tool(0, { runId: 'cx', employeeId: 'alex' }, 'bash'),
      finished(300, { runId: 'cx', employeeId: 'alex' }, 'cancelled'),
    ],
    CONFIG,
  );
  const cancelled = byKind(beats, 'cancelled')[0];
  check('run.cancelled stages a cancelled beat (not a failure beat)', Boolean(cancelled));
  check('cancelled beat carries NO resource intent', cancelled?.resource === null);
  check('cancelled beat carries NO failure flow', cancelled?.flow === null);
  check(
    'cancelled visual is neutral (no blocked phase/emotion, no risk badge)',
    cancelled?.visual.phase !== 'blocked' &&
      cancelled?.visual.emotion === 'neutral' &&
      !cancelled?.visual.badges.includes('blocked'),
    `got ${JSON.stringify(cancelled?.visual)}`,
  );
  check(
    'no failure beat staged for a cancelled run',
    byKind(beats, 'failure').length === 0,
    `got ${byKind(beats, 'failure').length}`,
  );
  check(
    'cancelled interrupts (clears activity, supersedes lingering markers)',
    cancelled?.interrupt === true,
  );
}

// ── Issue resolution: approval/failure beats resolve on later same-run events ─
console.log('\n[issue-resolution] until-resolved beats clamp when the run moves on');
{
  const approvalThenTool = composeBeats(
    [
      approval(0, { runId: 'ir-1', employeeId: 'alex' }),
      tool(5_000, { runId: 'ir-1', employeeId: 'alex' }, 'bash'),
    ],
    CONFIG,
  );
  check(
    'answered approval: a later tool event clamps the approval beat to its timestamp',
    byKind(approvalThenTool, 'approval')[0]?.lifecycle.endsAt === 5_000,
    `got ${byKind(approvalThenTool, 'approval')[0]?.lifecycle.endsAt}`,
  );

  const approvalThenCancel = composeBeats(
    [
      approval(0, { runId: 'ir-2', employeeId: 'alex' }),
      finished(5_000, { runId: 'ir-2', employeeId: 'alex' }, 'cancelled'),
    ],
    CONFIG,
  );
  check(
    'cancelled run: the pending approval beat dies at the cancel, not 600s later',
    byKind(approvalThenCancel, 'approval')[0]?.lifecycle.endsAt === 5_000 &&
      byKind(approvalThenCancel, 'cancelled').length === 1,
    `got ${byKind(approvalThenCancel, 'approval')[0]?.lifecycle.endsAt}`,
  );

  const failureThenRecovery = composeBeats(
    [
      toolFailed(0, { runId: 'ir-3', employeeId: 'alex' }, 'bash'),
      tool(5_000, { runId: 'ir-3', employeeId: 'alex' }, 'bash'),
    ],
    CONFIG,
  );
  check(
    'recovery: a tool-failure beat clamps when the same run resumes work',
    byKind(failureThenRecovery, 'failure')[0]?.lifecycle.endsAt === 5_000,
    `got ${byKind(failureThenRecovery, 'failure')[0]?.lifecycle.endsAt}`,
  );

  const terminalFailure = composeBeats(
    [finished(0, { runId: 'ir-4', employeeId: 'alex' }, 'failed', 'runtime')],
    CONFIG,
  );
  check(
    'terminal run.failed keeps its full until-resolved TTL (never clamped)',
    byKind(terminalFailure, 'failure')[0]?.lifecycle.endsAt === 600_000,
    `got ${byKind(terminalFailure, 'failure')[0]?.lifecycle.endsAt}`,
  );

  const crossRun = composeBeats(
    [
      approval(0, { runId: 'ir-5', employeeId: 'alex' }),
      tool(5_000, { runId: 'ir-6', employeeId: 'bea' }, 'bash'),
    ],
    CONFIG,
  );
  check(
    "resolution is per-run: another run's event never clamps a pending approval",
    byKind(crossRun, 'approval')[0]?.lifecycle.endsAt === 600_000,
    `got ${byKind(crossRun, 'approval')[0]?.lifecycle.endsAt}`,
  );
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
  // The unresolved long-lifespan property lives in [issue-resolution]; here the
  // run terminally fails at 600, which RESOLVES the pending approval beat.
  check(
    "approval beat resolves at the run's terminal failure (clamped, not 600s)",
    appr?.lifecycle.endsAt === 600,
    `got ${appr?.lifecycle.endsAt}`,
  );
  check(
    'failure beat emitted with priority 90 interrupt',
    fail?.priority === 90 && fail?.interrupt === true,
  );
}

// ── Parallel fan-out flag + invisible director root ─────────────────────────
console.log('\n[parallel] fan-out flagged, director root invisible');
{
  const beats = composeBeats(
    [
      started(0, { runId: ROOT }), // director root, no employeeId
      started(100, { runId: 'c1', parentRunId: ROOT, employeeId: 'alex', relation: 'delegate' }),
      started(200, { runId: 'c2', parentRunId: ROOT, employeeId: 'maya', relation: 'delegate' }),
      started(300, { runId: 'c3', parentRunId: ROOT, employeeId: 'kai', relation: 'delegate' }),
    ],
    CONFIG,
  );
  check('director root stages no beat', !beats.some((b) => b.runId === ROOT));
  const delegates = byKind(beats, 'delegate');
  check('3 delegate beats', delegates.length === 3, `got ${delegates.length}`);
  check(
    'first child not flagged parallel',
    delegates.find((b) => b.runId === 'c1')?.parallel === false,
  );
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
    started(100, { runId: 'a', parentRunId: ROOT, employeeId: 'alex', relation: 'delegate' }),
    started(100, { runId: 'b', parentRunId: ROOT, employeeId: 'maya', relation: 'delegate' }),
  ];
  const rev = [...fwd].reverse();
  const a = composeBeats(fwd, CONFIG);
  const b = composeBeats(rev, CONFIG);
  check(
    'equal-ts children → identical beats regardless of input order',
    JSON.stringify(a) === JSON.stringify(b),
  );
  check(
    'canonical: lower runId (a) not parallel, b parallel',
    a.find((x) => x.runId === 'a')?.parallel === false &&
      a.find((x) => x.runId === 'b')?.parallel === true,
  );

  // Same-run, same-ts start+complete must order start-before-terminal canonically.
  const order1 = composeBeats(
    [
      started(100, { runId: 'c', parentRunId: ROOT, employeeId: 'kai' }),
      finished(100, { runId: 'c', parentRunId: ROOT, employeeId: 'kai' }, 'completed'),
    ],
    CONFIG,
  );
  const order2 = composeBeats(
    [
      finished(100, { runId: 'c', parentRunId: ROOT, employeeId: 'kai' }, 'completed'),
      started(100, { runId: 'c', parentRunId: ROOT, employeeId: 'kai' }),
    ],
    CONFIG,
  );
  check(
    'equal-ts start+complete order identical regardless of arrival',
    JSON.stringify(order1) === JSON.stringify(order2),
  );
}

// ── Regression: relocation fires for realistic 0.8–2.5s tool loops ──────────
console.log('\n[slow-loop] sustained relocation across micro-min-sized gaps');
{
  const evts: TimedAgentRunEvent[] = [];
  for (let i = 0; i <= 4; i += 1)
    evts.push(tool(i * 1500, { runId: 'c1', employeeId: 'kai' }, 'bash')); // 0..6000, gaps 1500
  const compute = byKind(composeBeats(evts, CONFIG), 'compute');
  check(
    '1.5s-gap compute loop still relocates once',
    compute.length === 2 && compute[1]?.movement === true,
    `got ${compute.length}`,
  );
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
  check(
    'produce beats = 2 (write micro + artifact milestone)',
    produce.length === 2,
    `got ${produce.length}`,
  );
  check(
    'artifact milestone has null activityKind (not a tool)',
    produce.some((b) => b.activityKind === null),
  );
}

// ── artifact.path: payload.path flows through to the beat's artifact intent ──
console.log('\n[artifact-path] payload.path is carried onto the artifact intent');
{
  const withPath: TimedAgentRunEvent = {
    threadId: THREAD,
    rootRunId: ROOT,
    runId: 'c1',
    employeeId: 'alex',
    type: 'artifact.created',
    payload: {
      title: 'out.md',
      kind: 'report',
      deliverableId: 'c1:artifact',
      path: '/repo/out.md',
    },
    timestamp: 0,
  };
  const beatWithPath = composeBeats([withPath], CONFIG).find((b) => b.artifact);
  check(
    'artifact.created with payload.path → beat.artifact.path equals payload.path',
    beatWithPath?.artifact?.path === '/repo/out.md',
    `got ${beatWithPath?.artifact?.path}`,
  );

  // A payload WITHOUT path must not fabricate one.
  const withoutPath = artifact(0, { runId: 'c2', employeeId: 'alex' });
  const beatWithoutPath = composeBeats([withoutPath], CONFIG).find((b) => b.artifact);
  check(
    'artifact.created without payload.path → beat.artifact.path is undefined',
    beatWithoutPath?.artifact !== undefined && beatWithoutPath.artifact.path === undefined,
    `got ${beatWithoutPath?.artifact?.path}`,
  );
}

// ── Determinism: identical beats across repeated runs ───────────────────────
console.log('\n[determinism] byte-identical beats for a fixed fixture');
{
  const fixture: TimedAgentRunEvent[] = [
    started(0, { runId: ROOT, workKind: 'plan' }),
    started(500, {
      runId: 'a',
      parentRunId: ROOT,
      employeeId: 'alex',
      relation: 'delegate',
      workKind: 'implement',
    }),
    started(700, {
      runId: 'b',
      parentRunId: ROOT,
      employeeId: 'maya',
      relation: 'delegate',
      workKind: 'design',
    }),
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
  check(
    'variant is stable + bounded',
    JSON.parse(run1).every((b: SceneBeat) => b.variant >= 0 && b.variant < 3),
  );
  // Out-of-order input is sorted deterministically by timestamp.
  const shuffled = [
    fixture[3],
    fixture[0],
    fixture[8],
    fixture[1],
    fixture[6],
    fixture[2],
    fixture[7],
    fixture[4],
    fixture[5],
  ].filter(Boolean) as TimedAgentRunEvent[];
  check(
    'timestamp-shuffled input → identical beats (stable sort)',
    JSON.stringify(composeBeats(shuffled, CONFIG)) === run1,
  );
}

console.log(`\nbeat-composer: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`beat-composer gate FAILED with ${failures} failure(s)`);
  process.exit(1);
}
console.log('beat-composer gate PASSED');
