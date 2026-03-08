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
 * Phase 2.0 checkpoint saver — delegates to MemorySaver.
 *
 * This wrapper exists so callers depend on our factory function
 * rather than importing MemorySaver directly. When we add a
 * Drizzle-backed saver (backed by `graph_checkpoints` table),
 * this is the only place that changes.
 */
export function createCheckpointSaver(): BaseCheckpointSaver {
  return new MemorySaver();
}

/**
 * Drizzle-backed checkpoint saver stub for future implementation.
 * Will bridge LangGraph checkpoint API to the `graph_checkpoints` table.
 */
export class DrizzleCheckpointSaver extends BaseCheckpointSaver {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor() {
    super();
  }

  async getTuple(_config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    throw new Error('DrizzleCheckpointSaver not yet implemented');
  }

  async *list(
    _config: RunnableConfig,
    _options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    throw new Error('DrizzleCheckpointSaver not yet implemented');
  }

  async put(
    _config: RunnableConfig,
    _checkpoint: Checkpoint,
    _metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    throw new Error('DrizzleCheckpointSaver not yet implemented');
  }

  async putWrites(
    _config: RunnableConfig,
    _writes: [string, unknown][],
    _taskId: string,
  ): Promise<void> {
    throw new Error('DrizzleCheckpointSaver not yet implemented');
  }

  async deleteThread(_threadId: string): Promise<void> {
    throw new Error('DrizzleCheckpointSaver not yet implemented');
  }
}
