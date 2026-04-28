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
import type { OffisimGraphState } from './state.js';

export interface LatestCheckpointSnapshot {
  state: OffisimGraphState;
  lastCheckpointTs: number;
}

export interface LoadLatestCheckpointSaver extends BaseCheckpointSaver {
  loadLatest(conversationId: string): Promise<LatestCheckpointSnapshot | null>;
}

function checkpointTimestamp(checkpoint: { ts?: unknown }, metadata: unknown): number {
  const meta = metadata as { updated_at?: unknown; created_at?: unknown } | undefined;
  const raw = checkpoint.ts ?? meta?.updated_at ?? meta?.created_at;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== 'string') return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function withLoadLatest<T extends BaseCheckpointSaver>(saver: T): T & LoadLatestCheckpointSaver {
  const enhanced = saver as T & LoadLatestCheckpointSaver;
  enhanced.loadLatest = async (conversationId: string) => {
    const tuple = await saver.getTuple({
      configurable: { thread_id: conversationId },
    });
    if (!tuple) return null;
    const checkpoint = tuple.checkpoint as { channel_values?: unknown; ts?: unknown };
    const state = checkpoint.channel_values as OffisimGraphState | undefined;
    if (!state) return null;
    return {
      state,
      lastCheckpointTs: checkpointTimestamp(checkpoint, tuple.metadata),
    };
  };
  return enhanced;
}

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
export async function createCheckpointSaver(
  db: Database.Database,
): Promise<LoadLatestCheckpointSaver> {
  const { SqliteSaver } = await import('@langchain/langgraph-checkpoint-sqlite');
  return withLoadLatest(new SqliteSaver(db));
}

/**
 * Create an in-memory checkpoint saver for testing and browser runtime.
 */
export function createMemoryCheckpointSaver(): LoadLatestCheckpointSaver {
  return withLoadLatest(new MemorySaver());
}
