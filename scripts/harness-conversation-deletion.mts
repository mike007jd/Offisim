import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { conversationDeletionStatements } from '../apps/desktop/renderer/src/data/local-data-deletion.js';

const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');
sqlite.exec(readFileSync(new URL('../packages/db-local/src/schema.sql', import.meta.url), 'utf8'));

const now = '2026-07-13T00:00:00.000Z';
sqlite
  .prepare('INSERT INTO companies (company_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
  .run('co', 'Company', now, now);
sqlite
  .prepare(
    'INSERT INTO projects (project_id, company_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
  .run('project', 'co', 'Project', now, now);
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

sqlite.close();
console.log(
  'conversation-deletion harness passed: thread graph deleted transactionally; unrelated graph retained',
);
