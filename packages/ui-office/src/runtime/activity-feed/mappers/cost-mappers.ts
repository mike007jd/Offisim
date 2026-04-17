import type {
  HrRecommendationPayload,
  RuntimeEvent,
  SessionCostUpdatedPayload,
} from '@offisim/shared-types';
import type { ActivityEventBus, ActivityMapperSink } from '../activity-types';

export function subscribeCostMappers(
  eventBus: ActivityEventBus,
  sink: ActivityMapperSink,
): () => void {
  const offCost = eventBus.on(
    'cost.session.updated',
    (event: RuntimeEvent<SessionCostUpdatedPayload>) => {
      sink.setTotalCostUsd(event.payload.totalCostUsd);
    },
  );

  const offHr = eventBus.on('hr.recommendation', (event: RuntimeEvent<HrRecommendationPayload>) => {
    const roles = event.payload.suggestedRoles;
    sink.push({
      id: `hr-rec-${event.timestamp}`,
      kind: 'system',
      tone: 'info',
      label: roles.length > 0 ? `HR suggests: ${roles.join(', ')}` : 'HR assessment complete',
      timestamp: event.timestamp,
    });
  });

  return () => {
    offCost();
    offHr();
  };
}
