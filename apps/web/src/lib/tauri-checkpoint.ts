import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  copyCheckpoint,
  TASKS,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { PendingWrite, CheckpointPendingWrite } from '@langchain/langgraph-checkpoint';

/**
 * LangGraph checkpoint saver backed by tauri-plugin-sql (SQLite).
 *
 * Replicates the SqliteSaver logic but uses async tauri-plugin-sql
 * instead of synchronous better-sqlite3.
 *
 * Tables used (`checkpoints` + `writes`) are created by Rust migration 6.
 */
export class TauriCheckpointSaver extends BaseCheckpointSaver {
  private db: any = null;

  private async getDb() {
    if (!this.db) {
      const { default: Database } = await import('@tauri-apps/plugin-sql');
      this.db = await Database.load('sqlite:aics.db');
    }
    return this.db;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const db = await this.getDb();
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

    const rows = await db.select<any[]>(sql, params);
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
      JSON.parse(row.pending_writes || '[]').map(async (w: any) => [
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
    const db = await this.getDb();
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
    if (limit) sql += ` LIMIT ${Number(limit)}`;

    const rows = await db.select<any[]>(sql, params);

    for (const row of rows) {
      const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
        JSON.parse(row.pending_writes || '[]').map(async (w: any) => [
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
    const db = await this.getDb();
    if (!config.configurable) throw new Error('Empty configuration supplied.');

    const thread_id = config.configurable.thread_id;
    const checkpoint_ns = config.configurable.checkpoint_ns ?? '';
    const parent_checkpoint_id = config.configurable.checkpoint_id;

    if (!thread_id) {
      throw new Error('Missing "thread_id" in config.configurable.');
    }

    const preparedCheckpoint = copyCheckpoint(checkpoint);
    const [[type1, serializedCheckpoint], [type2, serializedMetadata]] =
      await Promise.all([
        this.serde.dumpsTyped(preparedCheckpoint),
        this.serde.dumpsTyped(metadata),
      ]);

    if (type1 !== type2) {
      throw new Error('Failed to serialize checkpoint and metadata to same type.');
    }

    await db.execute(
      `INSERT OR REPLACE INTO checkpoints
       (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [thread_id, checkpoint_ns, checkpoint.id, parent_checkpoint_id, type1, serializedCheckpoint, serializedMetadata],
    );

    return {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const db = await this.getDb();
    if (!config.configurable?.thread_id || !config.configurable?.checkpoint_id) {
      throw new Error('Missing thread_id or checkpoint_id in config.configurable.');
    }

    const thread_id = config.configurable.thread_id;
    const checkpoint_ns = config.configurable.checkpoint_ns ?? '';
    const checkpoint_id = config.configurable.checkpoint_id;

    const serialized = await Promise.all(
      writes.map(async (write, idx) => {
        const [type, serializedValue] = await this.serde.dumpsTyped(write[1]);
        return [thread_id, checkpoint_ns, checkpoint_id, taskId, idx, write[0], type, serializedValue];
      }),
    );

    await db.execute('BEGIN');
    try {
      for (const row of serialized) {
        await db.execute(
          `INSERT OR REPLACE INTO writes
           (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          row,
        );
      }
      await db.execute('COMMIT');
    } catch (e) {
      await db.execute('ROLLBACK');
      throw e;
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    const db = await this.getDb();
    await db.execute('BEGIN');
    try {
      await db.execute('DELETE FROM checkpoints WHERE thread_id = $1', [threadId]);
      await db.execute('DELETE FROM writes WHERE thread_id = $1', [threadId]);
      await db.execute('COMMIT');
    } catch (e) {
      await db.execute('ROLLBACK');
      throw e;
    }
  }
}
