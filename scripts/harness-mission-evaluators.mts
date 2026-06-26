/**
 * Mission Evaluator oracle (PRD §20, slice MS-003).
 *
 * Drives the P0 builtin evaluators + the registry against an IN-MEMORY
 * {@link EvaluationContext} test double (a fixture map standing in for the
 * production Tauri-sandboxed capabilities). For each evaluator it asserts a PASS
 * fixture and a non-PASS (FAIL / BLOCKED / ERROR) fixture, plus the boundary
 * cases the §20 security rules turn on:
 *   (a) command_exit_zero with classifierBlocked → ERROR, NOT FAIL;
 *   (b) manual_approval with no recorded approval → BLOCKED;
 *   (c) the registry throws on an unknown id;
 *   (d) llm_rubric_review is deterministic === false and returns SKIP.
 *
 * Pure Node via tsx against `packages/core` source — no DOM, no renderer, no Pi.
 * Style mirrors the other `scripts/harness-*.mts` oracles. The in-memory context
 * keeps the deterministic logic testable WITHOUT executing any real workspace
 * file / shell / git (the security boundary the evaluators must respect).
 */

import assert from 'node:assert/strict';
import {
  UnknownEvaluatorError,
  createDefaultEvaluatorRegistry,
  createEvaluatorRegistry,
} from '../packages/core/src/runtime/mission/evaluators/registry.ts';
import type {
  EvaluationContext,
  EvaluationResult,
} from '../packages/core/src/runtime/mission/evaluators/types.ts';

let passed = 0;
let failed = 0;
const checks: string[] = [];

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  checks.push(name);
  try {
    await run();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`  ✗ ${name}\n    ${message}`);
  }
}

// ---------------------------------------------------------------------------
// In-memory EvaluationContext test double. Capabilities are served from a
// fixture map; anything not supplied returns the safe sentinel a real provider
// would (null / false / empty), so the evaluators map it to a verdict.
// ---------------------------------------------------------------------------

interface Fixture {
  configJson: string;
  files?: Record<string, string>;
  hashes?: Record<string, string>;
  commands?: Record<
    string,
    { exitCode: number; stdout?: string; stderr?: string; classifierBlocked?: boolean }
  >;
  // Explicit `null` = git capability failure (unknowable diff); `[]` = clean
  // tree; omitted = default empty (clean). A `?? []` would swallow `null`, so the
  // mapping below distinguishes `undefined` (default) from a deliberate `null`.
  changedPaths?: string[] | null;
  artifacts?: Array<{ kind: string; title: string; contentHash: string }>;
  approval?: { approved: boolean; approver?: string } | null;
}

function makeContext(fixture: Fixture): EvaluationContext {
  return {
    criterion: { id: 'crit-1', description: 'fixture criterion', configJson: fixture.configJson },
    workspaceReadFile: async (path) => fixture.files?.[path] ?? null,
    // fileExists ⇔ files membership ONLY. `hashes` is the separate
    // workspaceHashFile capability and must not stand in for file presence.
    workspaceFileExists: async (path) => Object.hasOwn(fixture.files ?? {}, path),
    workspaceHashFile: async (path) => fixture.hashes?.[path] ?? null,
    runCommand: async (command) => {
      const r = fixture.commands?.[command];
      if (!r) return { exitCode: 127, stdout: '', stderr: 'not found' };
      return {
        exitCode: r.exitCode,
        stdout: r.stdout ?? '',
        stderr: r.stderr ?? '',
        classifierBlocked: r.classifierBlocked,
      };
    },
    // Distinguish a deliberate `null` (capability failure) from omitted
    // (`undefined` → default clean `[]`). `?? []` would collapse `null` → `[]`
    // and hide the very case git_diff_policy must ERROR on.
    gitChangedPaths: async () => (fixture.changedPaths === undefined ? [] : fixture.changedPaths),
    listArtifacts: async () => fixture.artifacts ?? [],
    recordedApproval: async () => (fixture.approval === undefined ? null : fixture.approval),
  };
}

const registry = createDefaultEvaluatorRegistry();

async function run(id: string, fixture: Fixture): Promise<EvaluationResult> {
  return registry.get(id).evaluate(makeContext(fixture));
}

// ---------------------------------------------------------------------------
// Per-evaluator PASS + non-PASS fixtures.
// ---------------------------------------------------------------------------

