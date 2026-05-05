import type { MemoryCreatedPayload, RuntimeEvent } from '@offisim/shared-types';
import type { ActivityEventBus, ActivityMapperSink } from '../activity-types';

export function subscribeMemoryMappers(
  eventBus: ActivityEventBus,
  sink: ActivityMapperSink,
): () => void {
  return eventBus.on('memory.created', (event: RuntimeEvent<MemoryCreatedPayload>) => {
    sink.push({
      id: `memory-${event.payload.memoryId}`,
      kind: 'system',
      tone: 'success',
      label: `Memory saved: ${event.payload.scope} ${event.payload.category}`,
      timestamp: event.timestamp,
      employeeId: event.payload.employeeId,
      burstKey: `memory:${event.payload.scope}:${event.payload.employeeId}`,
      burstCount: 1,
    });
  });
}
