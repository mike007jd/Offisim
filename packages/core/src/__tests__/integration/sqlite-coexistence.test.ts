import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createCheckpointSaver } from '../../graph/checkpoint-saver.js';

describe('SqliteSaver coexistence with app tables', () => {
  const tmpFiles: string[] = [];

  function createTempDb(): { db: Database.Database; filePath: string } {
    const filePath = path.join(
      os.tmpdir(),
      `offisim-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    tmpFiles.push(filePath);
    const db = new Database(filePath);
    // Simulate our app tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        company_id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS graph_threads (
        thread_id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS graph_checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        checkpoint_seq INTEGER NOT NULL,
        checkpoint_kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(thread_id, checkpoint_seq)
      );
    `);
    return { db, filePath };
  }

  afterEach(() => {
    for (const f of tmpFiles) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
    tmpFiles.length = 0;
  });

  it('SqliteSaver internal tables do not conflict with app tables', async () => {
    const { db } = createTempDb();
    const checkpointer = await createCheckpointSaver(db);

    // Write app data
    db.exec("INSERT INTO companies (company_id, name) VALUES ('c-1', 'Test Corp')");
    db.exec("INSERT INTO graph_threads (thread_id, company_id) VALUES ('t-1', 'c-1')");

    // Write via SqliteSaver (creates its own internal tables)
    const config = { configurable: { thread_id: 't-1' } };
    const checkpoint = {
      v: 1,
      id: 'cp-coexist',
      ts: new Date().toISOString(),
      channel_values: { test: true },
      channel_versions: {},
      versions_seen: {},
      pending_sends: [],
    };
    await checkpointer.put(config, checkpoint, { source: 'input', step: 0, parents: {} }, {});

    // App data still readable
    const company = db.prepare('SELECT * FROM companies WHERE company_id = ?').get('c-1') as {
      name: string;
    };
    expect(company.name).toBe('Test Corp');

    // SqliteSaver data readable
    const tuple = await checkpointer.getTuple({
      configurable: { thread_id: 't-1', checkpoint_id: 'cp-coexist' },
    });
    expect(tuple).toBeDefined();
    expect(tuple?.checkpoint.channel_values).toEqual({ test: true });

    // Our graph_checkpoints table is untouched by SqliteSaver
    const ourCheckpoints = db.prepare('SELECT COUNT(*) as cnt FROM graph_checkpoints').get() as {
      cnt: number;
    };
    expect(ourCheckpoints.cnt).toBe(0);

    db.close();
  });

  it('file-based SqliteSaver persists across reopen', async () => {
    const { db, filePath } = createTempDb();
    const checkpointer = await createCheckpointSaver(db);

    const config = { configurable: { thread_id: 'file-thread' } };
    const checkpoint = {
      v: 1,
      id: 'cp-file',
      ts: new Date().toISOString(),
      channel_values: { persisted: true },
      channel_versions: {},
      versions_seen: {},
      pending_sends: [],
    };
    await checkpointer.put(config, checkpoint, { source: 'input', step: 0, parents: {} }, {});
    db.close();

    // Reopen the same file
    const db2 = new Database(filePath);
    const checkpointer2 = await createCheckpointSaver(db2);

    const tuple = await checkpointer2.getTuple({
      configurable: { thread_id: 'file-thread', checkpoint_id: 'cp-file' },
    });
    expect(tuple).toBeDefined();
    expect(tuple?.checkpoint.channel_values).toEqual({ persisted: true });

    db2.close();
  });
});
