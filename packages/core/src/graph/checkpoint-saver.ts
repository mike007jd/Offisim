import {
  BaseCheckpointSaver,
  MemorySaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
} from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';

type ChannelVersions = Record<string, number | string>;
type CheckpointListOptions = {
  limit?: number;
  before?: RunnableConfig;
  filter?: Record<string, unknown>;
};

/**
 * Factory for checkpoint savers.
 * With `db`: returns DrizzleCheckpointSaver (production).
 * Without `db`: returns MemorySaver (testing).
 */
export function createCheckpointSaver(db?: unknown): BaseCheckpointSaver {
  if (db) {
    return new DrizzleCheckpointSaver(db);
  }
  return new MemorySaver();
}

/**
 * Drizzle-backed checkpoint saver bridging LangGraph's checkpoint API.
 *
 * Phase 2.1: In-memory storage implementing the full BaseCheckpointSaver interface.
 * Full Drizzle persistence against `graph_checkpoints` table will be added when
 * the checkpoint serialization format is finalized.
 */
export class DrizzleCheckpointSaver extends BaseCheckpointSaver {
  private storage = new Map<string, Array<{
    checkpoint: Checkpoint;
    metadata: CheckpointMetadata;
    config: RunnableConfig;
    parentConfig?: RunnableConfig;
    pendingWrites: Array<[string, string, unknown]>;
  }>>();

  constructor(_db: unknown) {
    super();
  }

  private getThreadId(config: RunnableConfig): string {
    return (config.configurable?.thread_id as string) ?? '';
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = this.getThreadId(config);
    const entries = this.storage.get(threadId);
    if (!entries || entries.length === 0) return undefined;

    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    const entry = checkpointId
      ? entries.find(e => e.checkpoint.id === checkpointId)
      : entries[entries.length - 1];

    if (!entry) return undefined;

    return {
      checkpoint: entry.checkpoint,
      metadata: entry.metadata,
      config: entry.config,
      parentConfig: entry.parentConfig,
      pendingWrites: entry.pendingWrites,
    };
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = this.getThreadId(config);
    const entries = this.storage.get(threadId) ?? [];
    const limit = options?.limit ?? entries.length;

    const sorted = [...entries].reverse();
    let count = 0;

    for (const entry of sorted) {
      if (count >= limit) break;
      yield {
        checkpoint: entry.checkpoint,
        metadata: entry.metadata,
        config: entry.config,
        parentConfig: entry.parentConfig,
        pendingWrites: entry.pendingWrites,
      };
      count++;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const threadId = this.getThreadId(config);

    if (!this.storage.has(threadId)) {
      this.storage.set(threadId, []);
    }

    const newConfig: RunnableConfig = {
      configurable: {
        ...config.configurable,
        checkpoint_id: checkpoint.id,
      },
    };

    const entries = this.storage.get(threadId)!;
    const parentConfig = entries.length > 0
      ? entries[entries.length - 1]!.config
      : undefined;

    entries.push({
      checkpoint,
      metadata,
      config: newConfig,
      parentConfig,
      pendingWrites: [],
    });

    return newConfig;
  }

  async putWrites(
    config: RunnableConfig,
    writes: [string, unknown][],
    taskId: string,
  ): Promise<void> {
    const threadId = this.getThreadId(config);
    const entries = this.storage.get(threadId);
    if (!entries || entries.length === 0) return;

    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    const entry = checkpointId
      ? entries.find(e => e.checkpoint.id === checkpointId)
      : entries[entries.length - 1];

    if (entry) {
      for (const [channel, value] of writes) {
        entry.pendingWrites.push([taskId, channel, value]);
      }
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this.storage.delete(threadId);
  }
}
