import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type {
  GraphCheckpointRow,
  GraphThreadRow,
  HandoffEventRow,
  LlmCallRow,
  RuntimeEventRow,
  RuntimeRepositories,
  TaskRunRow,
} from '../runtime/repositories.js';
import type { ThreadSynopsisRecord } from './conversation-budget-service.js';

export interface ExecutionTrace {
  thread: GraphThreadRow;
  synopsis: ThreadSynopsisRecord | null;
  taskRuns: TaskRunRow[];
  handoffs: HandoffEventRow[];
  llmCalls: LlmCallRow[];
  checkpoints: GraphCheckpointRow[];
  events: RuntimeEventRow[];
}

export interface ExecutionTraceService {
  getTrace(threadId: string): Promise<ExecutionTrace | null>;
  getStateAt(threadId: string, checkpointId: string): Promise<Record<string, unknown> | null>;
  listThreads(
    companyId: string,
    opts?: { limit?: number; status?: string },
  ): Promise<GraphThreadRow[]>;
}

export class ExecutionTraceServiceImpl implements ExecutionTraceService {
  constructor(
    private repos: RuntimeRepositories,
    private checkpointSaver: BaseCheckpointSaver,
  ) {}

  async getTrace(threadId: string): Promise<ExecutionTrace | null> {
    const thread = await this.repos.threads.findById(threadId);
    if (!thread) return null;

    const [taskRuns, handoffs, llmCalls, events] = await Promise.all([
      this.repos.taskRuns.findByThread(threadId),
      this.repos.handoffs.findByThread(threadId),
      this.repos.llmCalls.findByThread(threadId),
      this.repos.events.findByThread(threadId),
    ]);

    // Checkpoints and events: reserved for Phase 3 business snapshots.
    // LangGraph checkpoint state is queried via getStateAt(), not here.
    const checkpoints: GraphCheckpointRow[] = [];
    const synopsis = this.parseSynopsis(thread.synopsis_json);

    return {
      thread,
      synopsis,
      taskRuns: taskRuns.sort((a, b) => a.started_at.localeCompare(b.started_at)),
      handoffs: handoffs.sort((a, b) => a.created_at.localeCompare(b.created_at)),
      llmCalls: llmCalls.sort((a, b) => a.created_at.localeCompare(b.created_at)),
      checkpoints,
      events: events.sort((a, b) => a.created_at.localeCompare(b.created_at)),
    };
  }

  async getStateAt(
    threadId: string,
    checkpointId: string,
  ): Promise<Record<string, unknown> | null> {
    const tuple = await this.checkpointSaver.getTuple({
      configurable: { thread_id: threadId, checkpoint_id: checkpointId },
    });
    if (!tuple) return null;

    return tuple.checkpoint.channel_values as Record<string, unknown>;
  }

  async listThreads(
    companyId: string,
    opts?: { limit?: number; status?: string },
  ): Promise<GraphThreadRow[]> {
    return this.repos.threads.findByCompany(companyId, opts);
  }

  private parseSynopsis(value: string | null): ThreadSynopsisRecord | null {
    if (!value) return null;
    try {
      return JSON.parse(value) as ThreadSynopsisRecord;
    } catch {
      return null;
    }
  }
}
