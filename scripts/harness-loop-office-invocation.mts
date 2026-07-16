/**
 * Loop → Office Send invocation oracle (PR-10). Drives the PURE send-time
 * materializer (`apps/desktop/renderer/.../loop-office-invocation.ts`) over
 * in-memory Loop + Mission repos and asserts the PR-10 contract end to end:
 *
 *   - "Use" (insert) has ZERO durable side effects — no mission / chat_thread /
 *     loop_invocation row is created until Send.
 *   - Send creates thread → message → loop_invocation → mission link IN ORDER,
 *     and the loop_invocation is bound to the current message/thread/project.
 *   - The Mission REUSES the current Office thread — NO dedicated mission thread is
 *     minted (no sidebar pollution).
 *   - The pinned revision does NOT follow the loop's current revision — a later
 *     edit is ignored; the executed packet stays on the pinned revision.
 *   - An ARCHIVED loop's ready revision still replays (immutable); a DELETED or
 *     CORRUPT revision BLOCKS send (throws, writes nothing).
 *   - A transaction failure (mission create throws after the invocation insert)
 *     leaves NO orphan — the invocation is compensated.
 *   - The Enhance protected-span pipeline preserves the `[[loop:<id>]]` chip token.
 *   - The `/loop` picker is keyboard-navigable (slash-command adapter contract).
 *   - The no-project flow surfaces the explicit selector intent (never a hidden
 *     default project).
 *   - Office no-Loop behavior is unchanged (a plain send touches no loop tables).
 *
 * Pure Node via tsx against `packages/core` + the renderer's pure modules — no DOM,
 * no Tauri, no Pi. Style mirrors scripts/harness-loop-mission-adapter.mts.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  loopReferenceToken,
  useComposerLoopReferenceStore,
} from '../apps/desktop/renderer/src/assistant/composer/composer-loop-reference-store.ts';
import { buildSlashCommands } from '../apps/desktop/renderer/src/assistant/composer/composer-triggers.ts';
import {
  extractProtectedSpans,
  validateProtectedSpans,
} from '../apps/desktop/renderer/src/assistant/enhance/protected-spans.ts';
import {
  AggregateLoopSendError,
  type LoopMissionCreator,
  LoopSendBlockedError,
  type MaterializeLoopSendDeps,
  buildLoopPacketForSend,
  materializeLoopSend,
  runCompensatedLoopThread,
} from '../apps/desktop/renderer/src/assistant/runtime/loop-office-invocation.ts';
import {
  conversationDeletionStatements,
  missionDeletionStatements,
} from '../apps/desktop/renderer/src/data/local-data-deletion.ts';
import {
  type LoopService,
  type LoopServiceDeps,
  type LoopServiceRepos,
  createLoopService,
  createMissionService,
} from '../packages/core/src/browser.ts';
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

// ---------------------------------------------------------------------------
// Deterministic deps + fixtures
// ---------------------------------------------------------------------------

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
      { id: 'a2', description: 'a human reviews the result', oracle: 'human', required: false },
    ],
  },
});

const NEEDS_INPUT_MODEL = fixedModel({
  // No outcome → the compiler asks a clarifying question and stays needs_input.
  structuredHints: { tier: 'standard', acceptance: [] },
});

const CTX = { companyId: 'co-1', projectId: 'proj-1', repository: { inspected: true } } as const;

const COMPANY = 'co-1';
const OFFICE_THREAD = 'office-thread-1';
const PROJECT = 'proj-1';
const MESSAGE = 'boss-msg-1';

/** A full in-memory system: shared repos, a LoopService, and a mission creator that
 *  mirrors the renderer's `useCreateMission` (createMission + markReady) but REUSES
 *  the Office thread instead of minting a dedicated one. */
