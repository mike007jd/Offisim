import type { HandoffInitiatedPayload, RuntimeEvent } from '@offisim/shared-types';
import { truncate } from '../../runtime-activity-formatters';
import type { ActivityEventBus, ActivityMapperSink } from '../activity-types';

export function subscribeHandoffMappers(
  eventBus: ActivityEventBus,
  sink: ActivityMapperSink,
): () => void {
  return eventBus.on('handoff.initiated', (event: RuntimeEvent<HandoffInitiatedPayload>) => {
    sink.push({
      id: `handoff-${event.payload.handoffId}`,
      kind: 'system',
      tone: 'info',
      label: truncate(`Handoff: ${event.payload.reason}`, 60),
      timestamp: event.timestamp,
    });
  });
}
