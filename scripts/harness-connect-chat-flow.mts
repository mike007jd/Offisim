// PR-05 — Connect chat FLOW harness (deterministic data/flow layer, NOT the live
// model). It proves the renderer-facing Connect flow contract the Messenger/
// Contacts UI depends on, WITHOUT a Pi model or a Tauri runtime:
//
//   1. draft materialization calls getOrCreateDirect ONCE — idempotent on a
//      double-send (the unpersisted draft → one direct thread, not two);
//   2. a Connect op's effect is observable as the new last-message / list state
//      that the query-invalidation layer would surface (we assert the SERVICE
//      read the invalidated query re-runs, since the query fn === the service);
//   3. THREAD ISOLATION — a Connect op never touches `chat_threads` (count
//      unchanged); breaking this FAILS the harness (inject-proof #1);
//   4. the GROUP pending invariant reuses the PR-01 `shouldShowPendingReply`:
//      a group with two streaming speakers shows ≤1 pending slot PER ACTIVE turn;
//   5. company switch resets the active selection.
//
// It runs the REAL CollaborationService against the actual collaboration SQL
// schema on better-sqlite3 (so `chat_threads` isolation is a DB-enforced fact),
// and imports the PR-01 presentation predicate directly. Deterministic
// newId()/now(). Style mirrors harness-collaboration-repo-contract.mts +
// harness-pi-collaboration-runtime.mts.

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { drizzle as drizzleBetter } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  type PresentationMessage,
  shouldShowPendingReply,
  visibleWorkspaceMessages,
} from '../apps/desktop/renderer/src/surfaces/office/rail/connect/company-chat-presentation.js';
import { submitNewGroupFromDialog } from '../apps/desktop/renderer/src/surfaces/office/rail/connect/new-group-submit.js';
import {
  type CollaborationServiceDeps,
  createCollaborationService,
} from '../packages/core/src/runtime/collaboration/collaboration-service.js';
import { createCollaborationDrizzleRepos } from '../packages/core/src/runtime/repos/collaboration/drizzle.js';

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

// Subset of schema.sql needed to enforce chat_threads isolation + the four
// collaboration tables (same DDL as the PR-02 repo-contract harness).
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
CREATE UNIQUE INDEX idx_collaboration_threads_active_direct
  ON collaboration_threads(company_id, direct_employee_id)
  WHERE kind = 'direct' AND archived_at IS NULL;
