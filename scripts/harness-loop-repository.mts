/**
 * Loop repository / service oracle (PR-07). Drives the LoopService + in-memory
 * Loop repos and asserts the persistence invariants:
 *   - revision immutability (insert-only) + monotonic numbering under concurrency;
 *   - SAVING a Loop has ZERO chat/mission side effects (asserted against a SHARED
 *     RuntimeRepositories whose mission + chat_threads + attempt stores are
 *     observed before/after);
 *   - definition archive vs physical delete (delete refused with invocation history);
 *   - skill binding order is preserved.
 *
 * Pure Node via tsx against `packages/core` source — no DOM, no renderer, no Pi.
 * The compiler model is INJECTED (a scripted fake). Style mirrors
 * scripts/harness-mission-service.mts.
 */

import assert from 'node:assert/strict';
import {
  type LoopServiceDeps,
  LoopServiceError,
  type LoopServiceRepos,
  createLoopService,
} from '../packages/core/src/loops/loop-service.ts';
import type { LoopCompileModel, LoopModelOutput } from '../packages/core/src/loops/types.ts';
import { createMemoryRepositories } from '../packages/core/src/runtime/memory-repositories.ts';

let passed = 0;
let failed = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
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

function makeDeps(): LoopServiceDeps {
  let idSeq = 0;
  let clockSeq = 0;
  return {
    newId: () => {
      idSeq += 1;
      return `id-${idSeq.toString().padStart(4, '0')}`;
    },
    now: () => {
      clockSeq += 1;
      return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, clockSeq)).toISOString();
    },
  };
}

/**
 * Build the LoopService over a FULL RuntimeRepositories so the no-side-effect
 * oracle can observe the mission + chat_threads + attempt stores. Returns both the
 * service and the shared repos.
 */
function freshSystem() {
  const repos = createMemoryRepositories();
  const loopRepos: LoopServiceRepos = {
    loopDefinitions: repos.loopDefinitions!,
    loopRevisions: repos.loopRevisions!,
    loopSkillBindings: repos.loopSkillBindings!,
    loopInvocations: repos.loopInvocations!,
  };
  const svc = createLoopService(loopRepos, makeDeps());
  return { repos, loopRepos, svc };
}

function fixedModel(output: LoopModelOutput): LoopCompileModel {
  return async () => output;
}

const READY_MODEL = fixedModel({
  structuredHints: {
    tier: 'standard',
    outcome: 'The feature works end to end and tests are green',
    acceptance: [
      {
        id: 'a1',
        description: 'tests pass',
        oracle: 'deterministic',
        evaluatorId: 'command_exit_zero',
        required: true,
      },
    ],
  },
});

const ctx = { companyId: 'co-1', projectId: 'proj-1', repository: { inspected: true } };

// ---------------------------------------------------------------------------
// Side-effect count helper: how many mission / chat_threads / attempt rows exist.
// ---------------------------------------------------------------------------
async function sideEffectCounts(repos: ReturnType<typeof createMemoryRepositories>) {
  const missions = await repos.missions!.listByCompany('co-1', { limit: 10000 });
  const chatThreads = repos.snapshot().chatThreads.length;
  // Attempts are per-mission; sum across missions.
  let attempts = 0;
  for (const m of missions) {
    attempts += (await repos.missionAttempts!.listByMission(m.mission_id)).length;
  }
  return { missions: missions.length, chatThreads, attempts };
}

// ---------------------------------------------------------------------------
// 1. SAVE has ZERO chat/mission side effects.
// ---------------------------------------------------------------------------

