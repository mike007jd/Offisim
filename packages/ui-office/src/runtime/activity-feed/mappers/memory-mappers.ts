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
      label: `Auto memory saved a ${event.payload.scope} insight`,
      timestamp: event.timestamp,
      employeeId: event.payload.employeeId,
    });
  });
}