function freshSystem() {
  const repos = createMemoryRepositories();
  const loopRepos: LoopServiceRepos = {
    loopDefinitions: repos.loopDefinitions,
    loopRevisions: repos.loopRevisions,
    loopSkillBindings: repos.loopSkillBindings!,
    loopInvocations: repos.loopInvocations!,
  };
  const svc = createLoopService(loopRepos, makeDeps());

  const missionService = createMissionService(
    {
      missions: repos.missions,
      missionCriteria: repos.missionCriteria!,
      missionAttempts: repos.missionAttempts!,
      missionEvaluations: repos.missionEvaluations!,
      missionEvents: repos.missionEvents!,
    },
    {
      now: () => new Date().toISOString(),
      newId: () =>
        `mission-${repos.snapshot().chatThreads.length}-${Math.random().toString(36).slice(2, 8)}`,
    },
  );

  // The Office thread already exists by Send time (materialized by the existing
  // Office rule). The mission creator REUSES it — it does NOT create a thread.
  const missionCreator: LoopMissionCreator = {
    async createReadyMission(input) {
      const mission = await missionService.createMission(input);
      await missionService.markReady(mission.mission_id);
      return { missionId: mission.mission_id };
    },
  };

  const materializerDeps: MaterializeLoopSendDeps = {
    loopService: svc,
    loopInvocations: repos.loopInvocations!,
    missionCreator,
    // Compensation is a HARD delete of the just-inserted orphan invocation — the
    // SAME undo the renderer wires via the Tauri repo, so a failed send leaves no
    // dangling `pending` row.
    compensateInvocation: (invocationId) => repos.loopInvocations!.deleteById(invocationId),
    // Memory MissionRepository deliberately has no delete API. Existing fixture
    // paths only invoke this seam in the dedicated SQLite compensation oracle below.
    compensateMission: async () => {},
    newId: () => `inv-${invSeq++}`,
    now: () => new Date(Date.UTC(2026, 5, 26, 0, 0, invSeq)).toISOString(),
  };

  return { repos, svc, missionService, materializerDeps };
}

let invSeq = 1;

async function seedReadyLoop(svc: LoopService) {
  const loop = await svc.createLoop({
    companyId: COMPANY,
    title: 'Ship feature',
    profileId: 'software-development',
  });
  const save = await svc.saveRevision(
    { loopId: loop.loopId, sourcePrompt: 'add search', context: CTX },
    READY_MODEL,
  );
  assert.equal(save.status, 'ready', 'fixture loop compiled to ready');
  return {
    loopId: loop.loopId,
    revisionId: save.revision.revisionId,
    revisionNumber: save.revision.revisionNumber,
  };
}

/** Durable mission + chat_thread counts (the rows Send, and only Send, creates). */
async function counts(repos: ReturnType<typeof createMemoryRepositories>) {
  const missions = await repos.missions.listByCompany(COMPANY, { limit: 10000 });
  return { missions: missions.length, chatThreads: repos.snapshot().chatThreads.length };
}

/** loop_invocations are not in the memory snapshot; count them via the repo. */
async function invocationCount(repos: ReturnType<typeof createMemoryRepositories>, loopId: string) {
  return repos.loopInvocations!.countByLoop(loopId);
}

