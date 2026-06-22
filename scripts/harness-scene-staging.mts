/**
 * Scene staging gate (Phase 3, source plan §7 / §8).
 *
 * Locks the deterministic, affordance-driven staging mechanism that both the 2D
 * and 3D scenes consume:
 *  - anchor reservation never double-books a seat;
 *  - the same prefab layout + requests yields identical placements regardless of
 *    input order (so 2D and 3D stage a beat the same way);
 *  - placement is data-driven from prefab affordances — a custom/arbitrary
 *    office stages with no template-ID branch — and capacity overflow / missing
 *    affordances resolve to a null placement (actor stays home), never a clash;
 *  - world-anchor derivation honors prefab rotation;
 *  - performanceForBeat is total (every beat kind → a defined layered state) and
 *    refines work gesture from the tool-fact activity kind.
 *
 * Pure Node via tsx against shared-types source — no DOM, no renderer, no Pi.
 */
import {
  type CharacterPerformanceState,
  type SceneBeat,
  type StagingPrefab,
  type StagingRequest,
  performanceForBeat,
  reserveStaging,
  worldAnchorsFor,
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

const prefab = (instanceId: string, prefabId: string, x = 0, z = 0, rotation: 0 | 90 | 180 | 270 = 0): StagingPrefab => ({ instanceId, prefabId, x, z, rotation });
const req = (actorId: string, affordance: StagingRequest['affordance']): StagingRequest => ({ actorId, affordance });

console.log('scene-staging gate');

// ── Reservation never double-books + deterministic across order ─────────────
console.log('\n[reserve] no double-booking, order-independent');
{
  const office = [prefab('m1', 'meeting-table-8', 0, 0)];
  const requests = [req('alex', 'meeting-seat'), req('maya', 'meeting-seat'), req('kai', 'meeting-seat')];
  const fwd = reserveStaging(office, requests);
  const rev = reserveStaging(office, [...requests].reverse());
  check('all 3 actors seated', fwd.every((s) => s.anchorId !== null));
  const ids = fwd.map((s) => s.anchorId);
  check('no two actors share an anchor', new Set(ids).size === ids.length);
  check('reservation is order-independent (2D == 3D staging)', JSON.stringify(fwd) === JSON.stringify(rev));
  check('placements carry world position + facing + posture', fwd.every((s) => typeof s.x === 'number' && typeof s.facing === 'number' && s.posture === 'sitting'));
}

// ── Capacity overflow → null placement, never a clash ───────────────────────
console.log('\n[capacity] overflow stays home, no clash');
{
  const office = [prefab('m4', 'meeting-table-4', 0, 0)]; // 4 meeting-seats
  const requests = ['a', 'b', 'c', 'd', 'e'].map((id) => req(id, 'meeting-seat'));
  const staged = reserveStaging(office, requests);
  const seated = staged.filter((s) => s.anchorId !== null);
  const home = staged.filter((s) => s.anchorId === null);
  check('exactly 4 seated (capacity)', seated.length === 4, `got ${seated.length}`);
  check('1 overflow actor stays home (null)', home.length === 1);
  check('seated anchors all distinct', new Set(seated.map((s) => s.anchorId)).size === 4);
}

// ── Missing affordance → null (no fake placement) ───────────────────────────
console.log('\n[missing] absent affordance resolves to null');
{
  const office = [prefab('w1', 'workstation-standard', 0, 0)];
  const staged = reserveStaging(office, [req('alex', 'meeting-seat'), req('maya', 'workstation')]);
  check('meeting-seat request → null (office has none)', staged.find((s) => s.actorId === 'alex')?.anchorId === null);
  check('workstation request → seated', staged.find((s) => s.actorId === 'maya')?.anchorId !== null);
}

// ── Custom/arbitrary office stages via affordances, no template-ID ──────────
console.log('\n[custom] arbitrary office stages by affordance only');
{
  const office = [
    prefab('w1', 'workstation-standard', -4, 0),
    prefab('w2', 'workstation-dual', -2, 0),
    prefab('srv', 'server-rack-4u', 2, 0),
    prefab('wb', 'whiteboard', 4, 0),
    prefab('gpu', 'gpu-cluster', 6, 0), // 2 server-inspect anchors
  ];
  const staged = reserveStaging(office, [
    req('alex', 'workstation'),
    req('maya', 'workstation'),
    req('kai', 'server-inspect'),
    req('zoe', 'server-inspect'),
    req('sam', 'server-inspect'), // 3rd server-inspect: 1 rack + 2 gpu = 3 total
    req('pat', 'board-presenter'),
  ]);
  const ok = (id: string) => staged.find((s) => s.actorId === id)?.anchorId !== null;
  check('2 workstation actors seated', ok('alex') && ok('maya'));
  check('3 server-inspect actors seated (rack + gpu x2)', ok('kai') && ok('zoe') && ok('sam'));
  check('board-presenter seated at whiteboard', ok('pat'));
  check('no two actors share an anchor', new Set(staged.map((s) => s.anchorId)).size === staged.length);
}

// ── Robustness: duplicate instanceId never collapses distinct anchors ───────
console.log('\n[robust] duplicate instanceId still seats both actors');
{
  // Degenerate input (real DB instance_id is a PK, so this never happens) — the
  // no-double-book guarantee must still hold: reservation is by array index.
  const office = [prefab('dup', 'workstation-standard', 0, 0), prefab('dup', 'workstation-standard', 3, 0)];
  const staged = reserveStaging(office, [req('alex', 'workstation'), req('maya', 'workstation')]);
  check('both actors seated despite shared instanceId', staged.every((s) => s.x !== null));
  check('the two actors get physically distinct positions', staged[0]?.x !== staged[1]?.x);
}

// ── World-anchor derivation honors prefab rotation ──────────────────────────
console.log('\n[rotation] world anchors transform with prefab rotation');
{
  const anchors0 = worldAnchorsFor([prefab('w', 'workstation-standard', 5, 5, 0)]);
  check('rot0: anchor at offset +z, facing 180', Math.abs((anchors0[0]?.z ?? 0) - 5.55) < 1e-9 && anchors0[0]?.facing === 180);
  const anchors90 = worldAnchorsFor([prefab('w', 'workstation-standard', 5, 5, 90)]);
  // local [0,0.55] rotated 90: wx = x + (0*cos90 + 0.55*sin90) = 5.55 ; wz = 5 ; facing = (180+90)%360 = 270
  check('rot90: offset rotates to +x, facing 270', Math.abs((anchors90[0]?.x ?? 0) - 5.55) < 1e-9 && Math.abs((anchors90[0]?.z ?? 0) - 5) < 1e-9 && anchors90[0]?.facing === 270);
}

// ── performanceForBeat totality + activity refinement ───────────────────────
console.log('\n[performance] layered state for every beat kind');
{
  const KINDS: SceneBeat['kind'][] = ['receive-task', 'plan', 'delegate', 'review', 'research', 'produce', 'compute', 'approval', 'failure', 'join', 'complete', 'activity'];
  const beat = (kind: SceneBeat['kind'], activityKind: SceneBeat['activityKind'] = null): SceneBeat => ({
    id: 'b', kind, priority: 50, threadId: 't', rootRunId: 'r', runId: 'r', employeeId: 'e', workKind: null, activityKind, affordance: null, movement: false, parallel: false, interrupt: false, variant: 0, at: 0,
  });
  const valid = (p: CharacterPerformanceState) => p.locomotion === 'idle' && (p.posture === 'sit' || p.posture === 'stand');
  check('every beat kind yields a valid at-anchor state', KINDS.every((k) => valid(performanceForBeat(beat(k)))));
  check('failure → worried, intensity 2', performanceForBeat(beat('failure')).expression === 'worried' && performanceForBeat(beat('failure')).intensity === 2);
  check('complete → happy', performanceForBeat(beat('complete')).expression === 'happy');
  check('approval → worried (raise hand / wait)', performanceForBeat(beat('approval')).expression === 'worried');
  check('plan → write-board', performanceForBeat(beat('plan')).workGesture === 'write-board');
  check('activity[write] → type gesture', performanceForBeat(beat('activity', 'write')).workGesture === 'type');
  check('activity[read] → read gesture', performanceForBeat(beat('activity', 'read')).workGesture === 'read');
  check('activity[shell] → inspect-terminal gesture', performanceForBeat(beat('activity', 'shell')).workGesture === 'inspect-terminal');
  check('performanceForBeat is pure (same beat → identical state)', JSON.stringify(performanceForBeat(beat('research'))) === JSON.stringify(performanceForBeat(beat('research'))));
}

console.log(`\nscene-staging: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`scene-staging gate FAILED with ${failures} failure(s)`);
  process.exit(1);
}
console.log('scene-staging gate PASSED');
