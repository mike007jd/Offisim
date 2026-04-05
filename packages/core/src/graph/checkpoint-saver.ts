/**
 * @offisim/core — Checkpoint saver factories
 *
 * Desktop (Tauri): SqliteSaver from @langchain/langgraph-checkpoint-sqlite
 * Browser / tests: MemorySaver from @langchain/langgraph
 *
 * The sqlite saver is loaded via `await import()` instead of a top-level
 * import so browser bundles don't statically pull in a Node-only dependency
 * through the main-graph → checkpoint-saver import chain.
 */

import { type BaseCheckpointSaver, MemorySaver } from '@langchain/langgraph';
import type Database from 'better-sqlite3';

/**
 * Create a SQLite-backed checkpoint saver for desktop use.
 *
 * The provided Database instance should be the same one used by Drizzle
 * to avoid WAL lock contention from dual connections.
 *
 * SqliteSaver manages its own internal tables (`checkpoints`, `writes`)
 * inside the shared SQLite file. These do NOT conflict with our
 * `graph_checkpoints` table.
 */
export async function createCheckpointSaver(db: Database.Database): Promise<BaseCheckpointSaver> {
  const { SqliteSaver } = await import('@langchain/langgraph-checkpoint-sqlite');
  return new SqliteSaver(db);
}

/**
 * Create an in-memory checkpoint saver for testing and browser runtime.
 */
export function createMemoryCheckpointSaver(): BaseCheckpointSaver {
  return new MemorySaver();
}
