import type { DeliverableCreatedPayload, RuntimeEvent } from '@offisim/shared-types';
import {
  getDeliverableDisplayTitle,
  resolveDeliverableArtifact,
} from '../../../lib/deliverable-artifacts';
import { truncate } from '../../runtime-activity-formatters';
import type { ActivityEventBus, ActivityMapperSink } from '../activity-types';

export function subscribeDeliverableMappers(
  eventBus: ActivityEventBus,
  sink: ActivityMapperSink,
): () => void {
  return eventBus.on('deliverable.created', (event: RuntimeEvent<DeliverableCreatedPayload>) => {
    const payload = event.payload;
    const empCount = payload.contributingEmployees.length;
    const artifact = resolveDeliverableArtifact(payload);
    const title = truncate(getDeliverableDisplayTitle(payload.title, artifact), 50);
    sink.push({
      id: `deliverable-${payload.deliverableId}`,
      kind: 'system',
      tone: 'success',
      label:
        empCount > 0
          ? `Deliverable ready: "${title}" (${empCount} contributor${empCount === 1 ? '' : 's'})`
          : `Deliverable ready: "${title}"`,
      timestamp: event.timestamp,
    });
  });
}
