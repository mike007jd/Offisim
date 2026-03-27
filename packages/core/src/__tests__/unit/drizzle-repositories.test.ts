import * as schema from '@aics/db-local';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDrizzleRepositories } from '../../runtime/drizzle-repositories.js';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DDL_PATH = resolve(
  import.meta.dirname ?? '.',
  '../../../../../Docs/02_contracts_and_schemas/offisim_local_runtime_schema.sql',
);

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const ddl = readFileSync(DDL_PATH, 'utf-8');
  sqlite.exec(ddl);
  return drizzle(sqlite, { schema });
}

describe('DrizzleRepositories', () => {
  let repos: ReturnType<typeof createDrizzleRepositories>;

  beforeEach(() => {
    const db = createTestDb();
    repos = createDrizzleRepositories(db);

    db.insert(schema.companies)
      .values({
        company_id: 'c-1',
        name: 'Test Corp',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .run();
  });

  it('threads: create and findById', async () => {
    const thread = await repos.threads.create({
      thread_id: 't-1',
      company_id: 'c-1',
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
    });
    expect(thread.thread_id).toBe('t-1');

    const found = await repos.threads.findById('t-1');
    expect(found?.status).toBe('running');
  });

  it('threads: updateStatus', async () => {
    await repos.threads.create({
      thread_id: 't-1',
      company_id: 'c-1',
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
    });
    await repos.threads.updateStatus('t-1', 'completed');
    const found = await repos.threads.findById('t-1');
    expect(found?.status).toBe('completed');
  });

  it('threads: updateSynopsis persists synopsis_json', async () => {
    await repos.threads.create({
      thread_id: 't-1',
      company_id: 'c-1',
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
    });

    await repos.threads.updateSynopsis(
      't-1',
      JSON.stringify({
        version: 1,
        summary: 'A condensed summary',
        prunedMessageCount: 9,
        totalMessageCount: 14,
        updatedAt: new Date().toISOString(),
      }),
    );

    const found = await repos.threads.findById('t-1');
    expect(found?.synopsis_json).toContain('condensed summary');
  });

  it('taskRuns: create and findByThread', async () => {
    await repos.threads.create({
      thread_id: 't-1',
      company_id: 'c-1',
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
    });
    await repos.taskRuns.create({
      task_run_id: 'tr-1',
      thread_id: 't-1',
      employee_id: null,
      parent_task_run_id: null,
      task_type: 'boss_chat',
      status: 'running',
      input_json: null,
      output_json: null,
      started_at: new Date().toISOString(),
    });
    const runs = await repos.taskRuns.findByThread('t-1');
    expect(runs).toHaveLength(1);
  });

  it('checkpoints: save and findLatest', async () => {
    await repos.threads.create({
      thread_id: 't-1',
      company_id: 'c-1',
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
    });
    await repos.checkpoints.save({
      checkpoint_id: 'cp-1',
      thread_id: 't-1',
      checkpoint_seq: 1,
      checkpoint_kind: 'node_complete',
      payload_json: '{}',
      created_at: new Date().toISOString(),
    });
    await repos.checkpoints.save({
      checkpoint_id: 'cp-2',
      thread_id: 't-1',
      checkpoint_seq: 2,
      checkpoint_kind: 'interrupt',
      payload_json: '{"x":1}',
      created_at: new Date().toISOString(),
    });
    const latest = await repos.checkpoints.findLatest('t-1');
    expect(latest?.checkpoint_seq).toBe(2);
  });

  it('memories: findByDedupeKey and reinforce update structured fields', async () => {
    const created = await repos.memories.create({
      memory_id: 'mem-1',
      company_id: 'c-1',
      scope: 'employee',
      owner_id: 'e-1',
      category: 'knowledge',
      content: 'Token expiry check comes first',
      importance: 0.61,
      confidence: 0.7,
      dedupe_key: 'token expiry check comes first',
    });
    expect(created.reinforcement_count).toBe(1);

    const found = await repos.memories.findByDedupeKey({
      companyId: 'c-1',
      scope: 'employee',
      ownerId: 'e-1',
      category: 'knowledge',
      dedupeKey: 'token expiry check comes first',
    });
    expect(found?.memory_id).toBe('mem-1');

    const reinforced = await repos.memories.reinforce('mem-1', {
      content: 'Token expiry check always comes first when debugging auth',
      importance: 0.82,
      confidence: 0.9,
    });
    expect(reinforced?.reinforcement_count).toBe(2);
    expect(reinforced?.importance).toBe(0.82);
    expect(reinforced?.confidence).toBe(0.9);
  });
});
