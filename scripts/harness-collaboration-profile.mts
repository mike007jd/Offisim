import { createHarness } from './lib/harness-runner.mjs';

const h = createHarness();

/**
 * Collaboration profile oracle (Epic E, E1) — the `collaboration_read` read-only
 * boundary for Connect.
 *
 * Proves the contract that the Connect host enforces: `strict` is zero tools (the
 * current daily chat); `collaboration_read` exposes no filesystem built-ins by
 * default and may append read-only MCP meta tools. It NEVER intersects the
 * forbidden set (write / shell / mission persistence / publish / run-spawning).
 * Pure — no Pi, no host process.
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
const TOTAL = 8;
const check = h.checkAsync;

console.log('harness:collaboration-profile — Connect read-only boundary (E1)\n');

await check('(1) strict profile → zero tools (unchanged daily chat)', () => {
  assert.deepEqual(collaborationToolAllowlist('strict'), []);
});

await check('(2) collaboration_read → no filesystem built-ins without a source grant', () => {
  assert.deepEqual(collaborationToolAllowlist('collaboration_read'), []);
});

await check('(3) normalize defaults unknown/undefined → strict', () => {
  assert.equal(normalizeCollaborationProfile(undefined), 'strict');
  assert.equal(normalizeCollaborationProfile('nonsense'), 'strict');
  assert.equal(normalizeCollaborationProfile('collaboration_read'), 'collaboration_read');
  assert.equal(normalizeCollaborationProfile('strict'), 'strict');
});

await check('(4) INVARIANT: collaboration_read allowlist ∩ forbidden = ∅', () => {
  assert.deepEqual(collaborationForbiddenIntersection(COLLABORATION_READ_TOOL_ALLOWLIST), []);
  assert.deepEqual(
    collaborationForbiddenIntersection(collaborationToolAllowlist('collaboration_read')),
    [],
  );
});

await check('(5) the forbidden check DETECTS a breach', () => {
  const breach = collaborationForbiddenIntersection(['read', 'write', 'bash', 'grep']);
  assert.deepEqual(breach.sort(), ['bash', 'write']);
});

await check('(6) forbidden set covers write / shell / mission / publish / delegate', () => {
  for (const t of [
    'write',
    'edit',
    'bash',
    'publish_artifact',
    'submit_for_evaluation',
    'delegate',
  ]) {
    assert.ok(
      (COLLABORATION_FORBIDDEN_TOOLS as readonly string[]).includes(t),
      `forbidden set must include ${t}`,
    );
  }
});

await check('(7) the read allowlist exposes no execution/mutation tool', () => {
  for (const t of COLLABORATION_READ_TOOL_ALLOWLIST) {
    assert.ok(
      !(COLLABORATION_FORBIDDEN_TOOLS as readonly string[]).includes(t),
      `read tool "${t}" must not be forbidden`,
    );
  }
});

await check('(8) collaboration_read MCP meta tools still avoid the forbidden set', () => {
  const withMcpMeta = [
    ...collaborationToolAllowlist('collaboration_read'),
    'mcp_search_tools',
    'mcp_describe_tool',
    'mcp_call',
  ];
  assert.deepEqual(collaborationForbiddenIntersection(withMcpMeta), []);
});

console.log(`\n${(h.checks - h.failures)}/${TOTAL} checks passed${h.failures ? `, ${h.failures} FAILED` : ''}.`);
if (h.failures > 0 || (h.checks - h.failures) !== TOTAL) process.exit(1);

if (!process.exitCode) h.report();
