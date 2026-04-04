import type { AgentContextPack, InteractionRequest } from '@offisim/shared-types';
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
  ): Promise<
    ReadonlyArray<{
      node_name: string;
      employee_id: string | null;
      step_index: number | null;
      summary_text: string;
    }>
  >;
  listTaskRuns(
    threadId: string,
  ): Promise<
    ReadonlyArray<{
      task_run_id: string;
      employee_id: string | null;
      task_type: string;
      status: string;
    }>
  >;
}

export class AgentContextPackService {
  constructor(private readonly deps: AgentContextPackDeps) {}

  async buildPack(): Promise<AgentContextPack> {
    const { threadId, companyId } = this.deps;
    const pendingInteraction = normalizePendingInteraction(
      this.deps.getPendingInteraction(),
    );

    const [summaryRows, taskRunRows] = await Promise.all([
      this.deps.listNodeSummaries(threadId, { limit: 4 }),
      this.deps.listTaskRuns(threadId),
    ]);

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
