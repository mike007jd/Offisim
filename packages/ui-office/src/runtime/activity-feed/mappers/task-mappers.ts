import type { RuntimeEvent, TaskAssignmentDispatchedPayload } from '@offisim/shared-types';
import { truncate } from '../../runtime-activity-formatters';
import type { ActivityEventBus, ActivityMapperSink } from '../activity-types';

export function subscribeTaskMappers(
  eventBus: ActivityEventBus,
  sink: ActivityMapperSink,
): () => void {
  const offDispatch = eventBus.on(
    'task.assignment.dispatched',
    (event: RuntimeEvent<TaskAssignmentDispatchedPayload>) => {
      const payload = event.payload;
      sink.push({
        id: `dispatch-${event.timestamp}-${payload.assigneeId}-${payload.stepIndex}`,
        kind: 'dispatch',
        tone: 'info',
        label: `${payload.assigneeName} took step ${payload.stepIndex + 1}: ${truncate(payload.stepLabel, 34)}`,
        timestamp: event.timestamp,
        employeeId: payload.employeeId,
      });
    },
  );
  return offDispatch;
}
