import type { InteractionKind, InteractionSeverity } from './interactions.js';

export interface AgentContextPackThread {
  readonly threadId: string;
  readonly companyId: string;
}

export interface AgentContextPackPendingInteraction {
  readonly kind: InteractionKind;
  readonly severity: InteractionSeverity;
  readonly title: string;
  readonly employeeId: string | null;
  readonly taskRunId: string | null;
}

export interface AgentContextPackTaskRun {
  readonly taskRunId: string;
  readonly employeeId: string | null;
  readonly taskType: string;
  readonly status: string;
}

export interface AgentContextPackNodeSummary {
  readonly nodeName: string;
  readonly employeeId: string | null;
  readonly stepIndex: number | null;
  readonly summaryText: string;
}

export interface AgentContextPack {
  readonly thread: AgentContextPackThread;
  readonly pendingInteraction: AgentContextPackPendingInteraction | null;
  readonly activeTaskRuns: readonly AgentContextPackTaskRun[];
  readonly recentNodeSummaries: readonly AgentContextPackNodeSummary[];
  readonly recommendedFocus: string | null;
}
