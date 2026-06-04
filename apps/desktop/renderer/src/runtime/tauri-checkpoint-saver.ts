import { type TauriDrizzleDb, createTauriDrizzleDb } from '@/lib/tauri-drizzle.js';
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type LoadLatestCheckpointSaver,
  withLoadLatest,
} from '@offisim/core/runtime';
import * as schema from '@offisim/db-local';
import { and, desc, eq, lt } from 'drizzle-orm';

/**
 * Async, Drizzle-backed LangGraph checkpoint saver for the Tauri renderer.
 *
 * The bundled `SqliteSaver` needs a synchronous better-sqlite3 handle, which the
 * renderer does not have — it only reaches SQLite through the async
 * tauri-plugin-sql proxy. LangGraph's pregel loop awaits the checkpointer
 * everywhere, so a fully-async saver is correct. This mirrors `SqliteSaver`'s
 * table shape (`checkpoints` + `writes`, already in schema.sql) and serde
 * protocol, but writes through the Drizzle proxy so every write rides the
 * tauri-drizzle global write-chain mutex.
 *
 * Serde payloads are stored base64-encoded in the BLOB-affinity columns: this
 * saver is the SOLE reader/writer of these tables on desktop, so a self-
 * consistent text encoding sidesteps any Uint8Array↔BLOB binary-fidelity risk
 * across the plugin-sql boundary. v<4 pending-sends migration is intentionally
 * omitted — this saver only ever writes current (v4+) checkpoints.
 */

// Derive the abstract method parameter types from the base class so the saver
// stays in lockstep with LangGraph without importing internal type names.
type GetTupleConfig = Parameters<BaseCheckpointSaver['getTuple']>[0];
type ListConfig = Parameters<BaseCheckpointSaver['list']>[0];
type ListOptions = Parameters<BaseCheckpointSaver['list']>[1];
type PutConfig = Parameters<BaseCheckpointSaver['put']>[0];
type PutCheckpoint = Parameters<BaseCheckpointSaver['put']>[1];
type PutMetadata = Parameters<BaseCheckpointSaver['put']>[2];
type PutVersions = Parameters<BaseCheckpointSaver['put']>[3];
type PutResult = Awaited<ReturnType<BaseCheckpointSaver['put']>>;
type PutWritesConfig = Parameters<BaseCheckpointSaver['putWrites']>[0];
type PutWrites = Parameters<BaseCheckpointSaver['putWrites']>[1];
type PendingWrite = NonNullable<CheckpointTuple['pendingWrites']>[number];

interface CheckpointRow {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  type: string | null;
  checkpoint: string | null;
  metadata: string | null;
}

interface WriteRow {
  task_id: string;
  channel: string;
  type: string | null;
  value: string | null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

class TauriCheckpointSaver extends BaseCheckpointSaver {
  constructor(private readonly db: TauriDrizzleDb) {
    super();
  }

  async getTuple(config: GetTupleConfig): Promise<CheckpointTuple | undefined> {
    const configurable = config.configurable ?? {};
    const threadId = configurable.thread_id as string | undefined;
    if (!threadId) return undefined;
    const checkpointNs = (configurable.checkpoint_ns as string | undefined) ?? '';
    const checkpointId = configurable.checkpoint_id as string | undefined;

    const conditions = [
      eq(schema.checkpoints.thread_id, threadId),
      eq(schema.checkpoints.checkpoint_ns, checkpointNs),
    ];
    if (checkpointId) conditions.push(eq(schema.checkpoints.checkpoint_id, checkpointId));
    const base = this.db
      .select()
      .from(schema.checkpoints)
      .where(and(...conditions));
    const rows = (
      checkpointId
        ? await base
        : await base.orderBy(desc(schema.checkpoints.checkpoint_id)).limit(1)
    ) as CheckpointRow[];
    const row = rows[0];
    if (!row) return undefined;

    const finalConfig = checkpointId
      ? config
      : {
          configurable: {
            thread_id: row.thread_id,
            checkpoint_ns: checkpointNs,
            checkpoint_id: row.checkpoint_id,
          },
        };
    return {
      checkpoint: (await this.deserialize(row.type, row.checkpoint)) as Checkpoint,
      config: finalConfig,
      metadata: (await this.deserialize(row.type, row.metadata)) as CheckpointMetadata | undefined,
      parentConfig: row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns: checkpointNs,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites: await this.loadPendingWrites(row.thread_id, checkpointNs, row.checkpoint_id),
    };
  }