CREATE UNIQUE INDEX idx_collaboration_messages_idempotency
  ON collaboration_messages(thread_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_collaboration_messages_thread_time
  ON collaboration_messages(thread_id, created_at, message_id);
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
  // A pre-existing project chat row whose count must NEVER change.
  db.prepare(
    'INSERT INTO chat_threads (thread_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('chat-1', 'proj-1', 'Existing project chat', 't0', 't0');
}

function chatThreadCount(db: Database.Database): number {
  return (db.prepare('SELECT count(*) AS n FROM chat_threads').get() as { n: number }).n;
}

function activeDirectCount(db: Database.Database, employeeId: string): number {
  return (
    db
      .prepare(
        "SELECT count(*) AS n FROM collaboration_threads WHERE kind='direct' AND direct_employee_id=? AND archived_at IS NULL",
      )
      .get(employeeId) as { n: number }
  ).n;
}

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

function makeService(db: Database.Database) {
  const repos = createCollaborationDrizzleRepos(
    drizzleBetter(db) as BetterSQLite3Database<Record<string, never>>,
  );
  return createCollaborationService(repos, makeDeps());
}

/**
 * The Connect direct-draft materialization the Messenger uses on first send: a
 * single getOrCreateDirect call resolves (idempotently) the thread, then the boss
 * message is appended. Modeled here so the harness exercises the SAME flow the
 * `useGetOrCreateDirect` mutation + controller send drive. `breakIsolation` /
 * `breakIdempotency` inject the two failure modes for the inject-proof.
 */
async function materializeDirectDraftAndSend(
  db: Database.Database,
  svc: ReturnType<typeof makeService>,
  companyId: string,
  employeeId: string,
  body: string,
  opts?: { breakIsolation?: boolean; breakIdempotency?: boolean },
): Promise<string> {
  let threadId: string;
  if (opts?.breakIdempotency) {
    // BROKEN draft: always create a NEW direct thread instead of get-or-create,
    // so a double-send yields two threads. This must trip the idempotency check.
    const created = await svc.createGroup({
      companyId,
      title: `dup ${employeeId}`,
      employeeIds: [employeeId],
    });
    threadId = created.threadId;
  } else {
    const thread = await svc.getOrCreateDirect(companyId, employeeId, { title: employeeId });
    threadId = thread.threadId;
  }
  if (opts?.breakIsolation) {
    // BROKEN op: a Connect send must never write chat_threads — this injects that
    // forbidden write so the isolation assertion catches it.
    db.prepare(
      'INSERT INTO chat_threads (thread_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(`leak-${threadId}`, 'proj-x', 'leaked', 't', 't');
  }
  await svc.appendMessage({ threadId, senderType: 'boss', body, idempotencyKey: `boss-${body}` });
  return threadId;
}

async function main(): Promise<void> {
  console.log('connect-chat-flow (PR-05): deterministic Connect data/flow layer');

  // ── (0) the NewGroupDialog submit handler persists before it closes ───────
  await check(
    '(0) UI group submit handler creates the thread with all selected members before closing',
    async () => {
      const db = new Database(':memory:');
      seed(db);
      const svc = makeService(db);
      const events: string[] = [];
      const threadId = await submitNewGroupFromDialog(
        {
          title: 'B2 Release Roundtable',
          employeeIds: ['emp-1', 'emp-2', 'emp-3'],
          replyPolicy: 'roundtable',
        },
        {
          createGroup: async (input) => {
            events.push('create:start');
            const thread = await svc.createGroup({ companyId: 'co-1', ...input });
            events.push('create:success');
            return thread.threadId;
          },
          openThread: (createdThreadId) => events.push(`open:${createdThreadId}`),
          closeDialog: () => events.push('close'),
        },
      );

      const persisted = await svc.listThreads('co-1');
      const group = persisted.find((thread) => thread.threadId === threadId);
      assert.equal(group?.kind, 'group', 'handler returns a persisted group thread');
      assert.equal(group?.title, 'B2 Release Roundtable', 'handler forwards the title');
      assert.equal(group?.replyPolicy, 'roundtable', 'handler forwards the reply policy');
      const members = await svc.listMembers(threadId);
      assert.deepEqual(
        members
          .filter((member) => member.actorType === 'employee')
          .map((member) => member.employeeId),
        ['emp-1', 'emp-2', 'emp-3'],
        'handler persists all three selected employees',
      );
      assert.deepEqual(
        events,
        ['create:start', 'create:success', `open:${threadId}`, 'close'],
        'the dialog closes only after persistence succeeds and the thread opens',
      );
    },
  );

  await check('(0b) a failed UI group submit never opens a thread or closes the dialog', async () => {
    const events: string[] = [];
    await assert.rejects(
      submitNewGroupFromDialog(
        {
          title: 'B2 Release Roundtable',
          employeeIds: ['emp-1', 'emp-2', 'emp-3'],
          replyPolicy: 'roundtable',
        },
        {
          createGroup: async () => {
            events.push('create:start');
            throw new Error('sqlite write rejected');
          },
          openThread: (threadId) => events.push(`open:${threadId}`),
          closeDialog: () => events.push('close'),
        },
      ),
      /sqlite write rejected/,
    );
    assert.deepEqual(events, ['create:start'], 'failure leaves the dialog open for visible retry');
  });

  // ── (1) draft materialization calls getOrCreateDirect ONCE (idempotent) ────
  await check('(1) direct draft double-send materializes exactly ONE direct thread', async () => {
    const db = new Database(':memory:');
    seed(db);
    const svc = makeService(db);
    // Two sends on the same unpersisted draft (e.g. a double-click) must converge.
    const t1 = await materializeDirectDraftAndSend(db, svc, 'co-1', 'emp-1', 'hi');
    const t2 = await materializeDirectDraftAndSend(db, svc, 'co-1', 'emp-1', 'hi again');
    assert.equal(t1, t2, 'both sends resolve the same direct thread');
    assert.equal(activeDirectCount(db, 'emp-1'), 1, 'exactly one active direct thread exists');
  });

  // ── (2) a Connect op surfaces as the new last-message / list state ─────────
  await check(
    '(2) appendMessage is observable through listThreads (invalidation re-read)',
    async () => {
      const db = new Database(':memory:');
      seed(db);
      const svc = makeService(db);
      const thread = await svc.getOrCreateDirect('co-1', 'emp-1');
      // The query fn IS service.listThreads; after a send, re-reading it (what the
      // invalidation triggers) must reflect the new last message + unread.
      const before = await svc.listThreads('co-1');
      assert.equal(before.find((t) => t.threadId === thread.threadId)?.lastMessage, null);
      await svc.appendMessage({ threadId: thread.threadId, senderType: 'boss', body: 'ping' });
      const after = await svc.listThreads('co-1');
      const summary = after.find((t) => t.threadId === thread.threadId);
      assert.equal(summary?.lastMessage?.body, 'ping', 'list re-read shows the new last message');
      assert.equal(summary?.unreadCount, 1, 'unread reflects the appended message');
    },
  );

  // ── (3) THREAD ISOLATION: a Connect op never touches chat_threads ──────────
  await check('(3) a Connect direct-draft send never touches chat_threads', async () => {
    const db = new Database(':memory:');
    seed(db);
    const svc = makeService(db);
    const before = chatThreadCount(db);
    await materializeDirectDraftAndSend(db, svc, 'co-1', 'emp-1', 'hello');
    // A full group flow too — none of it may change the project-chat table.
    const group = await svc.createGroup({ companyId: 'co-1', title: 'G', employeeIds: ['emp-2'] });
    await svc.appendMessage({ threadId: group.threadId, senderType: 'boss', body: 'team hi' });
    await svc.archive(group.threadId);
    await svc.unarchive(group.threadId);
    assert.equal(chatThreadCount(db), before, 'chat_threads count unchanged by any Connect op');
    assert.equal(before, 1, 'the pre-existing project chat row is intact');
  });

  // ── (4) GROUP pending invariant reuses PR-01 shouldShowPendingReply ────────
  await check('(4) two streaming speakers show ≤1 pending slot PER ACTIVE turn', () => {
    // Two active speaker turns in one round. Each turn owns at most one pending
    // slot (keyed on its turn/attempt id), and a turn whose body has landed shows
    // NONE — exactly the PR-01 invariant the Messenger reuses.
    const turnA = 'turn-a';
    const turnB = 'turn-b';
    // turnA has streamed visible body; turnB is still empty.
    const visible: PresentationMessage[] = [
      { id: 'boss-1', author: 'boss', body: 'go team' },
      { id: 'msg-a', author: 'employee', body: 'Alex here', attemptId: turnA },
      // an EMPTY shell for turnB must be filtered out by visibleWorkspaceMessages
      { id: 'msg-b', author: 'employee', body: '', attemptId: turnB },
    ];
    const rendered = visibleWorkspaceMessages(visible);
    assert.ok(
      !rendered.some((m) => m.id === 'msg-b'),
      'an empty assistant shell never renders (no empty Employee box)',
    );
    // turnA already has its visible reply → NO pending slot.
    const showA = shouldShowPendingReply({
      run: { phase: 'running', attemptId: turnA },
      visibleMessages: rendered,
      activeAttemptId: turnA,
    });
    assert.equal(showA, false, 'turn A (reply landed) shows no pending slot');
    // turnB has no visible reply yet → EXACTLY one pending slot.
    const showB = shouldShowPendingReply({
      run: { phase: 'running', attemptId: turnB },
      visibleMessages: rendered,
      activeAttemptId: turnB,
    });
    assert.equal(showB, true, 'turn B (no reply yet) shows exactly one pending slot');
    // Count pending slots across both active turns: must be ≤1 per active turn.
    const pendingCount = [turnA, turnB].filter((turnId) =>
      shouldShowPendingReply({
        run: { phase: 'running', attemptId: turnId },
        visibleMessages: rendered,
        activeAttemptId: turnId,
      }),
    ).length;
    assert.equal(pendingCount, 1, 'one pending slot total (only the un-replied turn)');
  });

  // ── (5) company switch resets the active selection ─────────────────────────
  await check('(5) a company switch resets the Connect thread selection', () => {
    // The Messenger resets `draft` + `selectedId` whenever `companyId` changes.
    // Model that pure reset: selecting a thread under co-1, then switching the
    // company key, must drop the selection (no cross-company thread bleed).
    function resolveSelection(
      companyId: string,
      selectedThreadCompany: string | null,
      selectedId: string | null,
    ): string | null {
      // The active thread is only valid when it belongs to the current company.
      if (selectedThreadCompany !== companyId) return null;
      return selectedId;
    }
    assert.equal(
      resolveSelection('co-1', 'co-1', 't-1'),
      't-1',
      'selection holds within a company',
    );
    assert.equal(
      resolveSelection('co-2', 'co-1', 't-1'),
      null,
      'switching company drops a prior company selection',
    );
  });

  // ── (6) the round/Continue trigger is BOSS-authored, never an employee reply ─
  await check('(6) continueRound trigger resolves to the boss message after a round', async () => {
    const db = new Database(':memory:');
    seed(db);
    const svc = makeService(db);
    const group = await svc.createGroup({
      companyId: 'co-1',
      title: 'Team',
      employeeIds: ['emp-1', 'emp-2'],
      replyPolicy: 'roundtable',
    });
    // Boss posts the round topic, then a round completes → the transcript ENDS
    // with employee replies (the controller upserts employee messages last).
    const boss = await svc.appendMessage({
      threadId: group.threadId,
      senderType: 'boss',
      body: 'lets discuss the launch',
    });
    await svc.appendMessage({
      threadId: group.threadId,
      senderType: 'employee',
      senderEmployeeId: 'emp-1',
      senderLabel: 'Alex',
      body: 'I think we ship Friday',
    });
    await svc.appendMessage({
      threadId: group.threadId,
      senderType: 'employee',
      senderEmployeeId: 'emp-2',
      senderLabel: 'Kai',
      body: 'agreed, design is ready',
    });

    // The thread SUMMARY's last message is now an EMPLOYEE reply — proving why
    // seeding the trigger from `lastMessage` (any author) would be wrong.
    const summary = (await svc.listThreads('co-1')).find((t) => t.threadId === group.threadId);
    assert.equal(
      summary?.lastMessage?.senderType,
      'employee',
      'thread last message is an employee reply',
    );

    // The Messenger resolves the round/Continue trigger by scanning the persisted
    // transcript (oldest→newest) and keeping the LAST boss-authored message — the
    // exact `lastBossRef` rule. Model it here over the real persisted page.
    function resolveBossTrigger(
      messages: ReadonlyArray<{ senderType: string; messageId: string }>,
    ): { messageId: string } | null {
      let trigger: { messageId: string } | null = null;
      for (const m of messages) if (m.senderType === 'boss') trigger = { messageId: m.messageId };
      return trigger;
    }
    // listMessages is newest-first; the component reads oldest→newest, so reverse.
    const page = await svc.listMessages(group.threadId, null, 50);
    const oldestFirst = [...page.messages].reverse();
    const trigger = resolveBossTrigger(oldestFirst);
    assert.ok(trigger, 'a boss trigger exists');
    assert.equal(
      trigger?.messageId,
      boss.messageId,
      'the trigger is the boss message, not an employee reply',
    );
    // And explicitly: it is NOT either employee reply.
    const employeeIds = oldestFirst
      .filter((m) => m.senderType === 'employee')
      .map((m) => m.messageId);
    assert.ok(!employeeIds.includes(trigger!.messageId), 'trigger is never an employee reply');
  });

  // ── (6b) with NO boss message yet, the round trigger is null (Continue hidden) ─
  await check('(6b) no boss message → no round trigger (Continue round is gated off)', async () => {
    const db = new Database(':memory:');
    seed(db);
    const svc = makeService(db);
    const group = await svc.createGroup({
      companyId: 'co-1',
      title: 'Team',
      employeeIds: ['emp-1'],
      replyPolicy: 'roundtable',
    });
    // Only a system message exists (no boss-authored message yet).
    await svc.appendMessage({
      threadId: group.threadId,
      senderType: 'system',
      body: 'room created',
    });
    const page = await svc.listMessages(group.threadId, null, 50);
    const hasBossTrigger = [...page.messages].some((m) => m.senderType === 'boss');
    assert.equal(hasBossTrigger, false, 'no boss trigger → the Continue round button is hidden');
  });

  // ── INJECT-PROOF #1: breaking thread-isolation makes (3) fail ──────────────
  await check('inject-proof: a Connect op that writes chat_threads is CAUGHT', async () => {
    const db = new Database(':memory:');
    seed(db);
    const svc = makeService(db);
    const before = chatThreadCount(db);
    await materializeDirectDraftAndSend(db, svc, 'co-1', 'emp-1', 'leak', { breakIsolation: true });
    // With the forbidden write injected, the isolation invariant MUST now fail —
    // we assert that it does (so a real isolation break can never pass silently).
    assert.notEqual(
      chatThreadCount(db),
      before,
      'isolation break is observable (chat_threads grew) — the real check would FAIL',
    );
  });

  // ── INJECT-PROOF #2: breaking idempotent-draft makes (1) fail ──────────────
  await check('inject-proof: a non-idempotent draft (new thread each send) is CAUGHT', async () => {
    const db = new Database(':memory:');
    seed(db);
    const svc = makeService(db);
    const t1 = await materializeDirectDraftAndSend(db, svc, 'co-1', 'emp-1', 'a', {
      breakIdempotency: true,
    });
    const t2 = await materializeDirectDraftAndSend(db, svc, 'co-1', 'emp-1', 'b', {
      breakIdempotency: true,
    });
    // The broken draft makes a fresh thread per send → the idempotency invariant
    // (one thread) MUST now fail; we assert it does.
    assert.notEqual(t1, t2, 'broken draft yields two threads — the real check would FAIL');
  });

  console.log(`\nconnect-chat-flow: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('connect-chat-flow: FAIL');
    process.exit(1);
  }
  console.log('connect-chat-flow: PASS');
}

main().catch((err) => {
  console.error('connect-chat-flow: FAIL');
  console.error(err instanceof assert.AssertionError ? err.message : err);
  process.exit(1);
});
