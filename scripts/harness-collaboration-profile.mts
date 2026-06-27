/**
 * Collaboration profile oracle (Epic E, E1) — the `collaboration_read` read-only
 * boundary for Connect.
 *
 * Proves the contract that the Connect host enforces: `strict` is zero tools (the
 * current daily chat); `collaboration_read` is a read-only profile whose allowlist
 * NEVER intersects the forbidden set (write / shell / mission persistence /
 * publish / run-spawning). Pure — no Pi, no host process.
 *
 * Inject-proof (run manually, then revert): add 'write' to
 * COLLABORATION_READ_TOOL_ALLOWLIST → the invariant check (4) fails. That proves
 * the forbidden-intersection check is load-bearing, not a tautology.
 */

import assert from 'node:assert/strict';
import {
  COLLABORATION_FORBIDDEN_TOOLS,
  COLLABORATION_READ_TOOL_ALLOWLIST,
  collaborationForbiddenIntersection,
  collaborationToolAllowlist,
  normalizeCollaborationProfile,
} from './pi-agent-permission-modes.mts';

let passed = 0;
let failed = 0;
const TOTAL = 7;

function check(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`  ✗ ${name}\n    ${message}`);
  }
}

console.log('harness:collaboration-profile — Connect read-only boundary (E1)\n');

check('(1) strict profile → zero tools (unchanged daily chat)', () => {
  assert.deepEqual(collaborationToolAllowlist('strict'), []);
});

check('(2) collaboration_read → read-only built-ins', () => {
  assert.deepEqual(collaborationToolAllowlist('collaboration_read'), ['read', 'grep', 'find', 'ls']);
});

check('(3) normalize defaults unknown/undefined → strict', () => {
  assert.equal(normalizeCollaborationProfile(undefined), 'strict');
  assert.equal(normalizeCollaborationProfile('nonsense'), 'strict');
  assert.equal(normalizeCollaborationProfile('collaboration_read'), 'collaboration_read');
  assert.equal(normalizeCollaborationProfile('strict'), 'strict');
});

check('(4) INVARIANT: collaboration_read allowlist ∩ forbidden = ∅', () => {
  assert.deepEqual(collaborationForbiddenIntersection(COLLABORATION_READ_TOOL_ALLOWLIST), []);
  assert.deepEqual(collaborationForbiddenIntersection(collaborationToolAllowlist('collaboration_read')), []);
});

check('(5) the forbidden check DETECTS a breach', () => {
  const breach = collaborationForbiddenIntersection(['read', 'write', 'bash', 'grep']);
  assert.deepEqual(breach.sort(), ['bash', 'write']);
});

check('(6) forbidden set covers write / shell / mission / publish / delegate', () => {
  for (const t of ['write', 'edit', 'bash', 'publish_artifact', 'submit_for_evaluation', 'delegate']) {
    assert.ok(
      (COLLABORATION_FORBIDDEN_TOOLS as readonly string[]).includes(t),
      `forbidden set must include ${t}`,
    );
  }
});

check('(7) the read allowlist exposes no execution/mutation tool', () => {
  for (const t of COLLABORATION_READ_TOOL_ALLOWLIST) {
    assert.ok(
      !(COLLABORATION_FORBIDDEN_TOOLS as readonly string[]).includes(t),
      `read tool "${t}" must not be forbidden`,
    );
  }
});

console.log(`\n${passed}/${TOTAL} checks passed${failed ? `, ${failed} FAILED` : ''}.`);
if (failed > 0 || passed !== TOTAL) process.exit(1);
