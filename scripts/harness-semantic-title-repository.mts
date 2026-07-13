import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy';
import type { TauriDrizzleDb } from '../apps/desktop/renderer/src/lib/tauri-drizzle.js';
import { createProjectsTauriRepos } from '../apps/desktop/renderer/src/lib/tauri-repos/projects.js';

const CREATE_CHAT_THREADS = `
CREATE TABLE chat_threads (
  thread_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  employee_id TEXT,
  title TEXT NOT NULL,
  title_set_by_user INTEGER NOT NULL DEFAULT 0,
  semantic_title_job_id TEXT,
  semantic_title_status TEXT,
  semantic_title_source_provenance_json TEXT,
  semantic_title_result_provenance_json TEXT,
  semantic_title_usage_json TEXT,
  semantic_title_error_code TEXT,
  summary TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

function makeProxyDb(sqlite: Database.Database): TauriDrizzleDb {
  const proxy = drizzleProxy(async (sql, params, method) => {
    // Preserve an actual async boundary: this is the interleaving characteristic
    // of the renderer's Tauri sqlite-proxy backend, not the synchronous core repo.
    await Promise.resolve();
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

const sqlite = new Database(':memory:');
sqlite.exec(CREATE_CHAT_THREADS);
const repo = createProjectsTauriRepos(makeProxyDb(sqlite)).chatThreads;
const ts = '2026-07-14T00:00:00.000Z';
sqlite
  .prepare(
    `INSERT INTO chat_threads (
      thread_id, project_id, employee_id, title, title_set_by_user,
      semantic_title_job_id, semantic_title_status,
      semantic_title_source_provenance_json,
      semantic_title_result_provenance_json, semantic_title_usage_json,
      semantic_title_error_code, summary, archived_at, created_at, updated_at
    ) VALUES (?, ?, NULL, ?, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
  )
  .run('thread-race', 'project-1', 'Fallback title', ts, ts);

for (let index = 0; index < 50; index += 1) {
  sqlite
    .prepare(
      `UPDATE chat_threads SET
        title = ?, title_set_by_user = 0,
        semantic_title_job_id = NULL, semantic_title_status = NULL,
        semantic_title_source_provenance_json = NULL,
        semantic_title_result_provenance_json = NULL,
        semantic_title_usage_json = NULL, semantic_title_error_code = NULL`,
    )
    .run('Fallback title');

  await Promise.all([
    repo.beginSemanticTitleJob({
      threadId: 'thread-race',
      jobId: `semantic-title:thread-race:${index}`,
      sourceProvenanceJson: '{"runId":"turn-1"}',
    }),
    repo.updateTitle('thread-race', `Manual title ${index}`, { byUser: true }),
  ]);

  const row = await repo.findById('thread-race');
  assert.equal(row?.title, `Manual title ${index}`);
  assert.equal(row?.title_set_by_user, 1);
  assert.notEqual(
    row?.semantic_title_status,
    'running',
    'manual title ownership must atomically cancel or pre-empt a concurrent title claim',
  );
}

console.log('semantic-title repository gate passed: 50 async rename/claim interleavings');
