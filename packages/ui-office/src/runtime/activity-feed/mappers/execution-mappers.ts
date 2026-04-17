import type {
  ErrorOccurredPayload,
  ExecutionResumedPayload,
  RuntimeEvent,
} from '@offisim/shared-types';
import { humanizeNodeName } from '../../../lib/agent-display';
import type { ActivityEventBus, ActivityMapperSink } from '../activity-types';

export function subscribeExecutionMappers(
  eventBus: ActivityEventBus,
  sink: ActivityMapperSink,
): () => void {
  const offError = eventBus.on('error.occurred', (event: RuntimeEvent<ErrorOccurredPayload>) => {
    const payload = event.payload;
    const nodeName = payload.nodeName ?? 'unknown';
    const errorCode = payload.errorCode ?? 'error';
    const message = payload.message ?? `Error in ${humanizeNodeName(nodeName)}`;
    sink.setHeadline(`Error in ${humanizeNodeName(nodeName)}`);
    sink.push({
      id: `error-${event.timestamp}-${errorCode}`,
      kind: 'system',
      tone: 'error',
      label: message,
      timestamp: event.timestamp,
      employeeId: payload.employeeId,
    });
  });

  const offResume = eventBus.on(
    'execution.resumed',
    (event: RuntimeEvent<ExecutionResumedPayload>) => {
      sink.setHeadline('Resume restored');
      sink.push({
        id: `resume-${event.timestamp}`,
        kind: 'system',
        tone: 'info',
        label:
          event.payload.rewoundFromStepIndex != null
            ? `Checkpoint rewound to step ${event.payload.rewoundFromStepIndex + 1} and resumed`
            : `Checkpoint restored at step ${event.payload.currentStepIndex + 1}`,
        timestamp: event.timestamp,
      });
    },
  );

  return () => {
    offError();
    offResume();
  };
}
