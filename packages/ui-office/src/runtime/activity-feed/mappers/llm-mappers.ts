import type {
  LlmCallCompletedPayload,
  LlmCallStartedPayload,
  RuntimeEvent,
} from '@offisim/shared-types';
import { humanizeNodeName } from '../../../lib/agent-display';
import { formatLlmDuration, llmStartedHeadline } from '../../runtime-activity-formatters';
import type { ActivityEventBus, ActivityMapperSink } from '../activity-types';

export function subscribeLlmMappers(
  eventBus: ActivityEventBus,
  sink: ActivityMapperSink,
): () => void {
  const offStarted = eventBus.on(
    'llm.call.started',
    (event: RuntimeEvent<LlmCallStartedPayload>) => {
      const payload = event.payload;
      sink.trackLlmStart(payload);
      sink.setHeadline(llmStartedHeadline(payload.nodeName, payload.model));
      sink.push({
        id: `llm-${payload.llmCallId}-started`,
        kind: 'llm',
        tone: 'info',
        label: `${humanizeNodeName(payload.nodeName)} started ${payload.model}`,
        timestamp: event.timestamp,
      });
    },
  );

  const offCompleted = eventBus.on(
    'llm.call.completed',
    (event: RuntimeEvent<LlmCallCompletedPayload>) => {
      const payload = event.payload;
      const modelLabel = sink.readActiveLlmModel(payload.llmCallId);
      sink.trackLlmEnd(payload.llmCallId);
      sink.push({
        id: `llm-${payload.llmCallId}-completed`,
        kind: 'llm',
        tone: 'success',
        label: `${humanizeNodeName(payload.nodeName)} completed ${modelLabel ?? 'call'} in ${formatLlmDuration(payload.latencyMs)}`,
        timestamp: event.timestamp,
      });
    },
  );

  return () => {
    offStarted();
    offCompleted();
  };
}
