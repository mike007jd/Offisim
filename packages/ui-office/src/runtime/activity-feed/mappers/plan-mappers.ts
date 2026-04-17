import type {
  PlanCreatedPayload,
  PlanStepCompletedPayload,
  RuntimeEvent,
} from '@offisim/shared-types';
import { truncate } from '../../runtime-activity-formatters';
import type { ActivityEventBus, ActivityMapperSink } from '../activity-types';

export function subscribePlanMappers(
  eventBus: ActivityEventBus,
  sink: ActivityMapperSink,
): () => void {
  const offPlan = eventBus.on('plan.created', (event: RuntimeEvent<PlanCreatedPayload>) => {
    const stepCount = event.payload.steps.length;
    const label = event.payload.summary
      ? `Plan ready: ${truncate(event.payload.summary, 44)}`
      : `Plan ready with ${stepCount} steps`;
    sink.setHeadline(label);
    sink.push({
      id: `plan-${event.payload.planId}`,
      kind: 'plan',
      tone: 'info',
      label: `PM created ${stepCount} step${stepCount === 1 ? '' : 's'}`,
      timestamp: event.timestamp,
    });
  });

  const offStep = eventBus.on(
    'plan.step.completed',
    (event: RuntimeEvent<PlanStepCompletedPayload>) => {
      const payload = event.payload;
      sink.push({
        id: `plan-step-${payload.planId}-${payload.stepIndex}`,
        kind: 'plan',
        tone: 'success',
        label: `Step ${payload.stepIndex + 1} completed (${payload.outputCount} output${payload.outputCount === 1 ? '' : 's'})`,
        timestamp: event.timestamp,
      });
    },
  );

  return () => {
    offPlan();
    offStep();
  };
}
