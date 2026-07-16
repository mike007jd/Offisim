// PR-02 — Collaboration repository/service contract harness.
//
// Runs the CollaborationService against the REAL collaboration SQL schema on
// both repo backends:
//   - better-sqlite3 (packages/core/.../repos/collaboration/drizzle.ts, sync)
//   - sqlite-proxy   (apps/desktop/renderer/.../tauri-repos/collaboration.ts, async)
//
// Both backends are exercised through an in-memory better-sqlite3 seeded with the
// actual DDL (companies / employees / chat_threads + the four collaboration
// tables and their indexes, including the partial-unique active-direct index and
// FK ON DELETE CASCADE). This means the oracle hits the ACTUAL constraints — the
// active-direct uniqueness, company-delete cascade, and chat_threads isolation
// are enforced by SQLite, not by the in-memory Map.
//
// Covers the spec's 9 verification cases (see the labelled checks below).
// Deterministic newId()/now() so every run is byte-stable. Style mirrors
// scripts/harness-workspace-repo-contract.mts + harness-mission-service.mts.

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleBetter } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy';
import type { TauriDrizzleDb } from '../apps/desktop/renderer/src/lib/tauri-drizzle.js';
import { createCollaborationTauriRepos } from '../apps/desktop/renderer/src/lib/tauri-repos/collaboration.js';
import {
  CollaborationError,
  type CollaborationServiceDeps,
  type CollaborationServiceRepos,
  createCollaborationService,
  readSenderLabel,
} from '../packages/core/src/runtime/collaboration/collaboration-service.js';
import { createCollaborationDrizzleRepos } from '../packages/core/src/runtime/repos/collaboration/drizzle.js';
import type {
  CollaborationTurnRepository,
  NewCollaborationThread,
} from '../packages/core/src/runtime/repositories.js';

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