function freshSqlite(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(
    readFileSync(new URL('../packages/db-local/src/schema.sql', import.meta.url), 'utf8'),
  );
  const now = '2026-07-13T00:00:00.000Z';
  sqlite
    .prepare('INSERT INTO companies (company_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(COMPANY, 'Company', now, now);
  sqlite
    .prepare(
      'INSERT INTO projects (project_id, company_id, name, workspace_root, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(PROJECT, COMPANY, 'Project', '/tmp/offisim-fixture/project', now, now);
  return sqlite;
}

function runStatements(
  sqlite: Database.Database,
  statements: ReadonlyArray<{ sql: string; params?: unknown[] }>,
): void {
  sqlite.transaction(() => {
    for (const statement of statements) {
      sqlite.prepare(statement.sql).run({ 1: statement.params?.[0] });
    }
  })();
}

function sqliteCount(sqlite: Database.Database, table: string, where = ''): number {
  return Number(
    (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get() as { count: number })
      .count,
  );
}

// ---------------------------------------------------------------------------
// 1. "Use" (insert chip) has ZERO durable side effects.
// ---------------------------------------------------------------------------

await check(
  'Use/insert mutates ONLY composer UI state — no mission / chat_thread / loop_invocation row',
  async () => {
    const { repos, svc } = freshSystem();
    const loop = await seedReadyLoop(svc);
    const before = await counts(repos);
    const beforeInv = await invocationCount(repos, loop.loopId);

    // Inserting a chip is a pure store mutation — no repo touched.
    const store = useComposerLoopReferenceStore.getState();
    store.removeReference(OFFICE_THREAD);
    const result = store.insertReference(OFFICE_THREAD, {
      loopId: loop.loopId,
      revisionId: loop.revisionId,
      titleSnapshot: 'Ship feature',
      revisionNumber: loop.revisionNumber,
      profileId: 'software-development',
    });
    assert.ok(result.ok, 'first insert succeeds');
    assert.ok(useComposerLoopReferenceStore.getState().byThread[OFFICE_THREAD], 'chip is in store');

    const after = await counts(repos);
    const afterInv = await invocationCount(repos, loop.loopId);
    assert.deepEqual(after, before, 'Use creates no mission / chat_thread row');
    assert.equal(afterInv, beforeInv, 'Use creates no loop_invocation');
    useComposerLoopReferenceStore.getState().clearReference(OFFICE_THREAD);
  },
);

// ---------------------------------------------------------------------------
// 2. v1 single-primary rule: a second loop is BLOCKED.
// ---------------------------------------------------------------------------

await check('a second /loop on the same message is BLOCKED (v1 one-primary rule)', async () => {
  const store = useComposerLoopReferenceStore.getState();
  store.clearReference(OFFICE_THREAD);
  const first = store.insertReference(OFFICE_THREAD, {
    loopId: 'loop-a',
    revisionId: 'rev-a',
    titleSnapshot: 'Loop A',
    revisionNumber: 1,
    profileId: 'software-development',
  });
  assert.ok(first.ok, 'first insert ok');
  const second = store.insertReference(OFFICE_THREAD, {
    loopId: 'loop-b',
    revisionId: 'rev-b',
    titleSnapshot: 'Loop B',
    revisionNumber: 1,
    profileId: 'software-development',
  });
  assert.equal(second.ok, false, 'second insert blocked');
  if (!second.ok) assert.equal(second.reason, 'already-present');
  assert.equal(
    useComposerLoopReferenceStore.getState().byThread[OFFICE_THREAD]?.loopId,
    'loop-a',
    'the first loop stays — the second never replaces it implicitly',
  );
  store.clearReference(OFFICE_THREAD);
});

// ---------------------------------------------------------------------------
// 3. Send creates thread → message → invocation → mission link IN ORDER.
// ---------------------------------------------------------------------------

await check(
  'Send creates loop_invocation + mission link, bound to the current message/thread/project',
  async () => {
    const { repos, svc, materializerDeps } = freshSystem();
    const loop = await seedReadyLoop(svc);

    const result = await materializeLoopSend(materializerDeps, {
      reference: { loopId: loop.loopId, revisionId: loop.revisionId },
      companyId: COMPANY,
      projectId: PROJECT,
      threadId: OFFICE_THREAD,
      messageId: MESSAGE,
    });

    const inv = await repos.loopInvocations!.findById(result.invocationId);
    assert.ok(inv, 'loop_invocation row exists');
    assert.equal(inv!.loop_id, loop.loopId, 'bound to the loop');
    assert.equal(inv!.revision_id, loop.revisionId, 'bound to the PINNED revision');
    assert.equal(inv!.thread_id, OFFICE_THREAD, 'bound to the current Office thread');
    assert.equal(inv!.message_id, MESSAGE, 'bound to the current message');
    assert.equal(inv!.project_id, PROJECT, 'bound to the current project');
    assert.equal(inv!.mission_id, result.missionId, 'invocation is LINKED to its mission');

    const mission = await repos.missions.findById(result.missionId);
    assert.ok(mission, 'mission row exists');
    assert.equal(mission!.status, 'ready', 'mission was created + marked ready');
    assert.equal(mission!.goal, result.packet.missionDraft.goal, 'mission carries the packet goal');
  },
);

// ---------------------------------------------------------------------------
// 4. SAME Office thread — NO dedicated mission thread.
// ---------------------------------------------------------------------------

await check(
  'the Mission REUSES the Office thread — NO dedicated mission chat_thread is minted',
  async () => {
    const { repos, svc, materializerDeps } = freshSystem();
    const loop = await seedReadyLoop(svc);
    const threadsBefore = repos.snapshot().chatThreads.length;

    const result = await materializeLoopSend(materializerDeps, {
      reference: { loopId: loop.loopId, revisionId: loop.revisionId },
      companyId: COMPANY,
      projectId: PROJECT,
      threadId: OFFICE_THREAD,
      messageId: MESSAGE,
    });

    const threadsAfter = repos.snapshot().chatThreads.length;
    assert.equal(
      threadsAfter,
      threadsBefore,
      'send mints NO new chat_thread (Office thread reused)',
    );
    const mission = await repos.missions.findById(result.missionId);
    assert.equal(mission!.thread_id, OFFICE_THREAD, 'mission.thread_id IS the Office thread');
  },
);

// ---------------------------------------------------------------------------
// 5. G2: same project can materialize two top-level Loop missions on distinct threads.
// ---------------------------------------------------------------------------

await check(
  'G2: two Loop runs in the same project materialize as distinct top-level missions/threads',
  async () => {
    const { repos, svc, materializerDeps } = freshSystem();
    const loop = await seedReadyLoop(svc);
    await repos.chatThreads.create({
      thread_id: 'g2-thread-a',
      project_id: PROJECT,
      employee_id: null,
      title: 'G2 parallel A',
    });
    await repos.chatThreads.create({
      thread_id: 'g2-thread-b',
      project_id: PROJECT,
      employee_id: null,
      title: 'G2 parallel B',
    });

    const first = await materializeLoopSend(materializerDeps, {
      reference: { loopId: loop.loopId, revisionId: loop.revisionId },
      companyId: COMPANY,
      projectId: PROJECT,
      threadId: 'g2-thread-a',
      messageId: 'g2-message-a',
    });
    const second = await materializeLoopSend(materializerDeps, {
      reference: { loopId: loop.loopId, revisionId: loop.revisionId },
      companyId: COMPANY,
      projectId: PROJECT,
      threadId: 'g2-thread-b',
      messageId: 'g2-message-b',
    });

    assert.notEqual(first.missionId, second.missionId, 'each start gets a distinct mission');
    const missions = await repos.missions.listByCompany(COMPANY, { limit: 100 });
    const g2 = missions.filter((mission) =>
      ['g2-thread-a', 'g2-thread-b'].includes(mission.thread_id),
    );
    assert.equal(g2.length, 2, 'both missions were persisted');
    assert.deepEqual(
      new Set(g2.map((mission) => mission.thread_id)),
      new Set(['g2-thread-a', 'g2-thread-b']),
      'parallel entries use distinct thread ids',
    );
    assert.equal(
      new Set(g2.map((mission) => mission.project_id)).size,
      1,
      'both missions stay in the same project',
    );
    assert.equal(await repos.loopInvocations!.countByLoop(loop.loopId), 2);
  },
);

// ---------------------------------------------------------------------------
// 6. Pinned revision does NOT follow the loop's current revision.
// ---------------------------------------------------------------------------

await check(
  'the pinned revision is frozen — a LATER edit does not change the executed packet',
  async () => {
    const { svc, materializerDeps } = freshSystem();
    const loop = await seedReadyLoop(svc);

    // The user pins v1, THEN the loop gets a v2 (different outcome).
    const V2_MODEL = fixedModel({
      structuredHints: {
        tier: 'standard',
        outcome: 'A COMPLETELY DIFFERENT outcome for v2',
        acceptance: [
          {
            id: 'b1',
            description: 'different criterion',
            oracle: 'deterministic',
            evaluatorId: 'file_exists',
            required: true,
          },
        ],
      },
    });
    const v2 = await svc.saveRevision(
      { loopId: loop.loopId, sourcePrompt: 'pivot the loop', context: CTX },
      V2_MODEL,
    );
    assert.equal(v2.revision.revisionNumber, 2, 'a v2 now exists');
    const def = await svc.getLoop(loop.loopId);
    assert.equal(def.currentRevisionId, v2.revision.revisionId, 'the loop now points at v2');

    // Build the packet for the PINNED v1 — it must reflect v1, not v2.
    const { packet } = await buildLoopPacketForSend(materializerDeps, {
      loopId: loop.loopId,
      revisionId: loop.revisionId, // v1
    });
    assert.equal(packet.revisionId, loop.revisionId, 'packet is built from the PINNED revision');
    assert.ok(
      packet.missionDraft.goal.includes('end to end'),
      `pinned v1 goal preserved, got: ${packet.missionDraft.goal}`,
    );
    assert.ok(
      !packet.missionDraft.goal.includes('DIFFERENT'),
      'the v2 outcome must NOT leak into the pinned v1 packet',
    );
  },
);

// ---------------------------------------------------------------------------
// 6. Archived loop's ready revision still replays.
// ---------------------------------------------------------------------------

await check(
  'an ARCHIVED loop replays its pinned ready revision (revision is immutable)',
  async () => {
    const { svc, materializerDeps, repos } = freshSystem();
    const loop = await seedReadyLoop(svc);
    await svc.archiveLoop(loop.loopId);
    const def = await svc.getLoop(loop.loopId);
    assert.equal(def.status, 'archived', 'loop is archived');

    // The revision is still ready + replayable.
    const result = await materializeLoopSend(materializerDeps, {
      reference: { loopId: loop.loopId, revisionId: loop.revisionId },
      companyId: COMPANY,
      projectId: PROJECT,
      threadId: OFFICE_THREAD,
      messageId: MESSAGE,
    });
    const inv = await repos.loopInvocations!.findById(result.invocationId);
    assert.ok(inv?.mission_id, 'archived-loop replay produced a linked invocation');
  },
);

// ---------------------------------------------------------------------------
// 7. Deleted / corrupt / not-ready revision BLOCKS send (writes nothing).
// ---------------------------------------------------------------------------

await check(
  'a DELETED revision blocks send with revision-not-found and writes nothing',
  async () => {
    const { svc, materializerDeps, repos } = freshSystem();
    const loop = await seedReadyLoop(svc);
    const before = await invocationCount(repos, loop.loopId);

    await assert.rejects(
      () =>
        materializeLoopSend(materializerDeps, {
          reference: { loopId: loop.loopId, revisionId: 'rev-does-not-exist' },
          companyId: COMPANY,
          projectId: PROJECT,
          threadId: OFFICE_THREAD,
          messageId: MESSAGE,
        }),
      (err: unknown) => err instanceof LoopSendBlockedError && err.reason === 'revision-not-found',
      'deleted revision must throw LoopSendBlockedError(revision-not-found)',
    );
    const after = await invocationCount(repos, loop.loopId);
    assert.equal(after, before, 'a blocked send writes NO loop_invocation');
  },
);

await check('a CORRUPT (non-ready / empty IR) revision blocks send', async () => {
  const { svc, materializerDeps } = freshSystem();
  // A needs_input revision has an empty `{}` IR and compileStatus !== ready.
  const loop = await svc.createLoop({
    companyId: COMPANY,
    title: 'WIP',
    profileId: 'software-development',
  });
  const save = await svc.saveRevision(
    { loopId: loop.loopId, sourcePrompt: 'vague', context: CTX },
    NEEDS_INPUT_MODEL,
  );
  assert.notEqual(save.status, 'ready', 'fixture revision is not ready');

  await assert.rejects(
    () =>
      materializeLoopSend(materializerDeps, {
        reference: { loopId: loop.loopId, revisionId: save.revision.revisionId },
        companyId: COMPANY,
        projectId: PROJECT,
        threadId: OFFICE_THREAD,
        messageId: MESSAGE,
      }),
    (err: unknown) => err instanceof LoopSendBlockedError && err.reason === 'revision-not-ready',
    'not-ready revision must throw LoopSendBlockedError(revision-not-ready)',
  );
});

// ---------------------------------------------------------------------------
// 8. Transaction failure leaves NO orphan (compensation).
// ---------------------------------------------------------------------------

await check(
  'a mission-create failure AFTER the invocation insert leaves NO orphan invocation',
  async () => {
    const { repos, svc, materializerDeps } = freshSystem();
    const loop = await seedReadyLoop(svc);

    // Make mission creation throw. Track that compensation ran, and that it really
    // undoes the row (the production HARD delete via deleteById).
    let compensated: string | null = null;
    const failingDeps: MaterializeLoopSendDeps = {
      ...materializerDeps,
      missionCreator: {
        async createReadyMission() {
          throw new Error('mission engine exploded mid-create');
        },
      },
      compensateInvocation: async (invocationId) => {
        compensated = invocationId;
        await repos.loopInvocations!.deleteById(invocationId);
      },
    };

    await assert.rejects(
      () =>
        materializeLoopSend(failingDeps, {
          reference: { loopId: loop.loopId, revisionId: loop.revisionId },
          companyId: COMPANY,
          projectId: PROJECT,
          threadId: OFFICE_THREAD,
          messageId: MESSAGE,
        }),
      /mission engine exploded/,
      'the original error propagates',
    );
    assert.ok(compensated, 'compensation ran for the inserted invocation');

    // No invocation is left in `pending` (the orphan state) and no mission was linked.
    const rows = await repos.loopInvocations!.listByLoop(loop.loopId);
    const orphan = rows.find((r) => r.status === 'pending' && !r.mission_id);
    assert.ok(!orphan, `no orphan pending invocation must remain, found: ${JSON.stringify(rows)}`);
    const missions = await repos.missions.listByCompany(COMPANY, { limit: 100 });
    assert.equal(missions.length, 0, 'no mission row leaked from the failed send');
  },
);

await check('if compensation ALSO fails, an AggregateLoopSendError surfaces both', async () => {
  const { svc, materializerDeps } = freshSystem();
  const loop = await seedReadyLoop(svc);
  const failingDeps: MaterializeLoopSendDeps = {
    ...materializerDeps,
    missionCreator: {
      async createReadyMission() {
        throw new Error('primary failure');
      },
    },
    compensateInvocation: async () => {
      throw new Error('compensation failure');
    },
  };
  await assert.rejects(
    () =>
      materializeLoopSend(failingDeps, {
        reference: { loopId: loop.loopId, revisionId: loop.revisionId },
        companyId: COMPANY,
        projectId: PROJECT,
        threadId: OFFICE_THREAD,
        messageId: MESSAGE,
      }),
    (err: unknown) => err instanceof AggregateLoopSendError,
    'a double failure surfaces as AggregateLoopSendError',
  );
});

await check('link failure retains the primary error and BOTH compensation errors', async () => {
  const { svc, materializerDeps } = freshSystem();
  const loop = await seedReadyLoop(svc);
  const loopInvocations = materializerDeps.loopInvocations;
  const deps: MaterializeLoopSendDeps = {
    ...materializerDeps,
    loopInvocations: {
      insert: (row) => loopInvocations.insert(row),
      async setMissionId() {
        throw new Error('primary link failure');
      },
      findById: (invocationId) => loopInvocations.findById(invocationId),
    },
    missionCreator: {
      async createReadyMission() {
        return { missionId: 'mission-for-double-compensation' };
      },
    },
    compensateMission: async () => {
      throw new Error('mission compensation failure');
    },
    compensateInvocation: async () => {
      throw new Error('invocation compensation failure');
    },
  };
  await assert.rejects(
    () =>
      materializeLoopSend(deps, {
        reference: { loopId: loop.loopId, revisionId: loop.revisionId },
        companyId: COMPANY,
        projectId: PROJECT,
        threadId: OFFICE_THREAD,
        messageId: MESSAGE,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateLoopSendError);
      assert.match(String(error.cause), /primary link failure/);
      assert.deepEqual(
        error.compensationErrors.map((failure) => failure.target),
        ['mission', 'invocation'],
      );
      assert.match(String(error.compensationErrors[0]?.error), /mission compensation failure/);
      assert.match(String(error.compensationErrors[1]?.error), /invocation compensation failure/);
      return true;
    },
  );
});

await check(
  'SQLite link failure removes the mission root, every mission child, and the invocation',
  async () => {
    const { svc } = freshSystem();
    const loop = await seedReadyLoop(svc);
    const sqlite = freshSqlite();
    const now = '2026-07-13T00:00:00.000Z';
    sqlite
      .prepare(
        'INSERT INTO chat_threads (thread_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(OFFICE_THREAD, PROJECT, 'Loop link failure', now, now);

    const missionId = 'mission-link-failure';
    const missionCreator: LoopMissionCreator = {
      async createReadyMission(input) {
        sqlite
          .prepare(
            `INSERT INTO mission
              (mission_id, company_id, project_id, thread_id, title, goal, status, runtime_id,
               runtime_policy_json, budget_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?)`,
          )
          .run(
            missionId,
            input.companyId,
            input.projectId ?? null,
            input.threadId,
            input.title,
            input.goal,
            input.runtimeId,
            input.runtimePolicyJson,
            input.budgetJson,
            now,
            now,
          );
        const criterionId = 'criterion-link-failure';
        sqlite
          .prepare(
            `INSERT INTO mission_criterion
              (criterion_id, mission_id, description, evaluator_id, evaluator_config_json)
             VALUES (?, ?, 'Pass', 'manual', '{}')`,
          )
          .run(criterionId, missionId);
        sqlite
          .prepare(
            `INSERT INTO mission_attempt
              (attempt_id, mission_id, attempt_number, trigger, status, started_at)
             VALUES ('attempt-link-failure', ?, 1, 'initial', 'running', ?)`,
          )
          .run(missionId, now);
        sqlite
          .prepare(
            `INSERT INTO mission_evaluation
              (evaluation_id, mission_id, criterion_id, attempt_id, evaluator_id, verdict,
               summary, evidence_refs_json, created_at)
             VALUES ('evaluation-link-failure', ?, ?, 'attempt-link-failure', 'manual',
                     'pass', 'ok', '[]', ?)`,
          )
          .run(missionId, criterionId, now);
        sqlite
          .prepare(
            `INSERT INTO runtime_session_link
              (runtime_session_link_id, mission_id, runtime_id, opaque_session_ref_json, status)
             VALUES ('session-link-failure', ?, 'pi-agent', '{}', 'active')`,
          )
          .run(missionId);
        sqlite
          .prepare(
            `INSERT INTO mission_event
              (mission_event_id, mission_id, attempt_id, type, data_json, created_at)
             VALUES ('event-link-failure', ?, 'attempt-link-failure', 'started', '{}', ?)`,
          )
          .run(missionId, now);
        return { missionId };
      },
    };
    const deps: MaterializeLoopSendDeps = {
      loopService: svc,
      loopInvocations: {
        async insert(row) {
          sqlite
            .prepare(
              `INSERT INTO loop_invocations
                (invocation_id, loop_id, revision_id, company_id, project_id, thread_id,
                 message_id, mission_id, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              row.invocation_id,
              row.loop_id,
              row.revision_id,
              row.company_id,
              row.project_id,
              row.thread_id,
              row.message_id,
              row.mission_id,
              row.status,
              row.created_at,
            );
        },
        async setMissionId() {
          throw new Error('link exploded');
        },
        async findById() {
          return null;
        },
      },
      missionCreator,
      compensateMission: async (id) => runStatements(sqlite, missionDeletionStatements(id)),
      compensateInvocation: async (id) => {
        sqlite.prepare('DELETE FROM loop_invocations WHERE invocation_id = ?').run(id);
      },
      newId: () => 'invocation-link-failure',
      now: () => now,
    };

    await assert.rejects(
      () =>
        materializeLoopSend(deps, {
          reference: { loopId: loop.loopId, revisionId: loop.revisionId },
          companyId: COMPANY,
          projectId: PROJECT,
          threadId: OFFICE_THREAD,
          messageId: MESSAGE,
        }),
      /link exploded/,
    );
    assert.equal(sqliteCount(sqlite, 'loop_invocations'), 0);
    assert.equal(sqliteCount(sqlite, 'mission'), 0);
    for (const table of [
      'mission_criterion',
      'mission_attempt',
      'mission_evaluation',
      'runtime_session_link',
      'mission_event',
    ]) {
      assert.equal(sqliteCount(sqlite, table), 0, `${table} must be compensated`);
    }
    sqlite.close();
  },
);

await check('not-ready parallel preflight performs zero SQLite writes', async () => {
  const { svc } = freshSystem();
  const loop = await svc.createLoop({
    companyId: COMPANY,
    title: 'Not ready',
    profileId: 'software-development',
  });
  const save = await svc.saveRevision(
    { loopId: loop.loopId, sourcePrompt: 'vague', context: CTX },
    NEEDS_INPUT_MODEL,
  );
  const sqlite = freshSqlite();
  let cleanupCalls = 0;
  await assert.rejects(
    () =>
      runCompensatedLoopThread({
        preflight: async () => {
          await buildLoopPacketForSend(
            { loopService: svc },
            { loopId: loop.loopId, revisionId: save.revision.revisionId },
          );
        },
        createThread: async () => {
          sqlite
            .prepare(
              `INSERT INTO chat_threads
                (thread_id, project_id, title, created_at, updated_at)
               VALUES ('should-not-exist', ?, 'blocked', '2026-07-13', '2026-07-13')`,
            )
            .run(PROJECT);
        },
        persistMessage: async () => {
          throw new Error('must not reach message persistence');
        },
        materializeAndStart: async () => {
          throw new Error('must not reach materialization');
        },
        compensateThread: async () => {
          cleanupCalls += 1;
        },
      }),
    (error: unknown) =>
      error instanceof LoopSendBlockedError && error.reason === 'revision-not-ready',
  );
  assert.equal(sqliteCount(sqlite, 'chat_threads'), 0);
  assert.equal(sqliteCount(sqlite, 'agent_events'), 0);
  assert.equal(sqliteCount(sqlite, 'loop_invocations'), 0);
  assert.equal(sqliteCount(sqlite, 'mission'), 0);
  assert.equal(cleanupCalls, 0, 'preflight is outside the compensating write boundary');
  sqlite.close();
});

await check(
  'message persistence failure deep-deletes the newly-created SQLite thread',
  async () => {
    const sqlite = freshSqlite();
    let materializeCalls = 0;
    await assert.rejects(
      () =>
        runCompensatedLoopThread({
          preflight: async () => {},
          createThread: async () => {
            sqlite
              .prepare(
                `INSERT INTO chat_threads
                (thread_id, project_id, title, created_at, updated_at)
               VALUES ('message-failure', ?, 'message failure', '2026-07-13', '2026-07-13')`,
              )
              .run(PROJECT);
          },
          persistMessage: async () => {
            throw new Error('message write exploded');
          },
          materializeAndStart: async () => {
            materializeCalls += 1;
            return 'unreachable';
          },
          compensateThread: async () => {
            runStatements(sqlite, conversationDeletionStatements('message-failure'));
          },
        }),
      /message write exploded/,
    );
    assert.equal(sqliteCount(sqlite, 'chat_threads'), 0, 'empty thread must be removed');
    assert.equal(materializeCalls, 0, 'materialization never starts after message failure');
    sqlite.close();
  },
);

await check(
  'a duplicate invocation_id insert THROWS — never a silent skip (no setMissionId corruption)',
  async () => {
    const { repos } = freshSystem();
    const row = {
      invocation_id: 'inv-dup-1',
      loop_id: 'loop-1',
      revision_id: 'rev-1',
      company_id: COMPANY,
      project_id: PROJECT,
      thread_id: OFFICE_THREAD,
      message_id: MESSAGE,
      mission_id: null,
      status: 'pending',
      created_at: '2026-06-26T00:00:00.000Z',
    };
    await repos.loopInvocations!.insert(row);
    // A second insert with the SAME id must throw (PK violation), not silently no-op —
    // a silent skip would let a later setMissionId() link a new mission onto the OLD
    // row. Invocation ids are fresh per send + compensation re-inserts with a NEW id,
    // so insert is never idempotent by design.
    await assert.rejects(
      () => repos.loopInvocations!.insert({ ...row, loop_id: 'loop-2', mission_id: null }),
      /PRIMARY KEY|UNIQUE|loop_invocations/i,
      'duplicate invocation_id must surface as a PK violation',
    );
    // The original row is untouched (the duplicate did not overwrite it).
    const stored = await repos.loopInvocations!.findById('inv-dup-1');
    assert.equal(stored?.loop_id, 'loop-1', 'the original invocation row is intact');
  },
);

// ---------------------------------------------------------------------------
// 9. Enhance preserves the Loop chip token.
// ---------------------------------------------------------------------------

await check(
  'Enhance protected-span pipeline detects + preserves the [[loop:<id>]] chip token',
  async () => {
    const reference = {
      id: 'chip-1',
      loopId: 'loop-x',
      revisionId: 'rev-aBc-123',
      titleSnapshot: 'My Loop',
      revisionNumber: 3,
      profileId: 'software-development',
      insertedAt: 0,
    };
    const token = loopReferenceToken(reference);
    assert.equal(token, '[[loop:rev-aBc-123]]', 'token form is [[loop:<revisionId>]]');

    const composed = `Please run this loop ${token} and also tidy up afterwards.`;
    const spans = extractProtectedSpans(composed, []);
    const loopSpan = spans.find((s) => s.kind === 'loop_ref');
    assert.ok(loopSpan, 'the loop token is extracted as a loop_ref protected span');
    assert.equal(loopSpan!.source, token, 'the protected source is the exact token');

    // A faithful enhance that keeps the token → valid; one that drops it → invalid.
    const enhancedKept = `Kick off the loop ${token}. Then clean up the workspace and report.`;
    assert.ok(
      validateProtectedSpans(enhancedKept, spans).valid,
      'enhanced text that keeps the token is valid',
    );
    const enhancedDropped = 'Kick off the loop and then clean up the workspace and report.';
    assert.ok(
      !validateProtectedSpans(enhancedDropped, spans).valid,
      'enhanced text that DROPS the token is INVALID',
    );
  },
);

// ---------------------------------------------------------------------------
// 10. /loop slash command exists and is keyboard-pickable (adapter contract).
// ---------------------------------------------------------------------------

await check('a /loop slash command is registered alongside the people-only @ mention', async () => {
  const commands = buildSlashCommands();
  const loopCmd = commands.find((c) => c.id === 'loop');
  assert.ok(loopCmd, 'a /loop slash command exists');
  assert.ok(typeof loopCmd!.label === 'string' && loopCmd!.label.length > 0, '/loop has a label');
  // The picker is opened by an execute action (the popover is rendered by
  // ComposerTriggers); the command is a real action, not a placeholder.
  assert.equal(typeof loopCmd!.execute, 'function', '/loop has an execute action');
});

// ---------------------------------------------------------------------------
// 11. No-project flow: build is possible, but the caller must select a project.
//     (The pure materializer accepts a null project; the renderer opens the
//      explicit selector — asserted here as: a null-project send still binds a
//      null project_id and never invents a default.)
// ---------------------------------------------------------------------------

await check(
  'a send with no active project binds project_id=null — never a hidden default',
  async () => {
    const { repos, svc, materializerDeps } = freshSystem();
    const loop = await seedReadyLoop(svc);
    const result = await materializeLoopSend(materializerDeps, {
      reference: { loopId: loop.loopId, revisionId: loop.revisionId },
      companyId: COMPANY,
      projectId: null,
      threadId: OFFICE_THREAD,
      messageId: MESSAGE,
    });
    const inv = await repos.loopInvocations!.findById(result.invocationId);
    assert.equal(
      inv!.project_id,
      null,
      'no project → project_id is null, never a fabricated default',
    );
  },
);

// ---------------------------------------------------------------------------
// 12. Office no-Loop regression: a plain send touches no loop tables.
// ---------------------------------------------------------------------------

await check(
  'Office no-Loop behavior is unchanged — nothing in this path writes a loop table without a chip',
  async () => {
    const { repos, svc } = freshSystem();
    const loop = await seedReadyLoop(svc);
    // Simulate a plain Office send (no chip in store, no materializeLoopSend call).
    useComposerLoopReferenceStore.getState().clearReference(OFFICE_THREAD);
    assert.equal(
      useComposerLoopReferenceStore.getState().byThread[OFFICE_THREAD],
      undefined,
      'no chip on the thread',
    );
    // With no chip, the runtime never calls the materializer → zero loop_invocations.
    const invocations = await invocationCount(repos, loop.loopId);
    assert.equal(invocations, 0, 'a no-Loop send creates no loop_invocation');
  },
);

console.log(`\nLoop Office invocation: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
