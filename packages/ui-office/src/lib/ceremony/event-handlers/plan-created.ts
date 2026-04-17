import type { RuntimeEvent } from '@offisim/shared-types';
import { truncate } from '../../format-time';
import type { CeremonyEventBus, CeremonyHandlerContext } from '../ceremony-handler-context';

export function subscribePlanCreated(
  eventBus: CeremonyEventBus,
  ctx: CeremonyHandlerContext,
): () => void {
  const { setCeremony } = ctx;

  const unsubPlan = eventBus.on('plan.created', (e: RuntimeEvent) => {
    const payload = e.payload as { summary?: string; steps?: Array<unknown> } | undefined;
    const stepCount = payload?.steps?.length ?? 0;
    const summary = payload?.summary;
    if (stepCount > 0) {
      const text = summary
        ? `${truncate(summary, 30)} (${stepCount} steps)`
        : `Planning: ${stepCount} step${stepCount > 1 ? 's' : ''}`;
      setCeremony((prev) => ({ ...prev, bubbleText: text }));
    }
  });

  return () => {
    unsubPlan();
  };
}