// --- Schema (subset of schema.sql needed to enforce the collaboration constraints) ---
const SCHEMA_SQL = `
CREATE TABLE companies (
  company_id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE employees (
  employee_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
-- project-scoped chat (the domain collaboration MUST NOT touch). project_id NOT NULL.
CREATE TABLE chat_threads (
  thread_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE collaboration_threads (
  thread_id          TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
  title              TEXT NOT NULL,
  direct_employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  reply_policy       TEXT NOT NULL DEFAULT 'mentions_only'
                       CHECK (reply_policy IN ('mentions_only', 'roundtable', 'silent')),
  capability_profile TEXT NOT NULL DEFAULT 'strict'
                       CHECK (capability_profile IN ('strict', 'collaboration_read')),
  round_speaker_limit INTEGER NOT NULL DEFAULT 3,
  created_by         TEXT NOT NULL DEFAULT 'boss',
  archived_at        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  CHECK (kind = 'direct' OR direct_employee_id IS NULL)
);
CREATE TABLE collaboration_thread_members (
  member_id    TEXT PRIMARY KEY,
  thread_id    TEXT NOT NULL REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('boss', 'employee')),
  employee_id  TEXT REFERENCES employees(employee_id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at    TEXT NOT NULL,
  left_at      TEXT
);
CREATE TABLE collaboration_messages (
  message_id          TEXT PRIMARY KEY,
  thread_id           TEXT NOT NULL REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
  sender_type         TEXT NOT NULL CHECK (sender_type IN ('boss', 'employee', 'system')),
  sender_employee_id  TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  body                TEXT NOT NULL,
  reply_to_message_id TEXT,
  status              TEXT NOT NULL DEFAULT 'complete'
                        CHECK (status IN ('pending', 'streaming', 'complete', 'interrupted', 'failed')),
  idempotency_key     TEXT,
  metadata_json       TEXT,
  created_at          TEXT NOT NULL,
  edited_at           TEXT
);
CREATE TABLE collaboration_read_state (
  thread_id            TEXT PRIMARY KEY REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
  last_read_message_id TEXT,
  updated_at           TEXT NOT NULL
);
CREATE TABLE collaboration_execution_lanes (
  thread_id    TEXT PRIMARY KEY REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
  engine_id    TEXT NOT NULL CHECK (length(trim(engine_id)) > 0),
  account_id   TEXT NOT NULL CHECK (length(trim(account_id)) > 0),
  billing_mode TEXT NOT NULL CHECK (billing_mode IN ('api', 'subscription'))
);
CREATE TABLE collaboration_turns (
  turn_id            TEXT PRIMARY KEY NOT NULL,
  thread_id          TEXT NOT NULL REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
  trigger_message_id TEXT,
  employee_id        TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  sequence_index     INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'streaming', 'complete', 'interrupted', 'failed')),
  runtime_request_id TEXT NOT NULL,
  execution_target_json TEXT NOT NULL
    CHECK (
      json_valid(execution_target_json)
      AND length(trim(json_extract(execution_target_json, '$.engineId'))) > 0
      AND length(trim(json_extract(execution_target_json, '$.accountId'))) > 0
      AND json_extract(execution_target_json, '$.billingMode') IN ('api', 'subscription')
      AND length(trim(json_extract(execution_target_json, '$.modelId'))) > 0
      AND (
        (
          json_extract(execution_target_json, '$.billingMode') = 'api'
          AND json_extract(execution_target_json, '$.engineId') = 'api'
          AND json_type(execution_target_json, '$.modelSource') IS NULL
        )
        OR (
          json_extract(execution_target_json, '$.billingMode') = 'api'
          AND json_extract(execution_target_json, '$.engineId') = 'api'
          AND json_type(execution_target_json, '$.modelSource') = 'object'
          AND json_extract(execution_target_json, '$.modelSource.kind') = 'official-api'
          AND json_type(execution_target_json, '$.modelSource.sourceUrl') = 'text'
          AND lower(trim(json_extract(execution_target_json, '$.modelSource.sourceUrl'))) GLOB 'https://*'
          AND json_type(execution_target_json, '$.modelSource.checkedAt') = 'text'
          AND datetime(json_extract(execution_target_json, '$.modelSource.checkedAt')) IS NOT NULL
        )
        OR (
          json_extract(execution_target_json, '$.billingMode') = 'subscription'
          AND json_type(execution_target_json, '$.modelSource') = 'object'
          AND json_extract(execution_target_json, '$.modelSource.kind') = 'native'
          AND json_extract(execution_target_json, '$.modelSource.sourceUrl') IS NULL
          AND json_extract(execution_target_json, '$.modelSource.checkedAt') IS NULL
        )
      )
    ),
  result_provenance_json TEXT
    CHECK (
      result_provenance_json IS NULL
      OR (
        json_valid(result_provenance_json)
        AND json_extract(result_provenance_json, '$.runId') = runtime_request_id
        AND json_extract(result_provenance_json, '$.engineId') = json_extract(execution_target_json, '$.engineId')
        AND json_extract(result_provenance_json, '$.accountId') = json_extract(execution_target_json, '$.accountId')
        AND json_extract(result_provenance_json, '$.billingMode') = json_extract(execution_target_json, '$.billingMode')
        AND json_extract(result_provenance_json, '$.modelId') = json_extract(execution_target_json, '$.modelId')
        AND json_extract(result_provenance_json, '$.modelSource.kind') IS json_extract(execution_target_json, '$.modelSource.kind')
        AND json_extract(result_provenance_json, '$.modelSource.sourceUrl') IS json_extract(execution_target_json, '$.modelSource.sourceUrl')
        AND json_extract(result_provenance_json, '$.modelSource.checkedAt') IS json_extract(execution_target_json, '$.modelSource.checkedAt')
        AND length(trim(json_extract(result_provenance_json, '$.adapter.id'))) > 0
        AND length(trim(json_extract(result_provenance_json, '$.adapter.version'))) > 0
      )
    ),
  usage_json         TEXT,
  error_summary      TEXT,
  started_at         TEXT,
  finished_at        TEXT,
  CHECK (status <> 'complete' OR result_provenance_json IS NOT NULL)
);
CREATE INDEX idx_collaboration_threads_company_updated
  ON collaboration_threads(company_id, updated_at DESC);
CREATE UNIQUE INDEX idx_collaboration_threads_active_direct
  ON collaboration_threads(company_id, direct_employee_id)
  WHERE kind = 'direct' AND archived_at IS NULL;
CREATE INDEX idx_collaboration_messages_thread_time
  ON collaboration_messages(thread_id, created_at, message_id);
CREATE UNIQUE INDEX idx_collaboration_messages_idempotency
  ON collaboration_messages(thread_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_collaboration_members_thread ON collaboration_thread_members(thread_id);
CREATE INDEX idx_collaboration_members_employee ON collaboration_thread_members(employee_id);
CREATE INDEX idx_collaboration_turns_thread_sequence
  ON collaboration_turns(thread_id, sequence_index);
CREATE TRIGGER trg_collaboration_turns_execution_lane
BEFORE INSERT ON collaboration_turns
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
    FROM collaboration_execution_lanes lane
   WHERE lane.thread_id = NEW.thread_id
     AND lane.engine_id = json_extract(NEW.execution_target_json, '$.engineId')
     AND lane.account_id = json_extract(NEW.execution_target_json, '$.accountId')
     AND lane.billing_mode = json_extract(NEW.execution_target_json, '$.billingMode')
)
BEGIN
  SELECT RAISE(ABORT, 'collaboration execution lane mismatch');
END;
`;

