import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { conversationDeletionStatements } from '../apps/desktop/renderer/src/data/local-data-deletion.js';

const deletionSource = readFileSync(
  new URL('../apps/desktop/renderer/src/data/local-data-deletion.ts', import.meta.url),
  'utf8',
);
const conversationDeleteSource = deletionSource.slice(
  deletionSource.indexOf('export async function deleteConversationDeep'),
  deletionSource.indexOf('/** Delete one Mission aggregate.'),
);
assert.ok(
  conversationDeleteSource.indexOf('requireDeletionPreflight') <
    conversationDeleteSource.indexOf('localDbTransaction'),
  'Conversation deletion must preflight workspace authority before opening the delete transaction',
);
const companyDeleteSource = deletionSource.slice(
  deletionSource.indexOf('export async function deleteCompanyDeep'),
);
assert.ok(
  companyDeleteSource.indexOf('requireDeletionPreflight') <
    companyDeleteSource.indexOf('localDbTransaction'),
  'Company deletion must preflight workspace authority before opening the delete transaction',
);

const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');
sqlite.exec(readFileSync(new URL('../packages/db-local/src/schema.sql', import.meta.url), 'utf8'));

const now = '2026-07-13T00:00:00.000Z';
const projectRoot = '/tmp/offisim-fixture/project';
const projectRootIdentityJson = JSON.stringify({
  canonicalRoot: projectRoot,
  volumeIdentifier: 'fixture-volume',
  fileIdentifier: 'fixture-project',
});
sqlite
  .prepare('INSERT INTO companies (company_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
  .run('co', 'Company', now, now);
sqlite
  .prepare(
    'INSERT INTO projects (project_id, company_id, name, workspace_root, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
  .run('project', 'co', 'Project', projectRoot, now, now);
sqlite
  .prepare(
    `INSERT INTO project_workspace_authority
      (project_id, company_id, canonical_root, root_identity_json,
       selected_at_unix_ms, updated_at_unix_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  .run('project', 'co', projectRoot, projectRootIdentityJson, 1, 1);
for (const threadId of ['thread-delete', 'thread-keep']) {
  sqlite
    .prepare(
      'INSERT INTO chat_threads (thread_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(threadId, 'project', threadId, now, now);
}

sqlite
  .prepare(
    `INSERT INTO loop_definitions
      (loop_id, company_id, title, profile_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'ready', ?, ?)`,
  )
  .run('loop', 'co', 'Loop', 'profile', now, now);
sqlite
  .prepare(
    `INSERT INTO loop_revisions
      (revision_id, loop_id, revision_number, source_prompt, compiled_ir_json,
       compiler_profile_id, compiler_profile_version, compiler_version, compile_status, created_at)
     VALUES (?, ?, 1, ?, '{}', ?, ?, ?, 'ready', ?)`,
  )
  .run('revision', 'loop', 'Do work', 'profile', '1', '1', now);

function seedMission(suffix: 'delete' | 'keep'): void {
  const threadId = `thread-${suffix}`;
  const missionId = `mission-${suffix}`;
  const criterionId = `criterion-${suffix}`;
  const attemptId = `attempt-${suffix}`;
  sqlite
    .prepare(
      `INSERT INTO mission
        (mission_id, company_id, project_id, thread_id, title, goal, status, runtime_id,
         runtime_policy_json, budget_json, created_at, updated_at)
       VALUES (?, 'co', 'project', ?, ?, ?, 'ready', 'pi-agent', '{}', '{}', ?, ?)`,
    )
    .run(missionId, threadId, missionId, 'Goal', now, now);
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
       VALUES (?, ?, 1, 'initial', 'running', ?)`,
    )
    .run(attemptId, missionId, now);
  sqlite
    .prepare(
      `INSERT INTO mission_evaluation
        (evaluation_id, mission_id, criterion_id, attempt_id, evaluator_id, verdict,
         summary, evidence_refs_json, created_at)
       VALUES (?, ?, ?, ?, 'manual', 'pass', 'ok', '[]', ?)`,
    )
    .run(`evaluation-${suffix}`, missionId, criterionId, attemptId, now);
  sqlite
    .prepare(
      `INSERT INTO runtime_session_link
        (runtime_session_link_id, mission_id, runtime_id, opaque_session_ref_json, status)
       VALUES (?, ?, 'pi-agent', '{}', 'active')`,
    )
    .run(`session-${suffix}`, missionId);
  sqlite
    .prepare(
      `INSERT INTO mission_event
        (mission_event_id, mission_id, attempt_id, type, data_json, created_at)
       VALUES (?, ?, ?, 'started', '{}', ?)`,
    )
    .run(`event-${suffix}`, missionId, attemptId, now);
  sqlite
    .prepare(
      `INSERT INTO loop_invocations
        (invocation_id, loop_id, revision_id, company_id, project_id, thread_id,
         message_id, mission_id, status, created_at)
       VALUES (?, 'loop', 'revision', 'co', 'project', ?, ?, ?, 'running', ?)`,
    )
    .run(`invocation-${suffix}`, threadId, `message-${suffix}`, missionId, now);
}

seedMission('delete');
seedMission('keep');

sqlite.transaction(() => {
  for (const statement of conversationDeletionStatements('thread-delete')) {
    sqlite.prepare(statement.sql).run({ 1: statement.params?.[0] });
  }
})();

const count = (table: string, column: string, value: string): number =>
  Number(
    (
      sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(value) as {
        count: number;
      }
    ).count,
  );

assert.equal(count('chat_threads', 'thread_id', 'thread-delete'), 0);
assert.equal(count('loop_invocations', 'thread_id', 'thread-delete'), 0);
assert.equal(count('mission', 'mission_id', 'mission-delete'), 0);
for (const [table, column] of [
  ['mission_criterion', 'mission_id'],
  ['mission_attempt', 'mission_id'],
  ['mission_evaluation', 'mission_id'],
  ['runtime_session_link', 'mission_id'],
  ['mission_event', 'mission_id'],
] as const) {
  assert.equal(count(table, column, 'mission-delete'), 0, `${table} cascades with mission`);
  assert.equal(count(table, column, 'mission-keep'), 1, `${table} keeps unrelated mission`);
}
assert.equal(count('chat_threads', 'thread_id', 'thread-keep'), 1);
assert.equal(count('loop_invocations', 'thread_id', 'thread-keep'), 1);
assert.equal(count('mission', 'mission_id', 'mission-keep'), 1);
assert.equal(count('loop_definitions', 'loop_id', 'loop'), 1);

sqlite
  .prepare(
    `INSERT INTO task_workspace_binding_history
      (binding_id, company_id, project_id, thread_id, turn_id, request_id, access,
       canonical_root, root_identity_json, workspace_basename_normalized,
       project_name_normalized, workspace_anchor, authority_snapshot_canonical_root,
       authority_snapshot_root_identity_json, authority_snapshot_updated_at_unix_ms,
       source, confidence, reason_code,
       issued_at_unix_ms, expires_at_unix_ms, activated_at_unix_ms,
       last_used_at_unix_ms, status)
     VALUES (?, ?, ?, ?, ?, ?, 'write', ?, ?, 'project', 'project', '/tmp/offisim-fixture',
       ?, ?, 1, 'project_catalog', 1,
       'current_project_folder', 1, 60001, 1, 1, 'active')`,
  )
  .run(
    'binding-active-keep',
    'co',
    'project',
    'thread-keep',
    'turn-active-keep',
    'request-active-keep',
    projectRoot,
    projectRootIdentityJson,
    projectRoot,
    projectRootIdentityJson,
  );
assert.equal(
  count('task_workspace_binding_history', 'binding_id', 'binding-active-keep'),
  1,
  'active binding fixture must pass the real Project authority trigger',
);
const blockedDelete = sqlite.transaction(() => {
  for (const statement of conversationDeletionStatements('thread-keep')) {
    sqlite.prepare(statement.sql).run({ 1: statement.params?.[0] });
  }
});
assert.throws(
  () => blockedDelete(),
  /active task workspace must be reviewed, released, or discarded/,
  'SQLite must atomically block a Conversation delete that races an active binding',
);
assert.equal(count('chat_threads', 'thread_id', 'thread-keep'), 1);
assert.equal(count('mission', 'mission_id', 'mission-keep'), 1, 'blocked transaction rolled back');

sqlite
  .prepare(
    `INSERT INTO agent_runs
      (run_id, thread_id, company_id, project_id, parent_run_id, root_run_id,
       relation, access, status, started_at)
     VALUES (?, 'thread-keep', 'co', 'project', NULL, ?, NULL, 'write', 'running', ?)`,
  )
  .run('turn-active-keep', 'turn-active-keep', now);
sqlite
  .prepare(
    `INSERT INTO agent_runs
      (run_id, thread_id, company_id, project_id, parent_run_id, root_run_id,
       relation, access, status, started_at)
     VALUES (?, 'thread-keep', 'co', 'project', ?, ?, 'delegate', 'write', 'running', ?)`,
  )
  .run('child-active-keep', 'turn-active-keep', 'turn-active-keep', now);
sqlite
  .prepare(
    `INSERT INTO task_workspace_lease_history
      (lease_id, project_id, created_binding_id, active_binding_id,
       created_root_run_id, child_run_id, created_request_id, branch,
       canonical_worktree, worktree_identity_json, project_root_identity_json,
       created_at_unix_ms, updated_at_unix_ms, status)
     VALUES (?, 'project', ?, ?, ?, ?, ?, ?, ?, '{}', ?, 1, 1, 'active')`,
  )
  .run(
    'lease-active-keep',
    'binding-active-keep',
    'binding-active-keep',
    'turn-active-keep',
    'child-active-keep',
    'request-active-keep',
    'offisim/lease/child-active-keep',
    '/tmp/offisim-fixture/project/.offisim/worktrees/lease-active-keep',
    projectRootIdentityJson,
  );
sqlite
  .prepare(
    `UPDATE task_workspace_binding_history
     SET status = 'completed', revoked_at_unix_ms = 2, release_reason = 'fixture_terminal'
     WHERE binding_id = 'binding-active-keep'`,
  )
  .run();
assert.equal(
  count('task_workspace_binding_history', 'status', 'active'),
  0,
  'retained-lease deletion oracle must not rely on an active binding',
);
assert.equal(count('task_workspace_lease_history', 'status', 'active'), 1);

const retainedLeaseDelete = sqlite.transaction(() => {
  for (const statement of conversationDeletionStatements('thread-keep')) {
    sqlite.prepare(statement.sql).run({ 1: statement.params?.[0] });
  }
});
assert.throws(
  () => retainedLeaseDelete(),
  /active task workspace must be reviewed, released, or discarded/,
  'SQLite must atomically block a Conversation delete with a retained active lease',
);
assert.equal(count('chat_threads', 'thread_id', 'thread-keep'), 1);
assert.equal(count('mission', 'mission_id', 'mission-keep'), 1);
assert.equal(
  count('agent_runs', 'thread_id', 'thread-keep'),
  2,
  'retained-lease rejection must roll back earlier agent-run deletes',
);
assert.equal(count('task_workspace_lease_history', 'status', 'active'), 1);

sqlite.close();
console.log(
  'conversation-deletion harness passed: preflight precedes delete; active bindings and retained leases roll back atomically',
);
