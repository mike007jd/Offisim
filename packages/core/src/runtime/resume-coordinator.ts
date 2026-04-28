import type { RunnableConfig } from '@langchain/core/runnables';
import type { OffisimGraphState } from '../graph/state.js';

export interface ResumeSnapshot {
  state: OffisimGraphState;
  lastCheckpointTs: number;
}

export interface LatestCheckpointSaver {
  loadLatest?(conversationId: string): Promise<ResumeSnapshot | null>;
  getTuple?(config: RunnableConfig): Promise<CheckpointTuple | undefined>;
}

interface CheckpointTuple {
  checkpoint: unknown;
  config?: RunnableConfig;
  metadata?: unknown;
}

function parseCheckpointTs(tuple: CheckpointTuple): number {
  const checkpoint = tuple.checkpoint as { ts?: unknown };
  const metadata = tuple.metadata as { updated_at?: unknown; created_at?: unknown } | undefined;
  const raw = checkpoint.ts ?? metadata?.updated_at ?? metadata?.created_at;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== 'string' || raw.length === 0) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tupleToResumeSnapshot(tuple: CheckpointTuple): ResumeSnapshot | null {
  const checkpoint = tuple.checkpoint as { channel_values?: unknown };
  const state = checkpoint.channel_values as OffisimGraphState | undefined;
  if (!state) return null;
  return {
    state,
    lastCheckpointTs: parseCheckpointTs(tuple),
  };
}

export class ResumeCoordinator {
  private readonly saver: LatestCheckpointSaver;

  constructor(saver: LatestCheckpointSaver) {
    this.saver = saver;
  }

  async resume(conversationId: string): Promise<ResumeSnapshot | null> {
    if (this.saver.loadLatest) {
      return this.saver.loadLatest(conversationId);
    }
    if (!this.saver.getTuple) {
      return null;
    }
    const tuple = await this.saver.getTuple({
      configurable: { thread_id: conversationId },
    });
    return tuple ? tupleToResumeSnapshot(tuple) : null;
  }
}
