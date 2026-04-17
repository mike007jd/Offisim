import type {
  InteractionModeChangedPayload,
  InteractionRequestedPayload,
  InteractionResolvedPayload,
  InteractionRestoredPayload,
  RuntimeEvent,
} from '@offisim/shared-types';
import {
  interactionRequestedLabel,
  interactionResolvedLabel,
  interactionRestoredLabel,
} from '../../runtime-activity-formatters';
import type { ActivityEventBus, ActivityMapperSink } from '../activity-types';

export function subscribeInteractionMappers(
  eventBus: ActivityEventBus,
  sink: ActivityMapperSink,
): () => void {
  const offRequested = eventBus.on(
    'interaction.requested',
    (event: RuntimeEvent<InteractionRequestedPayload>) => {
      const label = interactionRequestedLabel(event.payload.request.kind);
      sink.setHeadline(label);
      sink.push({
        id: `interaction-${event.payload.request.interactionId}`,
        kind: 'system',
        tone: event.payload.request.severity === 'high' ? 'warning' : 'info',
        label,
        timestamp: event.timestamp,
        employeeId: event.payload.request.employeeId,
      });
    },
  );

  const offResolved = eventBus.on(
    'interaction.resolved',
    (event: RuntimeEvent<InteractionResolvedPayload>) => {
      sink.push({
        id: `interaction-resolved-${event.payload.request.interactionId}`,
        kind: 'system',
        tone: 'success',
        label: interactionResolvedLabel(
          event.payload.request.kind,
          event.payload.response.selectedOptionId,
        ),
        timestamp: event.timestamp,
        employeeId: event.payload.request.employeeId,
      });
    },
  );

  const offRestored = eventBus.on(
    'interaction.restored',
    (event: RuntimeEvent<InteractionRestoredPayload>) => {
      const label = interactionRestoredLabel(event.payload.request.kind);
      sink.setHeadline(label);
      sink.push({
        id: `interaction-restored-${event.payload.request.interactionId}`,
        kind: 'system',
        tone: 'info',
        label,
        timestamp: event.timestamp,
        employeeId: event.payload.request.employeeId,
      });
    },
  );

  const offMode = eventBus.on(
    'interaction.mode.changed',
    (event: RuntimeEvent<InteractionModeChangedPayload>) => {
      sink.push({
        id: `interaction-mode-${event.timestamp}`,
        kind: 'system',
        tone: 'info',
        label: `Interaction mode: ${event.payload.nextMode.replaceAll('_', ' ')}`,
        timestamp: event.timestamp,
      });
    },
  );

  return () => {
    offRequested();
    offResolved();
    offRestored();
    offMode();
  };
}