await check('command_exit_zero: exit 0 → PASS, exit !=0 → FAIL', async () => {
  const pass = await run('command_exit_zero', {
    configJson: JSON.stringify({ command: 'pnpm test' }),
    commands: { 'pnpm test': { exitCode: 0 } },
  });
  assert.equal(pass.verdict, 'PASS');
  const fail = await run('command_exit_zero', {
    configJson: JSON.stringify({ command: 'pnpm test' }),
    commands: { 'pnpm test': { exitCode: 1 } },
  });
  assert.equal(fail.verdict, 'FAIL');
});

await check('(a) command_exit_zero: classifierBlocked → ERROR, not FAIL', async () => {
  const blocked = await run('command_exit_zero', {
    configJson: JSON.stringify({ command: 'rm -rf /' }),
    commands: { 'rm -rf /': { exitCode: 1, classifierBlocked: true } },
  });
  assert.equal(
    blocked.verdict,
    'ERROR',
    'a classifier block is a policy/setup ERROR, never a FAIL',
  );
  assert.notEqual(blocked.verdict, 'FAIL');
});

await check('file_exists: present → PASS, absent → FAIL', async () => {
  const pass = await run('file_exists', {
    configJson: JSON.stringify({ path: 'dist/out.txt' }),
    files: { 'dist/out.txt': 'hi' },
  });
  assert.equal(pass.verdict, 'PASS');
  const fail = await run('file_exists', { configJson: JSON.stringify({ path: 'dist/out.txt' }) });
  assert.equal(fail.verdict, 'FAIL');
});

await check('file_hash: match → PASS, mismatch → FAIL, absent → ERROR', async () => {
  const sha = 'a'.repeat(64);
  const pass = await run('file_hash', {
    configJson: JSON.stringify({ path: 'lock.json', sha256: sha }),
    hashes: { 'lock.json': sha },
  });
  assert.equal(pass.verdict, 'PASS');
  const mismatch = await run('file_hash', {
    configJson: JSON.stringify({ path: 'lock.json', sha256: sha }),
    hashes: { 'lock.json': 'b'.repeat(64) },
  });
  assert.equal(mismatch.verdict, 'FAIL');
  const absent = await run('file_hash', {
    configJson: JSON.stringify({ path: 'lock.json', sha256: sha }),
  });
  assert.equal(absent.verdict, 'ERROR', 'cannot hash an absent file → ERROR');
});

await check(
  'text_contains: includes → PASS, missing marker → FAIL, absent file → FAIL',
  async () => {
    const pass = await run('text_contains', {
      configJson: JSON.stringify({ path: 'README.md', needle: 'DONE-MARKER' }),
      files: { 'README.md': 'work complete: DONE-MARKER here' },
    });
    assert.equal(pass.verdict, 'PASS');
    const fail = await run('text_contains', {
      configJson: JSON.stringify({ path: 'README.md', needle: 'DONE-MARKER' }),
      files: { 'README.md': 'nothing here' },
    });
    assert.equal(fail.verdict, 'FAIL');
    const absent = await run('text_contains', {
      configJson: JSON.stringify({ path: 'README.md', needle: 'DONE-MARKER' }),
    });
    assert.equal(absent.verdict, 'FAIL', 'absent file → marker definitively absent → FAIL');
  },
);

await check('json_schema: valid → PASS, missing required → FAIL, parse error → ERROR', async () => {
  const schema = { type: 'object', required: ['name', 'version'] };
  const pass = await run('json_schema', {
    configJson: JSON.stringify({ path: 'pkg.json', schema }),
    files: { 'pkg.json': JSON.stringify({ name: 'x', version: '1', extra: true }) },
  });
  assert.equal(pass.verdict, 'PASS');
  const missing = await run('json_schema', {
    configJson: JSON.stringify({ path: 'pkg.json', schema }),
    files: { 'pkg.json': JSON.stringify({ name: 'x' }) },
  });
  assert.equal(missing.verdict, 'FAIL', 'missing required key → FAIL');
  const wrongType = await run('json_schema', {
    configJson: JSON.stringify({ path: 'pkg.json', schema: { type: 'array' } }),
    files: { 'pkg.json': JSON.stringify({ name: 'x' }) },
  });
  assert.equal(wrongType.verdict, 'FAIL', 'type mismatch → FAIL');
  const parseError = await run('json_schema', {
    configJson: JSON.stringify({ path: 'pkg.json', schema }),
    files: { 'pkg.json': '{ not json' },
  });
  assert.equal(parseError.verdict, 'ERROR', 'unparseable JSON → ERROR');
  const absent = await run('json_schema', {
    configJson: JSON.stringify({ path: 'pkg.json', schema }),
  });
  assert.equal(absent.verdict, 'ERROR', 'absent file → cannot validate → ERROR');
});

