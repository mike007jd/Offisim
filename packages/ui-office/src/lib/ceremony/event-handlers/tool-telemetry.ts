import type { RuntimeEvent, ToolExecutionTelemetryPayload } from '@offisim/shared-types';
import { getObstacleFootprints } from '../../../hooks/scene-orchestrator-positions';
import { getMovementHandles } from '../../../runtime/movement-handle-registry';
import { describeWorkingToolActivity } from '../../ceremony-descriptions';
import { buildWorkActivityTarget } from '../../scene-behavior';
import { categorizeTool } from '../../tool-category';
import type { CeremonyEventBus, CeremonyHandlerContext } from '../ceremony-handler-context';

export function subscribeToolTelemetry(
  eventBus: CeremonyEventBus,
  ctx: CeremonyHandlerContext,
): () => void {
  const { assignedWorkPositionsRef, companyIdRef, registryRef, setCeremony, clearSceneBubbleText } =
    ctx;

  const unsubTool = eventBus.on(
    'tool.execution.telemetry',
    (e: RuntimeEvent<ToolExecutionTelemetryPayload>) => {
      const label = describeWorkingToolActivity(e.payload);
      if (!label) return;
      const employeeId = e.payload.employeeId;
      const basePosition = employeeId ? assignedWorkPositionsRef.current.get(employeeId) : null;
      const handle = employeeId ? getMovementHandles(companyIdRef.current).get(employeeId) : null;
      setCeremony((prev) => {
        if (prev.phase !== 'working' || prev.bubbleText === label) return prev;
        return { ...prev, bubbleText: label };
      });

      if (basePosition && handle) {
        const obstacleFootprints = getObstacleFootprints(registryRef.current);
        if (e.payload.status === 'started') {
          handle.moveTo(
            buildWorkActivityTarget(basePosition, categorizeTool(e.payload), obstacleFootprints),
            2.8,
          );
        } else {
          handle.moveTo(basePosition, 2.4);
        }
      }

      if (e.payload.status !== 'started') {
        clearSceneBubbleText(label, 900);
      }
    },
  );

  return () => {
    unsubTool();
  };
}
