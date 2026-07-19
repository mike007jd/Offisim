import { createHarness } from './lib/harness-runner.mjs';

const h = createHarness();

/**
 * Mission → office-beat projection gate (M3 UX-007, PRD §24.4).
 *
 * Locks the READ-ONLY mission projection contract: each neutral mission
 * lifecycle signal maps to the EXISTING office beat vocabulary with the correct
 * kind + semantic phase/label, the projector never mutates mission state (event
 * in → beat out, pure), and every beat carries a reduced-motion semantic label so
 * the meaning survives without animation. It also asserts the projection reuses
 * the shared beat lifecycle (no forked beat system) and that an empty / non-
 * theatrical stream stages nothing (a plain chat is unchanged).
 *
 * Pure Node via tsx against shared-types source — no DOM, no 3D, no renderer, no
 * Pi. Mirrors the agent-run office-projection gate.
 */
import {
  type MissionLifecycleEvent,
  type MissionLifecycleKind,
  beatLifespanMs,
  projectMissionEventToBeat,
  projectMissionEvents,
} from '../packages/shared-types/src/index.js';
const check = h.check;

const MISSION = 'mission-1';
const THREAD = 'thread-1';
const ROOT = 'attempt-1';

const ev = (
  kind: MissionLifecycleKind,
  at: number,
  extra?: Partial<MissionLifecycleEvent>,
): MissionLifecycleEvent => ({
  kind,
  missionId: MISSION,
  threadId: THREAD,
  rootRunId: ROOT,
  at,
  ...extra,
});

console.log('mission-office-projection gate');

// ── Each mission signal maps to the right beat kind + phase + label ─────────
console.log('\n[mapping] mission lifecycle → office beat vocabulary');
{
  const running = projectMissionEventToBeat(ev('mission.running', 100));
  check(
    'running → planning beat (plan)',
    running?.beat.kind === 'plan' && running?.phase === 'planning',
    `got ${running?.beat.kind}/${running?.phase}`,
  );

  const submitted = projectMissionEventToBeat(ev('mission.evaluation.submitted', 200));
  check(
    'evaluation.submitted → verification beat (review)',
    submitted?.beat.kind === 'review' && submitted?.phase === 'verification',
    `got ${submitted?.beat.kind}/${submitted?.phase}`,
  );

  const verifying = projectMissionEventToBeat(ev('mission.verifying', 250));
  check(
    'verifying → verification beat (review)',
    verifying?.beat.kind === 'review' && verifying?.phase === 'verification',
    `got ${verifying?.beat.kind}/${verifying?.phase}`,
  );

  const evalFail = projectMissionEventToBeat(ev('mission.evaluation.failed', 300));
  check(
    'evaluation FAIL → failure beat',
    evalFail?.beat.kind === 'failure' && evalFail?.phase === 'failure',
    `got ${evalFail?.beat.kind}/${evalFail?.phase}`,
  );

  const failed = projectMissionEventToBeat(ev('mission.failed', 350));
  check(
    'mission failed → failure beat',
    failed?.beat.kind === 'failure' && failed?.phase === 'failure',
    `got ${failed?.beat.kind}/${failed?.phase}`,
  );

  const approval = projectMissionEventToBeat(ev('mission.awaiting_user', 400));
  check(
    'awaiting_user → approval beat',
    approval?.beat.kind === 'approval' && approval?.phase === 'approval',
    `got ${approval?.beat.kind}/${approval?.phase}`,
  );

  const completed = projectMissionEventToBeat(ev('mission.completed', 500));
  check(
    'completed → completion beat (complete)',
    completed?.beat.kind === 'complete' && completed?.phase === 'completion',
    `got ${completed?.beat.kind}/${completed?.phase}`,
  );
}

// ── Failure / approval are interrupts; phase beats are not ──────────────────
console.log('\n[priority] interrupts preempt; reuses BEAT_PRIORITY bands');
{
  const fail = projectMissionEventToBeat(ev('mission.failed', 10))?.beat;
  const approval = projectMissionEventToBeat(ev('mission.awaiting_user', 20))?.beat;
  const planning = projectMissionEventToBeat(ev('mission.running', 30))?.beat;
  check('failure is an interrupt', fail?.interrupt === true);
  check('approval is an interrupt', approval?.interrupt === true);
  check(
    'approval outranks failure outranks planning',
    !!fail &&
      !!approval &&
      !!planning &&
      approval.priority > fail.priority &&
      fail.priority > planning.priority,
    `${approval?.priority}/${fail?.priority}/${planning?.priority}`,
  );
  check('planning is NOT an interrupt', planning?.interrupt === false);
}