await check('artifact_published: matching kind → PASS, none → FAIL', async () => {
  const pass = await run('artifact_published', {
    configJson: JSON.stringify({ kind: 'report' }),
    artifacts: [{ kind: 'report', title: 'Q3', contentHash: 'deadbeef' }],
  });
  assert.equal(pass.verdict, 'PASS');
  const wrongKind = await run('artifact_published', {
    configJson: JSON.stringify({ kind: 'report' }),
    artifacts: [{ kind: 'image', title: 'x', contentHash: 'c0ffee' }],
  });
  assert.equal(wrongKind.verdict, 'FAIL', 'no artifact of the requested kind → FAIL');
  const anyKind = await run('artifact_published', {
    configJson: '{}',
    artifacts: [{ kind: 'image', title: 'x', contentHash: 'c0ffee' }],
  });
  assert.equal(anyKind.verdict, 'PASS', 'no kind filter → any artifact passes');
});

await check(
  'git_diff_policy: all within policy → PASS, escapee → FAIL (reports offender)',
  async () => {
    const pass = await run('git_diff_policy', {
      configJson: JSON.stringify({ allowedGlobs: ['src/**', 'docs/*.md'] }),
      changedPaths: ['src/a/b.ts', 'docs/x.md'],
    });
    assert.equal(pass.verdict, 'PASS');
    const fail = await run('git_diff_policy', {
      configJson: JSON.stringify({ allowedGlobs: ['src/**'] }),
      changedPaths: ['src/a.ts', 'secrets/.env'],
    });
    assert.equal(fail.verdict, 'FAIL');
    assert.ok(fail.summary.includes('secrets/.env'), 'FAIL summary names the offending path');
    assert.ok(
      fail.evidenceRefs.some((e) => e.includes('secrets/.env')),
      'evidence carries the offending path',
    );
  },
);

await check(
  'git_diff_policy: SEGMENT-AWARE — single `*` is one dir level, `**` crosses segments',
  async () => {
    // A single-star pattern allows exactly one directory level. `docs/foo.md`
    // is allowed; `docs/sub/foo.md` is NOT — a greedy `.*` matcher would
    // wrongly PASS the nested path and silently weaken the policy gate.
    const single = JSON.stringify({ allowedGlobs: ['docs/*.md'] });
    const allowed = await run('git_diff_policy', {
      configJson: single,
      changedPaths: ['docs/foo.md'],
    });
    assert.equal(allowed.verdict, 'PASS', '`docs/*.md` matches `docs/foo.md`');

    const nested = await run('git_diff_policy', {
      configJson: single,
      changedPaths: ['docs/sub/foo.md'],
    });
    assert.equal(
      nested.verdict,
      'FAIL',
      '`docs/*.md` must NOT match `docs/sub/foo.md` (single `*` is one segment)',
    );
    assert.ok(
      nested.evidenceRefs.some((e) => e.includes('docs/sub/foo.md')),
      'the nested path that a single-star pattern should not reach is reported as offending',
    );

    // `**` is segment-crossing and DOES reach the nested path.
    const doubleStar = await run('git_diff_policy', {
      configJson: JSON.stringify({ allowedGlobs: ['docs/**/*.md'] }),
      changedPaths: ['docs/sub/foo.md', 'docs/a/b/c.md'],
    });
    assert.equal(
      doubleStar.verdict,
      'PASS',
      '`docs/**/*.md` crosses segments → matches nested paths',
    );
  },
);

