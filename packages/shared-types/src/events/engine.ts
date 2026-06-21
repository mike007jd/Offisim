import type { EngineId, RuntimeEvidenceClass } from '../models.js';

type EngineNativeActivityKind =
  | 'mcp'
  | 'permission'
  | 'guardrail'
  | 'handoff'
  | 'session'
  | 'checkpoint'
  | 'rollback'
  | 'usage'
  | 'budget'
  | 'cancellation'
  | 'failure';

export type EngineActivityKind =
  | 'run'
  | 'tool'
  | 'artifact'
  | 'approval'
  | 'proposal'
  | EngineNativeActivityKind;

export type EngineActivityStatus =
  | 'started'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'ready'
  | 'requested'
  | 'created'
  | 'allowed'
  | 'denied'
  | 'blocked'
  | 'updated'
  | 'degraded'
  | 'exhausted'
  | 'pending'
  | 'rolled_back';

export type EngineProposalKind =
  | 'split_step'
  | 'handoff'
  | 'replan'
  | 'permission'
  | 'publish_artifact';

export interface EngineProposalEventPayload {
  readonly proposalId: string;
  readonly engineId: EngineId;
  readonly runtimeProfileId?: string;
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
  readonly runtimeProfileId?: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly taskRunId?: string | null;
  readonly kind: EngineActivityKind;
  readonly status: EngineActivityStatus;
  readonly activityId?: string;
  readonly label?: string;
  readonly detail?: string;
  readonly proposalId?: string;
  readonly toolName?: string;
  readonly toolType?: 'builtin' | 'mcp' | 'workstation' | 'runtime-profile';
  readonly evidenceClass?: RuntimeEvidenceClass;
}

export interface EngineProposalCreatedPayload {
  readonly proposal: EngineProposalEventPayload;
}
