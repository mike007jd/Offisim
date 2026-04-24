import type {
  EngineActivityPayload,
  EngineProposalCreatedPayload,
  RuntimeEvent,
} from '@offisim/shared-types';
import { truncate } from '../../runtime-activity-formatters';
import type { ActivityEventBus, ActivityMapperSink, RuntimeActivityTone } from '../activity-types';

function toneForActivity(payload: EngineActivityPayload): RuntimeActivityTone {
  if (payload.status === 'failed') return 'error';
  if (payload.status === 'cancelled' || payload.status === 'requested') return 'warning';
  if (payload.status === 'completed' || payload.status === 'ready') return 'success';
  return 'info';
}

function labelForActivity(payload: EngineActivityPayload): string {
  const label = payload.label ? truncate(payload.label, 44) : 'runtime activity';
  switch (payload.kind) {
    case 'run':
      return `${payload.employeeName}: engine ${payload.status}`;
    case 'subagent':
      return `${payload.employeeName}: internal ${label} ${payload.status}`;
    case 'artifact':
      return `${payload.employeeName}: artifact ready`;
    case 'approval':
      return `${payload.employeeName}: approval requested`;
    case 'proposal':
      return `${payload.employeeName}: proposal ${label}`;
    case 'tool':
      return `${payload.employeeName}: engine tool ${payload.status}`;
    default:
      return `${payload.employeeName}: ${label}`;
  }
}

export function subscribeEngineMappers(
  eventBus: ActivityEventBus,
  sink: ActivityMapperSink,
): () => void {
  const offActivity = eventBus.on(
    'engine.activity',
    (event: RuntimeEvent<EngineActivityPayload>) => {
      const payload = event.payload;
      sink.push({
        id: `engine-${payload.runId}-${payload.kind}-${payload.activityId ?? payload.proposalId ?? event.timestamp}`,
        kind: 'engine',
        tone: toneForActivity(payload),
        label: labelForActivity(payload),
        timestamp: event.timestamp,
        employeeId: payload.employeeId,
        burstKey: `${payload.engineId}:${payload.kind}:${payload.status}`,
        burstCount: 1,
      });
    },
  );

  const offProposal = eventBus.on(
    'engine.proposal.created',
    (event: RuntimeEvent<EngineProposalCreatedPayload>) => {
      const proposal = event.payload.proposal;
      sink.push({
        id: `engine-proposal-${proposal.proposalId}`,
        kind: 'engine',
        tone: 'warning',
        label: `Engine proposal: ${truncate(proposal.title, 48)}`,
        timestamp: event.timestamp,
        employeeId: proposal.employeeId,
        burstKey: `${proposal.engineId}:proposal`,
        burstCount: 1,
      });
    },
  );

  return () => {
    offActivity();
    offProposal();
  };
}
