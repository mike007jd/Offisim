import type {
  InteractionModeChangedPayload,
  InteractionRequestedPayload,
  InteractionResolvedPayload,
  InteractionRestoredPayload,
  RuntimeEvent,
  SkillInstallOutcomePayload,
} from '@offisim/shared-types';
import { SKILL_INSTALL_OUTCOME, skillInstallOutcomeLabel } from '@offisim/shared-types';
import {
  interactionRequestedLabel,
  interactionResolvedLabel,
  interactionRestoredLabel,
} from '../../runtime-activity-formatters';
import type { ActivityEventBus, ActivityMapperSink, RuntimeActivityTone } from '../activity-types';

const SKILL_OUTCOME_TONE: Record<SkillInstallOutcomePayload['kind'], RuntimeActivityTone> = {
  installed: 'success',
  created: 'success',
  edited: 'success',
  cancelled: 'info',
  'staging-expired': 'warning',
  error: 'warning',
};

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
      // skill_install_confirm has its own outcome-driven path via
      // `skill.install.outcome` — skip here to avoid double-logging.
      if (event.payload.request.kind === 'skill_install_confirm') return;
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

  const offSkillOutcome = eventBus.on(
    SKILL_INSTALL_OUTCOME,
    (event: RuntimeEvent<SkillInstallOutcomePayload>) => {
      const payload = event.payload;
      sink.push({
        id: `skill-outcome-${payload.interactionId}`,
        kind: 'system',
        tone: SKILL_OUTCOME_TONE[payload.kind],
        label: skillInstallOutcomeLabel(payload),
        timestamp: event.timestamp,
        employeeId: payload.employeeId ?? null,
        burstKey: `skill:${payload.employeeId ?? 'global'}`,
        burstCount: 1,
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
    offSkillOutcome();
    offRestored();
    offMode();
  };
}