await check(
  'SAVING a Loop creates ONLY loop rows — zero mission / chat_thread / attempt writes',
  async () => {
    const { repos, svc } = freshSystem();
    const before = await sideEffectCounts(repos);

    const loop = await svc.createLoop({
      companyId: 'co-1',
      title: 'My loop',
      profileId: 'software-development',
    });
    const save = await svc.saveRevision(
      { loopId: loop.loopId, sourcePrompt: 'add search', context: ctx },
      READY_MODEL,
    );
    assert.equal(save.status, 'ready', 'compiled to ready');

    const after = await sideEffectCounts(repos);
    assert.deepEqual(
      after,
      before,
      `Save must not touch mission/chat/attempt stores: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    );

    // But the loop rows DID land.
    const revisions = await svc.listRevisions(loop.loopId);
    assert.equal(revisions.length, 1, 'exactly one revision was written');
    const def = await svc.getLoop(loop.loopId);
    assert.equal(def.status, 'ready', 'a ready revision flips the definition to ready');
    assert.equal(def.currentRevisionId, revisions[0]!.revisionId, 'the ready revision is selected');

    // And NO loop_invocations were created on save (PR-10 owns that).
    const invocations = await repos.loopInvocations!.listByLoop(loop.loopId);
    assert.equal(invocations.length, 0, 'Save creates no loop_invocation');
  },
);

// ---------------------------------------------------------------------------
// 2. Revision immutability + monotonic numbering.
// ---------------------------------------------------------------------------

await check('every edit appends a NEW immutable revision with a monotonic number', async () => {
  const { svc } = freshSystem();
  const loop = await svc.createLoop({
    companyId: 'co-1',
    title: 'L',
    profileId: 'software-development',
  });

  const r1 = await svc.saveRevision(
    { loopId: loop.loopId, sourcePrompt: 'v1 add login', context: ctx },
    READY_MODEL,
  );
  const r2 = await svc.saveRevision(
    { loopId: loop.loopId, sourcePrompt: 'v2 add logout too', context: ctx },
    READY_MODEL,
  );
  const r3 = await svc.saveRevision(
    { loopId: loop.loopId, sourcePrompt: 'v3 add 2fa support', context: ctx },
    READY_MODEL,
  );

  assert.equal(r1.revision.revisionNumber, 1);
  assert.equal(r2.revision.revisionNumber, 2);
  assert.equal(r3.revision.revisionNumber, 3);

  const all = await svc.listRevisions(loop.loopId);
  assert.equal(all.length, 3, 'three immutable revisions exist');
  // The first revision row is unchanged after later edits (immutable).
  const first = await svc.getRevision(r1.revision.revisionId);
  assert.equal(first.sourcePrompt, 'v1 add login', 'revision 1 source is unchanged');
  assert.equal(first.revisionNumber, 1, 'revision 1 number is unchanged');
});

await check(
  'concurrent save: two saves racing on the same loop get DISTINCT monotonic numbers (no duplicate)',
  async () => {
    const { svc } = freshSystem();
    const loop = await svc.createLoop({
      companyId: 'co-1',
      title: 'Race',
      profileId: 'software-development',
    });
    await svc.saveRevision(
      { loopId: loop.loopId, sourcePrompt: 'seed revision one', context: ctx },
      READY_MODEL,
    );

    // Fire two saves "concurrently". The in-memory revision repo enforces the
    // UNIQUE(loop_id, revision_number) invariant — one wins, the loser surfaces as
    // a concurrent_save error (the caller retries in production).
    const results = await Promise.allSettled([
      svc.saveRevision(
        { loopId: loop.loopId, sourcePrompt: 'concurrent edit A', context: ctx },
        READY_MODEL,
      ),
      svc.saveRevision(
        { loopId: loop.loopId, sourcePrompt: 'concurrent edit B', context: ctx },
        READY_MODEL,
      ),
    ]);

    const all = await svc.listRevisions(loop.loopId);
    const numbers = all.map((r) => r.revisionNumber).sort((a, b) => a - b);
    const unique = new Set(numbers);
    assert.equal(
      unique.size,
      numbers.length,
      `revision numbers must be unique, got ${JSON.stringify(numbers)}`,
    );
    // At least one save succeeded; any failure is the concurrency guard, not a crash.
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    assert.ok(fulfilled.length >= 1, 'at least one concurrent save succeeds');
    for (const r of results) {
      if (r.status === 'rejected') {
        assert.ok(
          r.reason instanceof LoopServiceError && r.reason.code === 'concurrent_save',
          'a losing concurrent save fails with concurrent_save, not a generic crash',
        );
      }
    }
  },
);

// ---------------------------------------------------------------------------
// 3. Archive vs physical delete.
// ---------------------------------------------------------------------------

await check(
  'deleteLoop without invocation history physically removes the definition + cascades',
  async () => {
    const { svc } = freshSystem();
    const loop = await svc.createLoop({
      companyId: 'co-1',
      title: 'Disposable',
      profileId: 'software-development',
    });
    await svc.saveRevision(
      { loopId: loop.loopId, sourcePrompt: 'something to compile', context: ctx },
      READY_MODEL,
    );

    await svc.deleteLoop(loop.loopId);
    await assert.rejects(
      () => svc.getLoop(loop.loopId),
      (err: unknown) => err instanceof LoopServiceError && err.code === 'loop_not_found',
      'a deleted loop is gone',
    );
  },
);

await check(
  'deleteLoop WITH invocation history is REFUSED — archive instead (revision survives)',
  async () => {
    const { repos, svc } = freshSystem();
    const loop = await svc.createLoop({
      companyId: 'co-1',
      title: 'Used',
      profileId: 'software-development',
    });
    const save = await svc.saveRevision(
      { loopId: loop.loopId, sourcePrompt: 'compile the thing', context: ctx },
      READY_MODEL,
    );

    // Simulate PR-10 having recorded an invocation (created at Office Send).
    await repos.loopInvocations!.insert({
      invocation_id: 'inv-1',
      loop_id: loop.loopId,
      revision_id: save.revision.revisionId,
      company_id: 'co-1',
      project_id: 'proj-1',
      thread_id: 'thr-1',
      message_id: 'msg-1',
      mission_id: null,
      status: 'pending',
      created_at: new Date(Date.UTC(2026, 0, 2)).toISOString(),
    });

    await assert.rejects(
      () => svc.deleteLoop(loop.loopId),
      (err: unknown) => err instanceof LoopServiceError && err.code === 'invocation_history',
      'physical delete is refused when invocation history exists',
    );

    // Archive succeeds, and the revision (with history) is preserved.
    const archived = await svc.archiveLoop(loop.loopId);
    assert.equal(archived.status, 'archived');
    const revisions = await svc.listRevisions(loop.loopId);
    assert.equal(revisions.length, 1, 'the revision with invocation history survives the archive');
  },
);

// ---------------------------------------------------------------------------
// 4. Skill binding order.
// ---------------------------------------------------------------------------

await check('skill bindings are persisted to the revision in supplied order', async () => {
  const { svc } = freshSystem();
  const loop = await svc.createLoop({
    companyId: 'co-1',
    title: 'Skilled',
    profileId: 'software-development',
  });
  const save = await svc.saveRevision(
    {
      loopId: loop.loopId,
      sourcePrompt: 'compile with skills attached',
      context: ctx,
      skills: [
        { skillId: 'sk-alpha', skillVersion: '1.0.0', config: { a: 1 } },
        { skillId: 'sk-beta', skillVersion: '2.0.0' },
        { skillId: 'sk-gamma', skillVersion: '3.0.0', config: { g: true } },
      ],
    },
    READY_MODEL,
  );
  const bindings = await svc.listSkillBindings(save.revision.revisionId);
  assert.equal(bindings.length, 3);
  assert.deepEqual(
    bindings.map((b) => b.skillId),
    ['sk-alpha', 'sk-beta', 'sk-gamma'],
    'bindings preserve supplied order',
  );
  assert.deepEqual(
    bindings.map((b) => b.orderIndex),
    [0, 1, 2],
    'order_index is 0..n',
  );
  assert.equal(JSON.parse(bindings[0]!.configJson).a, 1, 'config round-trips');
});

// ---------------------------------------------------------------------------
// 5. needs_input save persists the revision but does NOT select / flip ready.
// ---------------------------------------------------------------------------

await check(
  'a needs_input save persists a revision but leaves the definition in draft (not selected)',
  async () => {
    const { svc } = freshSystem();
    const loop = await svc.createLoop({
      companyId: 'co-1',
      title: 'Thin',
      profileId: 'software-development',
    });
    // A too-thin request → needs_input (the acceptance demo is asked).
    const thinModel = fixedModel({ structuredHints: { tier: 'standard', outcome: 'x' } });
    const save = await svc.saveRevision(
      { loopId: loop.loopId, sourcePrompt: 'go', context: ctx },
      thinModel,
    );
    assert.equal(save.status, 'needs_input', `expected needs_input, got ${save.status}`);
    assert.ok(save.questions.length >= 1, 'questions were persisted');

    const revisions = await svc.listRevisions(loop.loopId);
    assert.equal(
      revisions.length,
      1,
      'the needs_input revision is still persisted (immutable history)',
    );
    const def = await svc.getLoop(loop.loopId);
    assert.equal(def.status, 'draft', 'a needs_input save does not flip the loop to ready');
    assert.equal(def.currentRevisionId, undefined, 'a needs_input revision is not auto-selected');
  },
);

// ---------------------------------------------------------------------------
// 6. Duplicate primary-key ids THROW (never silently drop). A silent no-op on a
//    duplicate definition would hide a real id clash, and a silent drop of a
//    skill binding would change the loop's resolved skills (its behavior).
// ---------------------------------------------------------------------------

await check('a duplicate loop_definition id THROWS (no silent drop)', async () => {
  const { repos } = freshSystem();
  const row = {
    loop_id: 'dup-loop',
    company_id: 'co-1',
    title: 'first',
    summary: '',
    profile_id: 'software-development',
    current_revision_id: null,
    status: 'draft',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  await repos.loopDefinitions!.insert(row);
  await assert.rejects(
    () => repos.loopDefinitions!.insert({ ...row, title: 'second (should not clobber)' }),
    /loop_definitions PRIMARY KEY|UNIQUE|constraint/i,
    'a duplicate loop_id must throw, not silently no-op',
  );
  // The first row is untouched (the second insert did not clobber or hide it).
  const persisted = await repos.loopDefinitions!.findById('dup-loop');
  assert.equal(persisted?.title, 'first', 'the original definition is intact');
});

await check('a duplicate loop_skill_binding id THROWS (no silent drop of a binding)', async () => {
  const { repos } = freshSystem();
  const binding = {
    binding_id: 'dup-bind',
    revision_id: 'rev-x',
    skill_id: 'sk-1',
    skill_version: '1.0.0',
    order_index: 0,
    config_json: '{}',
  };
  await repos.loopSkillBindings!.insert(binding);
  await assert.rejects(
    () => repos.loopSkillBindings!.insert({ ...binding, skill_id: 'sk-2' }),
    /loop_skill_bindings PRIMARY KEY|UNIQUE|constraint/i,
    'a duplicate binding_id must throw, not silently drop the binding',
  );
  const bindings = await repos.loopSkillBindings!.listByRevision('rev-x');
  assert.equal(bindings.length, 1, 'exactly one binding survived');
  assert.equal(bindings[0]!.skill_id, 'sk-1', 'the original binding is intact');
});

if (failed > 0) {
  console.error(`\nloop-repository: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nloop-repository: ${passed} checks passed`);