  async *list(config: ListConfig, options?: ListOptions): AsyncGenerator<CheckpointTuple> {
    const configurable = config.configurable ?? {};
    const threadId = configurable.thread_id as string | undefined;
    const checkpointNs = configurable.checkpoint_ns as string | undefined;
    const beforeId = options?.before?.configurable?.checkpoint_id as string | undefined;

    const conditions = [];
    if (threadId) conditions.push(eq(schema.checkpoints.thread_id, threadId));
    if (checkpointNs !== undefined && checkpointNs !== null) {
      conditions.push(eq(schema.checkpoints.checkpoint_ns, checkpointNs));
    }
    if (beforeId) conditions.push(lt(schema.checkpoints.checkpoint_id, beforeId));

    const base = (
      conditions.length > 0
        ? this.db
            .select()
            .from(schema.checkpoints)
            .where(and(...conditions))
        : this.db.select().from(schema.checkpoints)
    ).orderBy(desc(schema.checkpoints.checkpoint_id));
    const rows = (options?.limit ? await base.limit(options.limit) : await base) as CheckpointRow[];

    for (const row of rows) {
      yield {
        config: {
          configurable: {
            thread_id: row.thread_id,
            checkpoint_ns: row.checkpoint_ns,
            checkpoint_id: row.checkpoint_id,
          },
        },
        checkpoint: (await this.deserialize(row.type, row.checkpoint)) as Checkpoint,
        metadata: (await this.deserialize(row.type, row.metadata)) as
          | CheckpointMetadata
          | undefined,
        parentConfig: row.parent_checkpoint_id
          ? {
              configurable: {
                thread_id: row.thread_id,
                checkpoint_ns: row.checkpoint_ns,
                checkpoint_id: row.parent_checkpoint_id,
              },
            }
          : undefined,
        pendingWrites: await this.loadPendingWrites(
          row.thread_id,
          row.checkpoint_ns,
          row.checkpoint_id,
        ),
      };
    }
  }

  async put(
    config: PutConfig,
    checkpoint: PutCheckpoint,
    metadata: PutMetadata,
    _newVersions: PutVersions,
  ): Promise<PutResult> {
    const configurable = config.configurable;
    if (!configurable) throw new Error('Empty configuration supplied to checkpoint put().');
    const threadId = configurable.thread_id as string | undefined;
    if (!threadId) throw new Error('Missing "thread_id" in config.configurable.');
    const checkpointNs = (configurable.checkpoint_ns as string | undefined) ?? '';
    const parentCheckpointId = (configurable.checkpoint_id as string | undefined) ?? null;

    const [type1, serializedCheckpoint] = await this.serde.dumpsTyped(checkpoint);
    const [type2, serializedMetadata] = await this.serde.dumpsTyped(metadata);
    if (type1 !== type2) {
      throw new Error('Checkpoint and metadata serialized to different serde types.');
    }
    const values = {
      thread_id: threadId,
      checkpoint_ns: checkpointNs,
      checkpoint_id: checkpoint.id,
      parent_checkpoint_id: parentCheckpointId,
      type: type1,
      checkpoint: toBase64(serializedCheckpoint),
      metadata: toBase64(serializedMetadata),
    };
    await this.db
      .insert(schema.checkpoints)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.checkpoints.thread_id,
          schema.checkpoints.checkpoint_ns,
          schema.checkpoints.checkpoint_id,
        ],
        set: {
          parent_checkpoint_id: values.parent_checkpoint_id,
          type: values.type,
          checkpoint: values.checkpoint,
          metadata: values.metadata,
        },
      });

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    } as PutResult;
  }

  async putWrites(config: PutWritesConfig, writes: PutWrites, taskId: string): Promise<void> {
    const configurable = config.configurable;
    if (!configurable) throw new Error('Empty configuration supplied to checkpoint putWrites().');
    const threadId = configurable.thread_id as string | undefined;
    if (!threadId) throw new Error('Missing "thread_id" in config.configurable.');
    const checkpointId = configurable.checkpoint_id as string | undefined;
    if (!checkpointId) throw new Error('Missing "checkpoint_id" in config.configurable.');
    const checkpointNs = (configurable.checkpoint_ns as string | undefined) ?? '';

    for (let idx = 0; idx < writes.length; idx += 1) {
      const write = writes[idx];
      if (!write) continue;
      const [type, serializedWrite] = await this.serde.dumpsTyped(write[1]);
      const values = {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
        task_id: taskId,
        idx,
        channel: write[0],
        type,
        value: toBase64(serializedWrite),
      };
      await this.db
        .insert(schema.writes)
        .values(values)
        .onConflictDoUpdate({
          target: [
            schema.writes.thread_id,
            schema.writes.checkpoint_ns,
            schema.writes.checkpoint_id,
            schema.writes.task_id,
            schema.writes.idx,
          ],
          set: { channel: values.channel, type: values.type, value: values.value },
        });
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.db.delete(schema.checkpoints).where(eq(schema.checkpoints.thread_id, threadId));
    await this.db.delete(schema.writes).where(eq(schema.writes.thread_id, threadId));
  }

  private async loadPendingWrites(
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): Promise<PendingWrite[]> {
    const rows = (await this.db
      .select()
      .from(schema.writes)
      .where(
        and(
          eq(schema.writes.thread_id, threadId),
          eq(schema.writes.checkpoint_ns, checkpointNs),
          eq(schema.writes.checkpoint_id, checkpointId),
        ),
      )
      .orderBy(schema.writes.idx)) as WriteRow[];
    const pending: PendingWrite[] = [];
    for (const row of rows) {
      pending.push([row.task_id, row.channel, await this.deserialize(row.type, row.value)]);
    }
    return pending;
  }

  private async deserialize(type: string | null, base64: string | null): Promise<unknown> {
    if (base64 == null) return undefined;
    return this.serde.loadsTyped(type ?? 'json', fromBase64(base64));
  }
}

/**
 * Build the desktop checkpoint saver, wrapped with `loadLatest` like the
 * SqliteSaver/MemorySaver factories. The SAME instance must feed both
 * `buildOffisimGraph({ checkpointer })` and `new OrchestrationService(...,
 * { checkpointSaver })` so reads and writes share one store.
 */
export function createTauriCheckpointSaver(): LoadLatestCheckpointSaver {
  return withLoadLatest(new TauriCheckpointSaver(createTauriDrizzleDb()));
}
