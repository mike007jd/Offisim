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

/**
 * A LangGraph checkpoint's `channel_values` only carries the channels a node
 * actually wrote during its step. A partial (delta) write therefore looks like
 * a full state but is missing structural channels, and resuming from it would
 * resurrect a corrupt mid-turn state (e.g. a plan with no step indices). Guard
 * by requiring the always-present structural channels before treating
 * `channel_values` as a resumable full state; otherwise force a full replan.
 */
function isResumableState(values: unknown): values is OffisimGraphState {
  if (!values || typeof values !== 'object') return false;
  const state = values as Partial<OffisimGraphState>;
  return (
    typeof state.entryMode === 'string' &&
    Array.isArray(state.messages) &&
    Array.isArray(state.dispatchedStepIndices) &&
    Array.isArray(state.completedStepIndices) &&
    Array.isArray(state.blockedStepIndices) &&
    // taskPlan is nullable but the channel itself must be present (null when
    // no plan, an object otherwise — undefined means it was never written).
    state.taskPlan !== undefined
  );
}

export function withLoadLatest<T extends BaseCheckpointSaver>(
  saver: T,
): T & LoadLatestCheckpointSaver {
  const enhanced = saver as T & LoadLatestCheckpointSaver;
  enhanced.loadLatest = async (conversationId: string) => {
    const tuple = await saver.getTuple({
      configurable: { thread_id: conversationId },
    });
    if (!tuple) return null;
    const checkpoint = tuple.checkpoint as { channel_values?: unknown; ts?: unknown };
    const state = checkpoint.channel_values;
    // Reject partial (delta) checkpoints so resume falls back to a full replan
    // instead of resurrecting an incomplete mid-turn state.
    if (!isResumableState(state)) return null;
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
