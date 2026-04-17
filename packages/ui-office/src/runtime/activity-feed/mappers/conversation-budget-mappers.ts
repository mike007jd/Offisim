import type {
  ConversationCompactCompletedPayload,
  ConversationSynopsisUpdatedPayload,
  RuntimeEvent,
} from '@offisim/shared-types';
import type { ActivityEventBus, ActivityMapperSink } from '../activity-types';

export function subscribeConversationBudgetMappers(
  eventBus: ActivityEventBus,
  sink: ActivityMapperSink,
): () => void {
  const offSynopsis = eventBus.on(
    'conversation.synopsis.updated',
    (event: RuntimeEvent<ConversationSynopsisUpdatedPayload>) => {
      sink.setHeadline('Context window is filling up');
      sink.push({
        id: `synopsis-${event.payload.version}`,
        kind: 'system',
        tone: 'info',
        label: 'Auto-compact is preserving the latest turn',
        timestamp: event.timestamp,
      });
    },
  );

  const offCompact = eventBus.on(
    'conversation.compact.completed',
    (event: RuntimeEvent<ConversationCompactCompletedPayload>) => {
      sink.setHeadline('Context compacted');
      sink.push({
        id: `compact-${event.payload.compactId}`,
        kind: 'system',
        tone: 'success',
        label: `Summarized earlier turns and kept the latest ${event.payload.keptTailNonSystemMessageCount} messages live`,
        timestamp: event.timestamp,
      });
    },
  );

  return () => {
    offSynopsis();
    offCompact();
  };
}
