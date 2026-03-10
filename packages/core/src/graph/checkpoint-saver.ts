/**
 * @aics/core — Checkpoint saver factories
 *
 * Production: SqliteSaver from @langchain/langgraph-checkpoint-sqlite
 * Testing: MemorySaver from @langchain/langgraph
 */

import { type BaseCheckpointSaver, MemorySaver } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import type Database from 'better-sqlite3';

/**
 * Create a SQLite-backed checkpoint saver for production use.
 *
 * The provided Database instance should be the same one used by Drizzle
 * to avoid WAL lock contention from dual connections.
 *
 * SqliteSaver manages its own internal tables (`checkpoints`, `writes`)
 * inside the shared SQLite file. These do NOT conflict with our
 * `graph_checkpoints` table.
 */
export function createCheckpointSaver(db: Database.Database): BaseCheckpointSaver {
  return new SqliteSaver(db);
}

/**
 * Create an in-memory checkpoint saver for testing.
 */
export function createMemoryCheckpointSaver(): BaseCheckpointSaver {
  return new MemorySaver();
}
