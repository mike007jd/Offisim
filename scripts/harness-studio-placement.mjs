/**
 * Studio placement/collision gate.
 *
 * Locks the invariant the three Studio findings turned on: the placement ghost,
 * the focused-zone object drag, and the in-place rotation all route through the
 * SAME pure evaluator (`evaluatePrefabPlacement`), so a green preview can never
 * become a silently-rejected commit. Pure Node against the compiled
 * shared-types geometry — no DOM, no three.js, no app.
 *
 * Run after `pnpm --filter @offisim/shared-types build` (or via `pnpm validate`,
 * which builds it through typecheck first).
 */

import { evaluatePrefabPlacement } from '../packages/shared-types/dist/index.js';
import { createHarness } from './lib/harness-runner.mjs';

const h = createHarness();
const { check } = h;

// A roomy zone so nothing is rejected merely for zone fit unless we mean it.
const ZONE = { cx: 0, cz: 0, w: 12, d: 12 };

function obstacle(id, prefabId, x, z, label, rotation = 0) {
  return { id, prefabId, x, z, rotation, label };
}

console.log('studio-placement gate');

// ── Scenario A: same-zone duplicate placement is rejected ───────────────────
// A brand-new prefab (no id) dropped on top of an identical existing one.
{
  const existing = [obstacle('desk-1', 'workstation-standard', 0, 0, 'Desk 1')];
  const verdict = evaluatePrefabPlacement(
    { prefabId: 'workstation-standard', x: 0, z: 0, rotation: 0 },
    ZONE,
    existing,
  );
  check(
    'duplicate placement on an occupied cell is rejected',
    verdict.valid === false,
    `expected invalid, got ${JSON.stringify(verdict)}`,
  );
  check(
    'rejection names the obstacle (Desk 1)',
    verdict.valid === false && /Desk 1/.test(verdict.reason ?? ''),
    `reason was ${JSON.stringify(verdict.reason)}`,
  );
}

// ── Scenario B: dragging an object into an occupied cell is rejected ─────────
// Two desks; drag desk-2 (carries its own id) onto desk-1's cell.
{
  const obstacles = [
    obstacle('desk-1', 'workstation-standard', 0, 0, 'Desk 1'),
    obstacle('desk-2', 'workstation-standard', 4, 0, 'Desk 2'),
  ];
  const verdict = evaluatePrefabPlacement(
    { id: 'desk-2', prefabId: 'workstation-standard', x: 0, z: 0, rotation: 0 },
    ZONE,
    obstacles,
  );
  check(
    'drag into an occupied cell is rejected',
    verdict.valid === false,
    `expected invalid, got ${JSON.stringify(verdict)}`,
  );
}

// ── Scenario C: rotation that collides with a neighbour is rejected ──────────
// A whiteboard is wide on X at 0°; rotating to 90° makes it long on Z and it
// swings into a plant sitting just above it. The 0° spot is fine (control).
{
  const neighbour = obstacle('plant-1', 'plant-small', 0, 1.2, 'Plant');
  const upright = evaluatePrefabPlacement(
    { id: 'wb-1', prefabId: 'whiteboard', x: 0, z: 0, rotation: 0 },
    ZONE,
    [obstacle('wb-1', 'whiteboard', 0, 0, 'Whiteboard', 0), neighbour],
  );
  check(
    'whiteboard at 0° clears the neighbouring plant (control)',
    upright.valid === true,
    `expected valid, got ${JSON.stringify(upright)}`,
  );
  const rotated = evaluatePrefabPlacement(
    { id: 'wb-1', prefabId: 'whiteboard', x: 0, z: 0, rotation: 90 },
    ZONE,
    [obstacle('wb-1', 'whiteboard', 0, 0, 'Whiteboard', 0), neighbour],
  );
  check(
    'rotating the whiteboard into the plant is rejected',
    rotated.valid === false,
    `expected invalid, got ${JSON.stringify(rotated)}`,
  );
}

// ── Scenario D: self-exclusion — moving/rotating in place stays valid ────────
// The candidate must not collide with its own current footprint (matched by id).
{
  const verdict = evaluatePrefabPlacement(
    { id: 'desk-1', prefabId: 'workstation-standard', x: 0, z: 0, rotation: 0 },
    ZONE,
    [obstacle('desk-1', 'workstation-standard', 0, 0, 'Desk 1')],
  );
  check(
    'an object does not collide with itself (self-excluded by id)',
    verdict.valid === true,
    `expected valid, got ${JSON.stringify(verdict)}`,
  );
}

// ── Scenario E: leaving the zone is rejected with a clear reason ─────────────
{
  const verdict = evaluatePrefabPlacement(
    { prefabId: 'workstation-standard', x: 5.8, z: 0, rotation: 0 },
    ZONE,
    [],
  );
  check(
    'placement poking outside the zone is rejected',
    verdict.valid === false && /Outside the zone/.test(verdict.reason ?? ''),
    `got ${JSON.stringify(verdict)}`,
  );
}

// ── Scenario F: a genuinely-free cell is accepted ───────────────────────────
{
  const verdict = evaluatePrefabPlacement(
    { prefabId: 'workstation-standard', x: 4, z: 0, rotation: 0 },
    ZONE,
    [obstacle('desk-1', 'workstation-standard', 0, 0, 'Desk 1')],
  );
  check(
    'an open cell well clear of obstacles is accepted',
    verdict.valid === true && verdict.reason === null,
    `got ${JSON.stringify(verdict)}`,
  );
}

// ── Scenario G: no focus zone → invalid (the editor never commits ghost-only) ─
{
  const verdict = evaluatePrefabPlacement(
    { prefabId: 'workstation-standard', x: 0, z: 0, rotation: 0 },
    null,
    [],
  );
  check('a candidate with no zone in focus is rejected', verdict.valid === false);
}

console.log(`\n${h.checks - h.failures}/${h.checks} checks passed`);
if (h.failures > 0) {
  console.error(`studio-placement gate FAILED (${h.failures} failing)`);
} else {
  console.log('studio-placement gate OK');
}
h.report();
