import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  TASKS,
  copyCheckpoint,
} from '@langchain/langgraph-checkpoint';
import type { CheckpointPendingWrite, PendingWrite } from '@langchain/langgraph-checkpoint';
import type { OffisimGraphState } from '@offisim/core/browser';
import { getTauriDb } from './tauri-db';

/** Shape of a serialized write row from the pending_writes JSON aggregate. */
interface SerializedWriteRow {
  task_id: string;
  channel: string;
  type: string;
  value: string;
}

/**
 * Convert serialized output from `serde.dumpsTyped()` to a string for SQL storage.
 *
 * `JsonPlusSerializer.dumpsTyped()` returns `[type, Uint8Array]` where the
 * Uint8Array is UTF-8 encoded JSON. tauri-plugin-sql (backed by sqlx) serializes
 * JS values to JSON for IPC, so Uint8Array becomes `number[]` which sqlx does
 * NOT interpret as a BLOB correctly. By converting to a string first, SQLite
 * stores it as TEXT (dynamic typing) and returns it as a string on reads.
 *
 * `serde.loadsTyped()` accepts both `Uint8Array` and `string`, so strings work
 * for both storage and retrieval.
 */
function ensureString(data: Uint8Array | string): string {
  if (typeof data === 'string') return data;
  return new TextDecoder().decode(data);
}

/** Shape of a checkpoint row returned from SQLite select. */
interface CheckpointRow {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  type: string;
  checkpoint: string;
  metadata: string;
  pending_writes?: string;
  pending_sends?: string;
}

// TASKS is an internal LangGraph constant ('__pregel_tasks').
// Validate at import time to prevent SQL injection if the constant ever changes.
if (!/^[a-z_]+$/i.test(TASKS)) {
  throw new Error(`Unexpected TASKS channel name: ${TASKS}`);
}

/**
 * Process-level async write lock for `TauriCheckpointSaver` writes. The Tauri
 * `@tauri-apps/plugin-sql` bridge transports each `db.execute` call through
 * sqlx `SqlitePool` which does NOT pin a connection across successive calls;
 * that historically split `BEGIN IMMEDIATE` / INSERT / COMMIT across pool
 * connections and produced `database is locked` + `cannot rollback - no
 * transaction is active` races under concurrent writer pressure. Combined
 * with atomic single-execute SQL in `put` / `putWrites` / `deleteThread`, this
 * mutex guarantees at most one checkpoint writer is in flight at a time.
 * Read ops (`getTuple` / `list`) intentionally do not enter the mutex — WAL
 * preserves concurrent readers.
 *
 * A failed write does not poison the chain: `.catch(() => {})` before the
 * next `.then` swallows the prior error so later writes still execute.
 */
let checkpointWriteChain: Promise<unknown> = Promise.resolve();
function runWithCheckpointWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = checkpointWriteChain.catch(() => {}).then(fn);
  checkpointWriteChain = next.catch(() => {});
  return next;
}

/** Log a write-path error with stack to DevTools, best-effort (never throws). */
function logCheckpointError(method: string, err: unknown): void {
  try {
    const stack =
      err instanceof Error
        ? `${err.name}: ${err.message}\n${err.stack ?? '(no stack)'}`
        : String(err);
    console.error(`[tauri-checkpoint/${method}] ${stack}`);
  } catch {
    /* noop */
  }
}

/**
 * LangGraph checkpoint saver backed by tauri-plugin-sql (SQLite).
 *
 * Replicates the SqliteSaver logic but uses async tauri-plugin-sql
 * instead of synchronous better-sqlite3.
 *
 * Tables used (`checkpoints` + `writes`) are created by the desktop
 * SQLite bootstrap schema.
 */