function seed(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  db.prepare('INSERT INTO companies (company_id, name) VALUES (?, ?)').run('co-1', 'Acme');
  db.prepare('INSERT INTO companies (company_id, name) VALUES (?, ?)').run('co-2', 'Other');
  const emp = db.prepare('INSERT INTO employees (employee_id, company_id, name) VALUES (?, ?, ?)');
  emp.run('emp-1', 'co-1', 'Alex');
  emp.run('emp-2', 'co-1', 'Kai');
  emp.run('emp-3', 'co-1', 'Sophie');
  // One pre-existing project chat row — its count must never change.
  db.prepare(
    'INSERT INTO chat_threads (thread_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('chat-1', 'proj-1', 'Existing project chat', 't0', 't0');
}

function chatThreadCount(db: Database.Database): number {
  return (db.prepare('SELECT count(*) AS n FROM chat_threads').get() as { n: number }).n;
}

function collabThreadRows(db: Database.Database): number {
  return (db.prepare('SELECT count(*) AS n FROM collaboration_threads').get() as { n: number }).n;
}

// Deterministic id/clock factories so every run is byte-stable.
function makeDeps(): CollaborationServiceDeps {
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

// sqlite-proxy db structurally == Tauri db minus IPC hop. better-sqlite3 uses `?`
// placeholders natively (no `$N` rewrite needed for this standalone path).
function makeProxyDb(sqlite: Database.Database): TauriDrizzleDb {
  const proxy = drizzleProxy(async (sql, params, method) => {
    const bind = params as ReadonlyArray<string | number | null>;
    if (method === 'run') {
      sqlite.prepare(sql).run(...bind);
      return { rows: [] };
    }
    const rows = sqlite
      .prepare(sql)
      .raw()
      .all(...bind) as unknown[][];
    if (method === 'get') return { rows: rows[0] ?? [] };
    return { rows };
  });
  return proxy as unknown as TauriDrizzleDb;
}

interface Backend {
  label: string;
  db: Database.Database;
  repos: CollaborationServiceRepos & { collaborationTurns: CollaborationTurnRepository };
}

function withAtomicBoundary(
  repos: Omit<CollaborationServiceRepos, 'asyncTransact'> & {
    collaborationTurns: CollaborationTurnRepository;
  },
): CollaborationServiceRepos & { collaborationTurns: CollaborationTurnRepository } {
  return { ...repos, asyncTransact: async (fn) => fn() };
}

function betterBackend(): Backend {
  const db = new Database(':memory:');
  seed(db);
  const repos = withAtomicBoundary(
    createCollaborationDrizzleRepos(
      drizzleBetter(db) as BetterSQLite3Database<Record<string, never>>,
    ),
  );
  return { label: 'better-sqlite3', db, repos };
}

function proxyBackend(): Backend {
  const db = new Database(':memory:');
  seed(db);
  const repos = withAtomicBoundary(createCollaborationTauriRepos(makeProxyDb(db)));
  return { label: 'sqlite-proxy', db, repos };
}

async function runContract(make: () => Backend): Promise<void> {
  const { label } = make();
  console.log(`-- backend: ${label}`);

  // Case 1: create direct/group with NO project.
  await check(`[${label}] case 1: create direct + group with no project`, async () => {
    const { db, repos } = make();
    const svc = createCollaborationService(repos, makeDeps());
    const direct = await svc.getOrCreateDirect('co-1', 'emp-1');
    assert.equal(direct.kind, 'direct');
    assert.equal(direct.directEmployeeId, 'emp-1');
    assert.ok(!('projectId' in (direct as Record<string, unknown>)), 'no projectId on thread');
    const group = await svc.createGroup({
      companyId: 'co-1',
      title: 'Team',
      employeeIds: ['emp-1', 'emp-2'],
    });
    assert.equal(group.kind, 'group');
    assert.equal(group.directEmployeeId, null);
    const members = await svc.listMembers(group.threadId);
    assert.equal(members.length, 3, 'boss + 2 employees');
    assert.equal(members.filter((m) => m.actorType === 'boss').length, 1, 'one boss owner');
    assert.equal(collabThreadRows(db), 2, 'two collaboration threads exist');
  });

  // Case 2: two concurrent getOrCreateDirect → one active thread.
  await check(
    `[${label}] case 2: concurrent getOrCreateDirect yields one active thread`,
    async () => {
      const { db, repos } = make();
      const svc = createCollaborationService(repos, makeDeps());
      const [a, b] = await Promise.all([
        svc.getOrCreateDirect('co-1', 'emp-1'),
        svc.getOrCreateDirect('co-1', 'emp-1'),
      ]);
      assert.equal(a.threadId, b.threadId, 'both calls converge on the same thread id');
      const activeDirects = db
        .prepare(
          "SELECT count(*) AS n FROM collaboration_threads WHERE kind='direct' AND direct_employee_id='emp-1' AND archived_at IS NULL",
        )
        .get() as { n: number };
      assert.equal(activeDirects.n, 1, 'exactly one ACTIVE direct thread');
      // Idempotent on a settled state too.
      const again = await svc.getOrCreateDirect('co-1', 'emp-1');
      assert.equal(again.threadId, a.threadId, 'repeat returns the same thread');
    },
  );

  // Case 2b: archived direct is restored, not duplicated.
  await check(`[${label}] case 2b: getOrCreateDirect restores an archived thread`, async () => {
    const { db, repos } = make();
    const svc = createCollaborationService(repos, makeDeps());
    const first = await svc.getOrCreateDirect('co-1', 'emp-1');
    await svc.archive(first.threadId);
    const restored = await svc.getOrCreateDirect('co-1', 'emp-1');
    assert.equal(restored.threadId, first.threadId, 'archived thread is restored, not duplicated');
    assert.equal(restored.archivedAt, null, 'restored thread is active again');
    assert.equal(collabThreadRows(db), 1, 'no duplicate row created');
  });

  // Case 2c: the TRUE race guard the service's catch+reread relies on — the
  // partial-unique index physically rejects a second ACTIVE direct for the same
  // (company, employee). Promise.all in case 2 cannot interleave a synchronous
  // SQLite driver, so we exercise the DB-level guard directly: a racing insert
  // of a duplicate active direct must THROW (the service catches this and rereads
  // the winner), and archiving the first must free the slot for a new one.
  await check(
    `[${label}] case 2c: partial-unique index prevents a second active direct`,
    async () => {
      const { db, repos } = make();
      const svc = createCollaborationService(repos, makeDeps());
      const first = await svc.getOrCreateDirect('co-1', 'emp-1');
      const dup: NewCollaborationThread = {
        thread_id: 'racing-dup',
        company_id: 'co-1',
        kind: 'direct',
        title: 'Alex',
        direct_employee_id: 'emp-1',
        reply_policy: 'mentions_only',
        capability_profile: 'strict',
        round_speaker_limit: 3,
        created_by: 'boss',
        archived_at: null,
        created_at: 't9',
        updated_at: 't9',
      };
      const activeDirectCount = () =>
        (
          db
            .prepare(
              "SELECT count(*) AS n FROM collaboration_threads WHERE kind='direct' AND direct_employee_id='emp-1' AND archived_at IS NULL",
            )
            .get() as { n: number }
        ).n;
      // A racing duplicate active-direct insert must NOT yield a second active row.
      // Backends differ in HOW the partial-unique index stops it (better-sqlite3
      // throws; the proxy/Tauri path no-ops via ON CONFLICT) — the service's
      // getOrCreateDirect handles both (catch+reread, and post-insert resolve) — so
      // the harness asserts the invariant that holds for both: still exactly one.
      await repos.collaborationThreads.insert(dup).catch(() => undefined);
      assert.equal(activeDirectCount(), 1, 'no second active direct row exists');
      const converged = await svc.getOrCreateDirect('co-1', 'emp-1');
      assert.equal(converged.threadId, first.threadId, 'service converges to the original winner');
      // Archiving the winner frees the partial index (WHERE archived_at IS NULL),
      // so a brand-new active direct can then be created.
      await svc.archive(first.threadId);
      await repos.collaborationThreads.insert(dup);
      assert.equal(
        activeDirectCount(),
        1,
        'after archive the slot is reusable for one new active direct',
      );
      const active = await repos.collaborationThreads.findActiveDirect('co-1', 'emp-1');
      assert.equal(
        active?.thread_id,
        'racing-dup',
        'the new active direct is the freshly inserted row',
      );
    },
  );

  // Case 2d: a GROUP thread must not carry a direct_employee_id (data hygiene
  // CHECK). A direct thread with a NULL employee is legal (deleted employee), so
  // that case is intentionally NOT rejected — see case 6.
  await check(
    `[${label}] case 2d: CHECK rejects a group thread carrying a direct_employee_id`,
    () => {
      const { db } = make();
      assert.throws(
        () =>
          db
            .prepare(
              "INSERT INTO collaboration_threads (thread_id, company_id, kind, title, direct_employee_id, created_at, updated_at) VALUES ('g-bad','co-1','group','G','emp-1','t','t')",
            )
            .run(),
        /CHECK/i,
        'group with a direct_employee_id must be rejected',
      );
    },
  );

  // Case 3: list order uses real last message/update.
  await check(`[${label}] case 3: listThreads orders by real last activity`, async () => {
    const { repos } = make();
    const svc = createCollaborationService(repos, makeDeps());
    const t1 = await svc.getOrCreateDirect('co-1', 'emp-1');
    const t2 = await svc.getOrCreateDirect('co-1', 'emp-2');
    // t1 gets a newer message than t2 → t1 must sort first.
    await svc.appendMessage({ threadId: t2.threadId, senderType: 'boss', body: 'older' });
    await svc.appendMessage({ threadId: t1.threadId, senderType: 'boss', body: 'newer' });
    const list = await svc.listThreads('co-1');
    assert.equal(list[0]?.threadId, t1.threadId, 'most-recent-activity thread first');
    assert.equal(list[0]?.lastMessage?.body, 'newer');
    assert.equal(list[1]?.threadId, t2.threadId);
  });

  // Case 4: group membership add/remove transaction + constraints.
  await check(
    `[${label}] case 4: group membership update is transactional + constrained`,
    async () => {
      const { repos } = make();
      const svc = createCollaborationService(repos, makeDeps());
      const group = await svc.createGroup({
        companyId: 'co-1',
        title: 'Team',
        employeeIds: ['emp-1'],
      });
      const members = await svc.listMembers(group.threadId);
      const emp1Member = members.find((m) => m.employeeId === 'emp-1');
      assert.ok(emp1Member, 'emp-1 is a member');
      // Add emp-2, remove emp-1 in one transaction.
      const after = await svc.updateMembers({
        threadId: group.threadId,
        addEmployeeIds: ['emp-2'],
        removeMemberIds: [emp1Member!.memberId],
      });
      const employeeIds = after.filter((m) => m.actorType === 'employee').map((m) => m.employeeId);
      assert.deepEqual(employeeIds, ['emp-2'], 'emp-1 removed, emp-2 added');
      // Constraint: cannot remove the last employee member.
      const emp2Member = after.find((m) => m.employeeId === 'emp-2');
      await assert.rejects(
        () =>
          svc.updateMembers({ threadId: group.threadId, removeMemberIds: [emp2Member!.memberId] }),
        (e: unknown) => e instanceof CollaborationError && e.code === 'members.min_employee',
        'removing the last employee is rejected',
      );
      // Direct threads have fixed membership.
      const direct = await svc.getOrCreateDirect('co-1', 'emp-3');
      await assert.rejects(
        () => svc.updateMembers({ threadId: direct.threadId, addEmployeeIds: ['emp-1'] }),
        (e: unknown) => e instanceof CollaborationError && e.code === 'members.direct_fixed',
      );
    },
  );

  // Case 5: company delete cascade.
  await check(`[${label}] case 5: company delete cascades collaboration rows`, async () => {
    const { db, repos } = make();
    const svc = createCollaborationService(repos, makeDeps());
    const t = await svc.getOrCreateDirect('co-1', 'emp-1');
    await svc.appendMessage({ threadId: t.threadId, senderType: 'boss', body: 'hi' });
    await svc.markRead(t.threadId);
    await repos.collaborationTurns.bindThreadExecutionLane(t.threadId, {
      engineId: 'api',
      accountId: 'api:fixture:0123456789abcdef',
      billingMode: 'api',
    });
    assert.ok(collabThreadRows(db) > 0, 'rows exist before delete');
    db.prepare('DELETE FROM companies WHERE company_id = ?').run('co-1');
    assert.equal(collabThreadRows(db), 0, 'threads cascaded');
    assert.equal(
      (db.prepare('SELECT count(*) AS n FROM collaboration_messages').get() as { n: number }).n,
      0,
      'messages cascaded',
    );
    assert.equal(
      (db.prepare('SELECT count(*) AS n FROM collaboration_thread_members').get() as { n: number })
        .n,
      0,
      'members cascaded',
    );
    assert.equal(
      (db.prepare('SELECT count(*) AS n FROM collaboration_read_state').get() as { n: number }).n,
      0,
      'read_state cascaded',
    );
    assert.equal(
      (db.prepare('SELECT count(*) AS n FROM collaboration_execution_lanes').get() as { n: number })
        .n,
      0,
      'execution lane cascaded',
    );
  });

  // Case 6: employee delete → message history still readable.
  await check(`[${label}] case 6: employee delete keeps message history readable`, async () => {
    const { db, repos } = make();
    const svc = createCollaborationService(repos, makeDeps());
    const t = await svc.getOrCreateDirect('co-1', 'emp-1');
    await svc.appendMessage({
      threadId: t.threadId,
      senderType: 'employee',
      senderEmployeeId: 'emp-1',
      body: 'from alex',
      senderLabel: 'Alex',
    });
    db.prepare('DELETE FROM employees WHERE employee_id = ?').run('emp-1');
    const page = await svc.listMessages(t.threadId);
    assert.equal(page.messages.length, 1, 'message survives employee delete');
    const msg = page.messages[0]!;
    assert.equal(msg.body, 'from alex', 'body readable');
    assert.equal(msg.senderEmployeeId, null, 'FK set null on delete');
    assert.equal(readSenderLabel(msg.metadataJson), 'Alex', 'sender snapshot kept in metadata');
  });

  // Case 7: collaboration ops do not change chat_threads count.
  await check(`[${label}] case 7: collaboration ops never touch chat_threads`, async () => {
    const { db, repos } = make();
    const svc = createCollaborationService(repos, makeDeps());
    const before = chatThreadCount(db);
    const t = await svc.getOrCreateDirect('co-1', 'emp-1');
    await svc.createGroup({ companyId: 'co-1', title: 'G', employeeIds: ['emp-2'] });
    await svc.appendMessage({ threadId: t.threadId, senderType: 'boss', body: 'hi' });
    await svc.archive(t.threadId);
    await svc.unarchive(t.threadId);
    await svc.markRead(t.threadId);
    assert.equal(
      chatThreadCount(db),
      before,
      'chat_threads count unchanged by any collaboration op',
    );
    assert.equal(before, 1, 'the pre-existing project chat row is intact');
  });

  // Case 8: pagination cursor — no dup, no gap.
  await check(`[${label}] case 8: pagination cursor has no dup and no gap`, async () => {
    const { repos } = make();
    const svc = createCollaborationService(repos, makeDeps());
    const t = await svc.getOrCreateDirect('co-1', 'emp-1');
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const m = await svc.appendMessage({
        threadId: t.threadId,
        senderType: 'boss',
        body: `m${i}`,
      });
      ids.push(m.messageId);
    }
    // Page size 2, walk to the end. Newest-first → reverse of insertion order.
    const seen: string[] = [];
    let cursor = null as Awaited<ReturnType<typeof svc.listMessages>>['nextCursor'];
    let pages = 0;
    do {
      const page = await svc.listMessages(t.threadId, cursor, 2);
      seen.push(...page.messages.map((m) => m.messageId));
      cursor = page.nextCursor;
      pages += 1;
      assert.ok(pages <= 10, 'pagination terminates');
    } while (cursor);
    assert.equal(seen.length, 5, 'all 5 messages returned exactly once');
    assert.equal(new Set(seen).size, 5, 'no duplicates across pages');
    assert.deepEqual(seen, [...ids].reverse(), 'newest-first order, no gap');
  });

  // Case 8b: idempotent append survives a double-send.
  await check(`[${label}] case 8b: appendMessage idempotency key dedups double-send`, async () => {
    const { repos } = make();
    const svc = createCollaborationService(repos, makeDeps());
    const t = await svc.getOrCreateDirect('co-1', 'emp-1');
    const [m1, m2] = await Promise.all([
      svc.appendMessage({
        threadId: t.threadId,
        senderType: 'boss',
        body: 'once',
        idempotencyKey: 'k1',
      }),
      svc.appendMessage({
        threadId: t.threadId,
        senderType: 'boss',
        body: 'once',
        idempotencyKey: 'k1',
      }),
    ]);
    assert.equal(m1.messageId, m2.messageId, 'double send returns the single stored message');
    const page = await svc.listMessages(t.threadId);
    assert.equal(page.messages.length, 1, 'only one message stored');
  });

  // Case 9: malformed metadata_json doesn't break core reads.
  await check(`[${label}] case 9: malformed metadata_json does not break reads`, async () => {
    const { db, repos } = make();
    const svc = createCollaborationService(repos, makeDeps());
    const t = await svc.getOrCreateDirect('co-1', 'emp-1');
    // Inject a row with deliberately broken JSON in metadata_json.
    db.prepare(
      `INSERT INTO collaboration_messages
        (message_id, thread_id, sender_type, sender_employee_id, body, reply_to_message_id, status, idempotency_key, metadata_json, created_at, edited_at)
       VALUES (?, ?, 'boss', NULL, ?, NULL, 'complete', NULL, ?, ?, NULL)`,
    ).run('bad-msg', t.threadId, 'broken meta', '{not valid json', '2099-01-01T00:00:00.000Z');
    const page = await svc.listMessages(t.threadId);
    assert.ok(
      page.messages.some((m) => m.messageId === 'bad-msg'),
      'malformed-metadata row is still read',
    );
    // Idempotency lookup must not throw and finds nothing for an unused key.
    const byKey = await repos.collaborationMessages.findByIdempotencyKey(t.threadId, 'whatever');
    assert.equal(byKey, null, 'idempotency lookup tolerates malformed metadata');
    assert.equal(readSenderLabel('{not valid json'), null, 'reader tolerates malformed json');
  });

  await check(`[${label}] execution lane: target + request read back exactly`, async () => {
    const { repos } = make();
    const svc = createCollaborationService(repos, makeDeps());
    const thread = await svc.getOrCreateDirect('co-1', 'emp-1');
    const target = {
      engineId: 'api',
      accountId: 'api:fixture:0123456789abcdef',
      billingMode: 'api' as const,
      modelId: 'maker/model',
      modelSource: {
        kind: 'official-api',
        sourceUrl: 'https://provider.example/models/maker/model',
        checkedAt: '2026-07-14T00:00:00.000Z',
      },
    };
    const targetJson = JSON.stringify(target);
    assert.equal(
      await repos.collaborationTurns.bindThreadExecutionLane(thread.threadId, target),
      true,
      'the first target claims the thread lane',
    );
    await repos.collaborationTurns.insert({
      turn_id: 'turn-exact',
      thread_id: thread.threadId,
      trigger_message_id: null,
      employee_id: 'emp-1',
      sequence_index: 1,
      status: 'pending',
      runtime_request_id: 'collab-turn-exact',
      execution_target_json: targetJson,
      result_provenance_json: null,
      usage_json: null,
      error_summary: null,
      started_at: null,
      finished_at: null,
    });
    const pending = await repos.collaborationTurns.findById('turn-exact');
    assert.equal(pending?.runtime_request_id, 'collab-turn-exact');
    assert.deepEqual(JSON.parse(pending?.execution_target_json ?? '{}'), target);

    const provenanceJson = JSON.stringify({
      ...target,
      runId: 'collab-turn-exact',
      adapter: { id: 'fixture-adapter', version: '1.0.0' },
    });
    await repos.collaborationTurns.update('turn-exact', {
      status: 'complete',
      result_provenance_json: provenanceJson,
      usage_json: JSON.stringify({ input: 3, output: 5 }),
      finished_at: '2026-07-14T00:01:00.000Z',
    });
    const complete = await repos.collaborationTurns.findById('turn-exact');
    assert.equal(complete?.status, 'complete');
    assert.deepEqual(JSON.parse(complete?.result_provenance_json ?? '{}'), {
      ...target,
      runId: 'collab-turn-exact',
      adapter: { id: 'fixture-adapter', version: '1.0.0' },
    });
  });

  await check(`[${label}] execution lane: SQL rejects missing/mismatched facts`, async () => {
    const { db, repos } = make();
    const svc = createCollaborationService(repos, makeDeps());
    const thread = await svc.getOrCreateDirect('co-1', 'emp-1');
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO collaboration_turns
              (turn_id, thread_id, employee_id, sequence_index, status, runtime_request_id)
             VALUES (?, ?, ?, 1, 'pending', ?)`,
          )
          .run('turn-no-target', thread.threadId, 'emp-1', 'collab-turn-no-target'),
      /NOT NULL|constraint|lane mismatch/iu,
    );

    const target = {
      engineId: 'api',
      accountId: 'api:fixture:0123456789abcdef',
      billingMode: 'api' as const,
      modelId: 'maker/model',
      modelSource: {
        kind: 'official-api',
        sourceUrl: 'https://provider.example/models/maker/model',
        checkedAt: '2026-07-14T00:00:00.000Z',
      },
    };
    assert.equal(
      await repos.collaborationTurns.bindThreadExecutionLane(thread.threadId, target),
      true,
      'the valid target claims the thread lane before turn insert',
    );
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO collaboration_turns
              (turn_id, thread_id, employee_id, sequence_index, status, runtime_request_id, execution_target_json)
             VALUES (?, ?, ?, 2, 'pending', ?, ?)`,
          )
          .run(
            'turn-wrong-lane',
            thread.threadId,
            'emp-1',
            'collab-turn-wrong-lane',
            JSON.stringify({ ...target, accountId: 'api:other:0123456789abcdef' }),
          ),
      /collaboration execution lane mismatch/iu,
      'the SQL trigger rejects a valid target from a different account lane',
    );
    await repos.collaborationTurns.insert({
      turn_id: 'turn-mismatch',
      thread_id: thread.threadId,
      trigger_message_id: null,
      employee_id: 'emp-1',
      sequence_index: 2,
      status: 'pending',
      runtime_request_id: 'collab-turn-mismatch',
      execution_target_json: JSON.stringify(target),
      result_provenance_json: null,
      usage_json: null,
      error_summary: null,
      started_at: null,
      finished_at: null,
    });
    await assert.rejects(
      repos.collaborationTurns.update('turn-mismatch', {
        status: 'complete',
        result_provenance_json: JSON.stringify({
          ...target,
          accountId: 'api:other:0123456789abcdef',
          runId: 'collab-turn-mismatch',
          adapter: { id: 'fixture-adapter', version: '1.0.0' },
        }),
      }),
      /CHECK|constraint/iu,
    );
    assert.equal(
      (await repos.collaborationTurns.findById('turn-mismatch'))?.status,
      'pending',
      'failed terminal update leaves the prior durable state intact',
    );
  });

  await check(`[${label}] execution lane: concurrent first writer is immutable`, async () => {
    const { db, repos } = make();
    const svc = createCollaborationService(repos, makeDeps());
    const thread = await svc.getOrCreateDirect('co-1', 'emp-1');
    const fixtureLane = {
      engineId: 'api',
      accountId: 'api:fixture:0123456789abcdef',
      billingMode: 'api' as const,
    };
    const otherLane = {
      engineId: 'api',
      accountId: 'api:other:0123456789abcdef',
      billingMode: 'api' as const,
    };
    const claims = await Promise.all([
      repos.collaborationTurns.bindThreadExecutionLane(thread.threadId, fixtureLane),
      repos.collaborationTurns.bindThreadExecutionLane(thread.threadId, otherLane),
    ]);
    assert.equal(
      claims.filter(Boolean).length,
      1,
      'exactly one concurrent account lane wins the first-write claim',
    );
    const stored = db
      .prepare(
        'SELECT engine_id, account_id, billing_mode FROM collaboration_execution_lanes WHERE thread_id = ?',
      )
      .get(thread.threadId) as {
      engine_id: string;
      account_id: string;
      billing_mode: string;
    };
    const winner = claims[0] ? fixtureLane : otherLane;
    assert.deepEqual(stored, {
      engine_id: winner.engineId,
      account_id: winner.accountId,
      billing_mode: winner.billingMode,
    });
    assert.equal(
      await repos.collaborationTurns.bindThreadExecutionLane(thread.threadId, winner),
      true,
      'the winning lane remains idempotently accepted',
    );
    assert.equal(
      await repos.collaborationTurns.bindThreadExecutionLane(
        thread.threadId,
        claims[0] ? otherLane : fixtureLane,
      ),
      false,
      'the losing lane stays rejected after the race',
    );
  });

  // Invariant: speaker limit is clamped to 1–8.
  await check(`[${label}] invariant: round_speaker_limit clamps to 1-8`, async () => {
    const { repos } = make();
    const svc = createCollaborationService(repos, makeDeps());
    const hi = await svc.getOrCreateDirect('co-1', 'emp-1', { roundSpeakerLimit: 99 });
    assert.equal(hi.roundSpeakerLimit, 8, 'clamped to max 8');
    const lo = await svc.createGroup({
      companyId: 'co-1',
      title: 'G',
      employeeIds: ['emp-2'],
      roundSpeakerLimit: 0,
    });
    assert.equal(lo.roundSpeakerLimit, 1, 'clamped to min 1');
  });

  // Invariant: markRead is a computed boundary, not a counter.
  await check(`[${label}] invariant: unread computed from last-read boundary`, async () => {
    const { repos } = make();
    const svc = createCollaborationService(repos, makeDeps());
    const t = await svc.getOrCreateDirect('co-1', 'emp-1');
    await svc.appendMessage({ threadId: t.threadId, senderType: 'boss', body: 'a' });
    const second = await svc.appendMessage({ threadId: t.threadId, senderType: 'boss', body: 'b' });
    await svc.appendMessage({ threadId: t.threadId, senderType: 'boss', body: 'c' });
    assert.equal(await svc.unreadCount(t.threadId), 3, 'no boundary → all unread');
    await svc.markRead(t.threadId, second.messageId);
    assert.equal(await svc.unreadCount(t.threadId), 1, 'one message after the boundary');
    await svc.markRead(t.threadId); // default = latest
    assert.equal(await svc.unreadCount(t.threadId), 0, 'caught up');
  });
}

async function main(): Promise<void> {
  console.log('collaboration-repo contract (PR-02): direct + group company chat');
  await runContract(betterBackend);
  await runContract(proxyBackend);

  console.log(`\ncollaboration-repo contract: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('collaboration-repo contract: FAIL');
    process.exit(1);
  }
  console.log('collaboration-repo contract: PASS');
}

main().catch((err) => {
  console.error('collaboration-repo contract: FAIL');
  console.error(err instanceof assert.AssertionError ? err.message : err);
  process.exit(1);
});
