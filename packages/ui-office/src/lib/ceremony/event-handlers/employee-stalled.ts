import type { EmployeeStatePayload, RuntimeEvent } from '@offisim/shared-types';
import { getObstacleFootprints } from '../../../hooks/scene-orchestrator-positions';
import { getMovementHandles } from '../../../runtime/movement-handle-registry';
import type { SceneEmployeeEscalatedPayload } from '../../../runtime/scene-intents';
import { describeEmployeeEscalation } from '../../ceremony-descriptions';
import { buildStalledWorkTarget } from '../../scene-behavior';
import type { CeremonyEventBus, CeremonyHandlerContext } from '../ceremony-handler-context';

export function subscribeEmployeeStalled(
  eventBus: CeremonyEventBus,
  ctx: CeremonyHandlerContext,
): () => void {
  const {
    sceneIntentBus,
    agentsRef,
    companyIdRef,
    registryRef,
    assignedWorkPositionsRef,
    approvalHoldPositionsRef,
    clarificationHoldPositionsRef,
    setCeremony,
    clearSceneBubbleText,
  } = ctx;

  const handleEmployeeEscalated = (payload: SceneEmployeeEscalatedPayload) => {
    const { employeeId, next } = payload;
    if (
      approvalHoldPositionsRef.current.has(employeeId) ||
      clarificationHoldPositionsRef.current.has(employeeId)
    ) {
      return;
    }

    const basePosition = assignedWorkPositionsRef.current.get(employeeId);
    const handle = getMovementHandles(companyIdRef.current).get(employeeId);
    const employeeName = agentsRef.current.get(employeeId)?.name ?? 'A teammate';
    const label = describeEmployeeEscalation(employeeName, next);
    setCeremony((prev) => {
      if (prev.bubbleText === label) return prev;
      return { ...prev, bubbleText: label };
    });

    if (basePosition && handle) {
      handle.moveTo(
        buildStalledWorkTarget(basePosition, next, getObstacleFootprints(registryRef.current)),
        2.2,
      );
    }

    clearSceneBubbleText(label, 1400);
  };

  const unsubEscalated = sceneIntentBus
    ? sceneIntentBus.on('scene.employee.escalated', (intent) => {
        handleEmployeeEscalated(intent.payload as SceneEmployeeEscalatedPayload);
      })
    : eventBus.on('employee.state.changed', (e: RuntimeEvent<EmployeeStatePayload>) => {
        if (e.payload.next !== 'blocked' && e.payload.next !== 'failed') return;
        handleEmployeeEscalated({
          employeeId: e.payload.employeeId,
          next: e.payload.next,
        });
      });

  return () => {
    unsubEscalated();
  };
}
