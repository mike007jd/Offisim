import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as schema from '@offisim/db-local/dist/schema.js';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDrizzleRepositories } from '../../runtime/drizzle-repositories.js';

const DDL_PATH = resolve(
  import.meta.dirname ?? '.',
  '../../../../../Docs/02_contracts_and_schemas/offisim_local_runtime_schema.sql',
);

function createSchemaContractDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(readFileSync(DDL_PATH, 'utf-8'));
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

describe('file history integration with Drizzle repositories', () => {
  let sqlite: Database.Database;
  let repos: ReturnType<typeof createDrizzleRepositories>;

  beforeEach(() => {
    const harness = createSchemaContractDb();
    sqlite = harness.sqlite;
    repos = createDrizzleRepositories(harness.db);
  });

  afterEach(() => {
    sqlite?.close();
  });

  it('persists file history rows against the published DDL schema', async () => {
    await repos.companies.create({
      company_id: 'company-1',
      name: 'History Corp',
      status: 'active',
      template_id: null,
      template_label: null,
      workspace_root: null,
      default_model_policy_json: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await repos.threads.create({
      thread_id: 'thread-1',
      company_id: 'company-1',
      entry_mode: 'background_sync',
      root_task_id: null,
      status: 'running',
    });

    await repos.fileHistory.create({
      history_id: 'fh-1',
      snapshot_id: 'snap-1',
      thread_id: 'thread-1',
      company_id: 'company-1',
      node_name: 'employee',
      employee_id: 'emp-1',
      task_run_id: null,
      tool_call_id: 'tc-1',
      tool_name: 'write_file',
      step_index: 1,
      file_path: '/workspace/app.ts',
      change_kind: 'update',
      existed_before: 1,
      backup_content: 'old',
      created_at: new Date().toISOString(),
    });

    await expect(repos.fileHistory.listByThread('thread-1')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          history_id: 'fh-1',
          snapshot_id: 'snap-1',
          file_path: '/workspace/app.ts',
        }),
      ]),
    );
  });
});
