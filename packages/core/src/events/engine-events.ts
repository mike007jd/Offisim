import type {
  EngineActivityPayload,
  EngineProposalCreatedPayload,
  RuntimeEvent,
} from '@offisim/shared-types';

export function engineActivity(
  companyId: string,
  threadId: string,
  payload: EngineActivityPayload,
): RuntimeEvent<EngineActivityPayload> {
  return {
    type: 'engine.activity',
    entityId: payload.activityId ?? payload.runId,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload,
  };
}

export function engineProposalCreated(
  companyId: string,
  threadId: string,
  payload: EngineProposalCreatedPayload,
): RuntimeEvent<EngineProposalCreatedPayload> {
  return {
    type: 'engine.proposal.created',
    entityId: payload.proposal.proposalId,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload,
  };
}