export class TauriCheckpointSaver extends BaseCheckpointSaver {
  async loadLatest(
    conversationId: string,
  ): Promise<{ state: OffisimGraphState; lastCheckpointTs: number } | null> {
    const tuple = await this.getTuple({ configurable: { thread_id: conversationId } });
    if (!tuple) return null;
    const checkpoint = tuple.checkpoint as Checkpoint & {
      channel_values?: unknown;
      ts?: string | number;
    };
    const state = checkpoint.channel_values as OffisimGraphState | undefined;
    if (!state) return null;
    const parsedTs =
      typeof checkpoint.ts === 'number'
        ? checkpoint.ts
        : typeof checkpoint.ts === 'string'
          ? Date.parse(checkpoint.ts)
          : Number.NaN;
    return {
      state,
      lastCheckpointTs: Number.isFinite(parsedTs) ? parsedTs : 0,
    };
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const db = await getTauriDb();
    const { thread_id, checkpoint_ns = '', checkpoint_id } = config.configurable ?? {};

    let sql = `
      SELECT
        thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
        type, checkpoint, metadata,
        (
          SELECT json_group_array(
            json_object(
              'task_id', pw.task_id, 'channel', pw.channel,
              'type', pw.type, 'value', CAST(pw.value AS TEXT)
            )
          )
          FROM writes AS pw
          WHERE pw.thread_id = checkpoints.thread_id
            AND pw.checkpoint_ns = checkpoints.checkpoint_ns
            AND pw.checkpoint_id = checkpoints.checkpoint_id
        ) AS pending_writes,
        (
          SELECT json_group_array(
            json_object('type', ps.type, 'value', CAST(ps.value AS TEXT))
          )
          FROM writes AS ps
          WHERE ps.thread_id = checkpoints.thread_id
            AND ps.checkpoint_ns = checkpoints.checkpoint_ns
            AND ps.checkpoint_id = checkpoints.parent_checkpoint_id
            AND ps.channel = '${TASKS}'
          ORDER BY ps.idx
        ) AS pending_sends
      FROM checkpoints
      WHERE thread_id = $1 AND checkpoint_ns = $2`;

    const params: unknown[] = [thread_id, checkpoint_ns];
    if (checkpoint_id) {
      sql += ' AND checkpoint_id = $3';
      params.push(checkpoint_id);
    } else {
      sql += ' ORDER BY checkpoint_id DESC LIMIT 1';
    }

    const rows = await db.select<CheckpointRow[]>(sql, params);
    const row = rows[0];
    if (!row) return undefined;

    let finalConfig = config;
    if (!checkpoint_id) {
      finalConfig = {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns,
          checkpoint_id: row.checkpoint_id,
        },
      };
    }