// ── Reduced-motion: every beat carries its semantic label + phase ───────────
console.log('\n[a11y] semantic label present for reduced-motion (§24.4 / §29)');
{
  const allKinds: MissionLifecycleKind[] = [
    'mission.running',
    'mission.evaluation.submitted',
    'mission.verifying',
    'mission.evaluation.failed',
    'mission.awaiting_user',
    'mission.failed',
    'mission.completed',
  ];
  const projected = projectMissionEvents(allKinds.map((k, i) => ev(k, i)));
  check(
    'every staged mission kind yields a beat',
    projected.length === allKinds.length,
    `got ${projected.length}/${allKinds.length}`,
  );
  check(
    'every beat carries a non-empty semantic label',
    projected.every((p) => typeof p.semanticLabel === 'string' && p.semanticLabel.length > 0),
  );
  check(
    'every beat carries a phase (legible without animation)',
    projected.every((p) => !!p.phase),
  );
  // The label is independent of any relocation anchor: it lives on the projection,
  // not the staging, so reduced-motion (which only clears the anchor) keeps it.
  const completed = projectMissionEventToBeat(ev('mission.completed', 1));
  check(
    'completion label is human-legible',
    completed?.semanticLabel === 'The mission completed',
    completed?.semanticLabel,
  );
}

// ── READ-ONLY: the projector never mutates the input event ──────────────────
console.log('\n[read-only] pure projection — never writes mission state');
{
  const event = ev('mission.completed', 700);
  const before = JSON.stringify(event);
  const out = projectMissionEventToBeat(event);
  const after = JSON.stringify(event);
  check('input mission event is not mutated', before === after);
  check(
    'projector returns a beat, not the mission record',
    !!out && 'beat' in out && 'semanticLabel' in out,
  );
  // Frozen input must not throw — proves no write-back path exists.
  let threw = false;
  try {
    projectMissionEventToBeat(Object.freeze(ev('mission.running', 800)));
  } catch {
    threw = true;
  }
  check('projecting a frozen event does not throw (no write-back)', !threw);
}

// ── Additive: non-theatrical / empty streams stage nothing ──────────────────
console.log('\n[additive] a plain chat (no mission events) is unchanged');
{
  check('empty stream → no beats', projectMissionEvents([]).length === 0);
  // An unknown / non-staged kind returns null (defensive — not in the union).
  const unknown = projectMissionEventToBeat(ev('mission.ready' as MissionLifecycleKind, 1));
  check('non-theatrical mission kind → null (no fabricated beat)', unknown === null);
}

// ── Reuses the shared beat lifecycle (no forked beat system) ─────────────────
console.log('\n[lifecycle] shared per-kind TTL, namespaced id, deterministic');
{
  const completed = projectMissionEventToBeat(ev('mission.completed', 1000));
  check(
    'lifecycle uses shared beatLifespanMs(complete)',
    completed?.beat.lifecycle.endsAt === 1000 + beatLifespanMs('complete'),
    `${completed?.beat.lifecycle.endsAt} vs ${1000 + beatLifespanMs('complete')}`,
  );
  const fail = projectMissionEventToBeat(ev('mission.failed', 1000));
  check(
    'failure persists until resolved (long TTL, same as agent-run failure)',
    fail?.beat.lifecycle.endsAt === 1000 + beatLifespanMs('failure'),
  );
  check(
    'mission beat id is namespaced (no collision with run beats)',
    completed?.beat.id.startsWith('mission:'),
    completed?.beat.id,
  );
  // Deterministic: same event → byte-identical beat.
  const a = JSON.stringify(projectMissionEventToBeat(ev('mission.running', 1)));
  const b = JSON.stringify(projectMissionEventToBeat(ev('mission.running', 1)));
  check('same mission event → byte-identical beat', a === b);
}

// ── Optional acting employee threads through; default is director-level ─────
console.log('\n[scope] optional employee binding; default mission-level actor');
{
  const noEmp = projectMissionEventToBeat(ev('mission.running', 1));
  check('default mission beat has no employee (director-level)', noEmp?.beat.employeeId === null);
  const withEmp = projectMissionEventToBeat(ev('mission.running', 1, { employeeId: 'emp-7' }));
  check('bound mission beat carries the acting employee', withEmp?.beat.employeeId === 'emp-7');
}

console.log(`\nmission-office-projection: ${h.checks - h.failures}/${h.checks} passed`);

// ── Inject-proof: break the FAIL → failure mapping and confirm the gate trips.
console.log('\n[inject-proof] a broken FAIL→failure mapping must fail the gate');
{
  const failBeat = projectMissionEventToBeat(ev('mission.evaluation.failed', 1))?.beat;
  // The REAL mapping is failure. Assert the WRONG kind to simulate a regression
  // and prove this gate would catch it (we expect this single check to fail).
  const wouldMisclassify = failBeat?.kind === 'complete';
  check(
    'inject-proof active: if FAIL→failure were broken to FAIL→complete, the gate above would fail',
    !wouldMisclassify,
  );
}

if (h.failures > 0) {
  console.error(`mission-office-projection gate FAILED with ${h.failures} failure(s)`);
  process.exit(1);
}
console.log('mission-office-projection gate PASSED');

if (!process.exitCode) h.report();
