import type {
  RuntimeRepositories, GraphThreadRow, TaskRunRow,
  HandoffEventRow, LlmCallRow, GraphCheckpointRow, RuntimeEventRow,
} from '../runtime/repositories.js';

export interface ExecutionTrace {
  thread: GraphThreadRow;
  taskRuns: TaskRunRow[];
  handoffs: HandoffEventRow[];
  llmCalls: LlmCallRow[];
  checkpoints: GraphCheckpointRow[];
  events: RuntimeEventRow[];
}

export interface ExecutionTraceService {
  getTrace(threadId: string): Promise<ExecutionTrace | null>;
  getStateAt(threadId: string, checkpointSeq: number): Promise<Record<string, unknown> | null>;
  listThreads(companyId: string, opts?: { limit?: number; status?: string }): Promise<GraphThreadRow[]>;
}

export class ExecutionTraceServiceImpl implements ExecutionTraceService {
  constructor(private repos: RuntimeRepositories) {}

  async getTrace(threadId: string): Promise<ExecutionTrace | null> {
    const thread = await this.repos.threads.findById(threadId);
    if (!thread) return null;

    const [taskRuns, handoffs, llmCalls] = await Promise.all([
      this.repos.taskRuns.findByThread(threadId),
      this.repos.handoffs.findByThread(threadId),
      this.repos.llmCalls.findByThread(threadId),
    ]);

    // Checkpoints and events require thread-level queries not yet on all repo interfaces.
    // For now, return empty arrays — these will be populated when the repos are extended.
    const checkpoints: GraphCheckpointRow[] = [];
    const events: RuntimeEventRow[] = [];

    return {
      thread,
      taskRuns: taskRuns.sort((a, b) => a.started_at.localeCompare(b.started_at)),
      handoffs: handoffs.sort((a, b) => a.created_at.localeCompare(b.created_at)),
      llmCalls: llmCalls.sort((a, b) => a.created_at.localeCompare(b.created_at)),
      checkpoints,
      events,
    };
  }

  async getStateAt(threadId: string, checkpointSeq: number): Promise<Record<string, unknown> | null> {
    const checkpoint = await this.repos.checkpoints.findBySeq(threadId, checkpointSeq);
    if (!checkpoint) return null;

    try {
      return JSON.parse(checkpoint.payload_json) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async listThreads(companyId: string, opts?: { limit?: number; status?: string }): Promise<GraphThreadRow[]> {
    return this.repos.threads.findByCompany(companyId, opts);
  }
}