    const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
      (JSON.parse(row.pending_writes || '[]') as SerializedWriteRow[]).map(async (w) => [
        w.task_id,
        w.channel,
        await this.serde.loadsTyped(w.type ?? 'json', w.value ?? ''),
      ]),
    );

    const checkpoint = (await this.serde.loadsTyped(
      row.type ?? 'json',
      row.checkpoint,
    )) as Checkpoint;

    return {
      checkpoint,
      config: finalConfig,
      metadata: (await this.serde.loadsTyped(
        row.type ?? 'json',
        row.metadata,
      )) as CheckpointMetadata,
      parentConfig: row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites,
    };
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const db = await getTauriDb();
    const { limit, before } = options ?? {};
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns;

    let sql = `
      SELECT
        thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
        type, checkpoint, metadata,
        (
          SELECT json_group_array(
            json_object(
              'task_id', pw.task_id, 'channel', pw.channel,
              'type', pw.type, 'value', CAST(pw.value AS TEXT)
            )
          )
          FROM writes AS pw
          WHERE pw.thread_id = checkpoints.thread_id
            AND pw.checkpoint_ns = checkpoints.checkpoint_ns
            AND pw.checkpoint_id = checkpoints.checkpoint_id
        ) AS pending_writes
      FROM checkpoints`;

    const whereClauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (thread_id) {
      whereClauses.push(`thread_id = $${paramIdx++}`);
      params.push(thread_id);
    }
    if (checkpoint_ns !== undefined && checkpoint_ns !== null) {
      whereClauses.push(`checkpoint_ns = $${paramIdx++}`);
      params.push(checkpoint_ns);
    }
    if (before?.configurable?.checkpoint_id) {
      whereClauses.push(`checkpoint_id < $${paramIdx++}`);
      params.push(before.configurable.checkpoint_id);
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    sql += ' ORDER BY checkpoint_id DESC';
    const parsedLimit = Number(limit);
    if (Number.isInteger(parsedLimit) && parsedLimit > 0) {
      sql += ` LIMIT ${parsedLimit}`;
    }

    const rows = await db.select<CheckpointRow[]>(sql, params);

    for (const row of rows) {
      const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
        (JSON.parse(row.pending_writes || '[]') as SerializedWriteRow[]).map(async (w) => [
          w.task_id,
          w.channel,
          await this.serde.loadsTyped(w.type ?? 'json', w.value ?? ''),
        ]),
      );

      const checkpoint = (await this.serde.loadsTyped(
        row.type ?? 'json',
        row.checkpoint,
      )) as Checkpoint;

      yield {
        config: {
          configurable: {
            thread_id: row.thread_id,
            checkpoint_ns: row.checkpoint_ns,
            checkpoint_id: row.checkpoint_id,
          },
        },
        checkpoint,
        metadata: (await this.serde.loadsTyped(
          row.type ?? 'json',
          row.metadata,
        )) as CheckpointMetadata,
        parentConfig: row.parent_checkpoint_id
          ? {
              configurable: {
                thread_id: row.thread_id,
                checkpoint_ns: row.checkpoint_ns,
                checkpoint_id: row.parent_checkpoint_id,
              },
            }
          : undefined,
        pendingWrites,
      };
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    if (!config.configurable) throw new Error('Empty configuration supplied.');

    const thread_id = config.configurable.thread_id;
    const checkpoint_ns = config.configurable.checkpoint_ns ?? '';
    const parent_checkpoint_id = config.configurable.checkpoint_id;

    if (!thread_id) {
      throw new Error('Missing "thread_id" in config.configurable.');
    }

    const preparedCheckpoint = copyCheckpoint(checkpoint);
    // Serde runs outside the write lock — it's pure CPU / no DB interaction.
    const [[type1, rawCheckpoint], [type2, rawMetadata]] = await Promise.all([
      this.serde.dumpsTyped(preparedCheckpoint),
      this.serde.dumpsTyped(metadata),
    ]);

    if (type1 !== type2) {
      throw new Error('Failed to serialize checkpoint and metadata to same type.');
    }

    // Convert Uint8Array to string for tauri-plugin-sql IPC compatibility.
    // SQLite stores TEXT in BLOB columns via dynamic typing; reads return strings.
    const serializedCheckpoint = ensureString(rawCheckpoint);
    const serializedMetadata = ensureString(rawMetadata);

    await runWithCheckpointWriteLock(async () => {
      const db = await getTauriDb();
      try {
        await db.execute(
          `INSERT OR REPLACE INTO checkpoints
           (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            thread_id,
            checkpoint_ns,
            checkpoint.id,
            parent_checkpoint_id,
            type1,
            serializedCheckpoint,
            serializedMetadata,
          ],
        );
      } catch (err) {
        logCheckpointError('put', err);
        throw err;
      }
    });

    return {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    if (!config.configurable?.thread_id || !config.configurable?.checkpoint_id) {
      throw new Error('Missing thread_id or checkpoint_id in config.configurable.');
    }

    if (writes.length === 0) return;

    const thread_id = config.configurable.thread_id;
    const checkpoint_ns = config.configurable.checkpoint_ns ?? '';
    const checkpoint_id = config.configurable.checkpoint_id;

    // Serialize outside the write lock — pure CPU / no DB interaction.
    const serialized = await Promise.all(
      writes.map(async (write, idx) => {
        const [type, rawValue] = await this.serde.dumpsTyped(write[1]);
        return [
          thread_id,
          checkpoint_ns,
          checkpoint_id,
          taskId,
          idx,
          write[0],
          type,
          ensureString(rawValue),
        ];
      }),
    );

    // Build a single `INSERT OR REPLACE ... VALUES (...), (...), ...` SQL so
    // the whole batch lands atomically inside one pool connection. This
    // replaces the historical `BEGIN IMMEDIATE` / per-row INSERT / `COMMIT`
    // split-call pattern, which was susceptible to sqlx pool returning a
    // different connection per `db.execute` and leaving BEGIN orphaned.
    const VALUES_PER_ROW = 8;
    const valuesClauses: string[] = [];
    const flatParams: unknown[] = [];
    for (let row = 0; row < serialized.length; row++) {
      const base = row * VALUES_PER_ROW;
      const placeholders: string[] = [];
      for (let col = 1; col <= VALUES_PER_ROW; col++) {
        placeholders.push(`$${base + col}`);
      }
      valuesClauses.push(`(${placeholders.join(', ')})`);
      const rowParams = serialized[row];
      if (rowParams) flatParams.push(...rowParams);
    }
    const sql = `INSERT OR REPLACE INTO writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value) VALUES ${valuesClauses.join(', ')}`;

    await runWithCheckpointWriteLock(async () => {
      const db = await getTauriDb();
      try {
        await db.execute(sql, flatParams);
      } catch (err) {
        logCheckpointError('putWrites', err);
        throw err;
      }
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    // Two sequential DELETEs without an explicit transaction. Orphan `writes`
    // rows (if the second DELETE fails) are invisible to read paths because
    // `getTuple` JOINs `checkpoints` as the anchor — removing the checkpoint
    // row hides any residual writes. Accept tiny table bloat over the
    // BEGIN/COMMIT split-connection race this previously produced.
    await runWithCheckpointWriteLock(async () => {
      const db = await getTauriDb();
      try {
        await db.execute('DELETE FROM checkpoints WHERE thread_id = $1', [threadId]);
        await db.execute('DELETE FROM writes WHERE thread_id = $1', [threadId]);
      } catch (err) {
        logCheckpointError('deleteThread', err);
        throw err;
      }
    });
  }
}
