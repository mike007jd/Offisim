import type { EngineId } from '../models.js';

export type EngineActivityKind = 'run' | 'subagent' | 'tool' | 'artifact' | 'approval' | 'proposal';

export type EngineActivityStatus =
  | 'started'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'ready'
  | 'requested'
  | 'created';

export type EngineProposalKind =
  | 'split_step'
  | 'handoff'
  | 'replan'
  | 'permission'
  | 'publish_artifact';

export interface EngineProposalEventPayload {
  readonly proposalId: string;
  readonly engineId: EngineId;
  readonly kind: EngineProposalKind;
  readonly title: string;
  readonly description: string;
  readonly employeeId: string;
  readonly taskRunId?: string | null;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
}

export interface EngineActivityPayload {
  readonly runId: string;
  readonly engineId: EngineId;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly taskRunId?: string | null;
  readonly kind: EngineActivityKind;
  readonly status: EngineActivityStatus;
  readonly activityId?: string;
  readonly label?: string;
  readonly detail?: string;
  readonly proposalId?: string;
}

export interface EngineProposalCreatedPayload {
  readonly proposal: EngineProposalEventPayload;
}