await check(
  'git_diff_policy: (a) null diff → ERROR, (b) clean [] → PASS, (c) escapee → FAIL',
  async () => {
    // (a) A `null` from gitChangedPaths means the git capability could not serve
    // the diff (no project / non-git workspace / git unavailable). It must ERROR
    // — never silently PASS as if the tree were clean. allowedGlobs is irrelevant
    // here: the diff is unknowable.
    const unknowable = await run('git_diff_policy', {
      configJson: JSON.stringify({ allowedGlobs: ['src/**'] }),
      changedPaths: null,
    });
    assert.equal(
      unknowable.verdict,
      'ERROR',
      'null diff (git capability unavailable) → ERROR, never a false PASS',
    );
    assert.notEqual(
      unknowable.verdict,
      'PASS',
      'a capability failure must not masquerade as clean',
    );
    // The verdict alone is NOT discriminating: deleting the explicit
    // `if (changed === null)` guard makes `null.filter(...)` throw a TypeError
    // that safeEvaluate ALSO catches as verdict 'ERROR' (but with evidenceRefs
    // `[]` and a 'evaluator could not run:' summary). Assert the EXPLICIT guard's
    // evidence marker — only the deliberate null→ERROR path emits it — so this
    // case turns RED if the guard is removed (the TypeError fallback can't fake
    // it). Without this, the inject-proof would be a tautology.
    assert.ok(
      unknowable.evidenceRefs.includes('git:unavailable'),
      "explicit null-guard must emit evidenceRef 'git:unavailable'; the safeEvaluate TypeError fallback emits [], so this proves the guard (not the crash-catch) produced the ERROR",
    );
    assert.ok(
      unknowable.summary.includes('git capability unavailable'),
      "summary must come from the explicit guard, not safeEvaluate's 'evaluator could not run:' crash fallback",
    );

    // (b) A genuinely clean working tree (`[]`, a SUCCESSFUL read) is a real
    // PASS regardless of the allowed globs — there is nothing to violate.
    const cleanRestrictive = await run('git_diff_policy', {
      configJson: JSON.stringify({ allowedGlobs: ['src/**'] }),
      changedPaths: [],
    });
    assert.equal(
      cleanRestrictive.verdict,
      'PASS',
      'empty (clean) diff → PASS even under a strict glob',
    );
    const cleanNoGlobs = await run('git_diff_policy', {
      configJson: JSON.stringify({ allowedGlobs: [] }),
      changedPaths: [],
    });
    assert.equal(
      cleanNoGlobs.verdict,
      'PASS',
      'empty diff with no allowed globs is still clean → PASS',
    );

    // (c) A real out-of-policy change is a FAIL (distinct from the ERROR above).
    const escapee = await run('git_diff_policy', {
      configJson: JSON.stringify({ allowedGlobs: ['src/**'] }),
      changedPaths: ['secrets/.env'],
    });
    assert.equal(escapee.verdict, 'FAIL', 'an out-of-policy change is a FAIL, not an ERROR');
    assert.ok(escapee.summary.includes('secrets/.env'), 'FAIL summary names the offender');
  },
);

await check('manual_approval: approved → PASS, rejected → FAIL', async () => {
  const pass = await run('manual_approval', {
    configJson: '{}',
    approval: { approved: true, approver: 'mike' },
  });
  assert.equal(pass.verdict, 'PASS');
  const fail = await run('manual_approval', {
    configJson: '{}',
    approval: { approved: false, approver: 'mike' },
  });
  assert.equal(fail.verdict, 'FAIL');
});

await check('(b) manual_approval: no recorded approval → BLOCKED', async () => {
  const blocked = await run('manual_approval', { configJson: '{}', approval: null });
  assert.equal(blocked.verdict, 'BLOCKED', 'awaiting approval → BLOCKED, not FAIL/PASS');
});

await check('(d) llm_rubric_review: deterministic === false and returns SKIP', async () => {
  const evaluator = registry.get('llm_rubric_review');
  assert.equal(
    evaluator.deterministic,
    false,
    'llm_rubric_review must be flagged non-deterministic',
  );
  const result = await run('llm_rubric_review', { configJson: '{}' });
  assert.equal(result.verdict, 'SKIP', 'not wired as a gate in MS-003 → SKIP');
  // Every OTHER builtin must be deterministic.
  for (const e of registry.list()) {
    if (e.id === 'llm_rubric_review') continue;
    assert.equal(e.deterministic, true, `${e.id} must be deterministic`);
  }
});

await check(
  '(c) registry: get() throws UnknownEvaluatorError on unknown id; has() false',
  async () => {
    assert.equal(registry.has('command_exit_zero'), true);
    assert.equal(registry.has('does_not_exist'), false);
    assert.throws(
      () => registry.get('does_not_exist'),
      (err: unknown) => err instanceof UnknownEvaluatorError,
      'unknown evaluator id must throw UnknownEvaluatorError',
    );
  },
);

await check(
  'registry: list() returns all 9 P0 evaluators; duplicate register() throws',
  async () => {
    assert.equal(registry.list().length, 9, 'all 9 P0 evaluators registered');
    const empty = createEvaluatorRegistry();
    const fake = registry.get('file_exists');
    empty.register(fake);
    assert.throws(() => empty.register(fake), /already registered/, 'duplicate id rejected');
  },
);

const total = checks.length;
if (failed > 0) {
  console.error(`\nmission-evaluators: ${passed}/${total} passed (${failed} failed)`);
  process.exit(1);
}
console.log(`\nmission-evaluators: ${passed}/${total} passed`);
