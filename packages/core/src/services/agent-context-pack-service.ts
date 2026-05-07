import type { AgentContextPack, InteractionRequest } from '@offisim/shared-types';
import type { NodeSummaryLike } from '../semantics/runtime-context-normalizers.js';
import {
  deriveRecommendedFocus,
  normalizeActiveTaskRuns,
  normalizeNodeSummaries,
  normalizePendingInteraction,
} from '../semantics/runtime-context-normalizers.js';

export interface AgentContextPackDeps {
  readonly threadId: string;
  readonly companyId: string;
  getPendingInteraction(): InteractionRequest | null;
  listNodeSummaries(
    threadId: string,
    opts: { limit: number },
  ): Promise<ReadonlyArray<NodeSummaryLike>>;
  listTaskRuns(threadId: string): Promise<
    ReadonlyArray<{
      task_run_id: string;
      employee_id: string | null;
      task_type: string;
      status: string;
    }>
  >;
}

export interface BuildPackOptions {
  preloadedSummaries?: ReadonlyArray<NodeSummaryLike>;
  threadId?: string;
}

export class AgentContextPackService {
  constructor(private readonly deps: AgentContextPackDeps) {}

  async buildPack(options?: BuildPackOptions): Promise<AgentContextPack> {
    const threadId = options?.threadId ?? this.deps.threadId;
    const { companyId } = this.deps;
    const pendingInteraction = normalizePendingInteraction(this.deps.getPendingInteraction());

    const summaryRows =
      options?.preloadedSummaries ?? (await this.deps.listNodeSummaries(threadId, { limit: 4 }));

    const taskRunRows = await this.deps.listTaskRuns(threadId);

    const recentNodeSummaries = normalizeNodeSummaries(summaryRows);
    const activeTaskRuns = normalizeActiveTaskRuns(taskRunRows);
    const recommendedFocus = deriveRecommendedFocus(
      pendingInteraction,
      activeTaskRuns,
      recentNodeSummaries,
    );

    return {
      thread: { threadId, companyId },
      pendingInteraction,
      activeTaskRuns,
      recentNodeSummaries,
      recommendedFocus,
    };
  }
}
