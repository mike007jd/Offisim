import type { RuntimeEvent, TaskAssignmentDispatchedPayload } from '@offisim/shared-types';
import type { SceneTaskDispatchedPayload } from '../../../runtime/scene-intents';
import { truncate } from '../../format-time';
import type { CeremonyEventBus, CeremonyHandlerContext } from '../ceremony-handler-context';
import { moveEmployeeToRest } from '../ceremony-movement';

export function subscribeTaskDispatch(
  eventBus: CeremonyEventBus,
  ctx: CeremonyHandlerContext,
): () => void {
  const {
    sceneIntentBus,
    agentsRef,
    ceremonyVersionRef,
    companyIdRef,
    zonesRef,
    registryRef,
    assignedWorkPositionsRef,
    assignedWorkZoneIdsRef,
    safeTimeout,
    setCeremony,
    dispatchEmployee,
  } = ctx;
  const movementRefs = {
    companyIdRef,
    zonesRef,
    registryRef,
    assignedWorkPositionsRef,
    assignedWorkZoneIdsRef,
  };

  const handleDispatched = (payload: SceneTaskDispatchedPayload) => {
    const { employeeId, employeeName, stepLabel, stepIndex, totalSteps } = payload;
    const agent = agentsRef.current.get(employeeId);
    const role = agent?.role ?? 'developer';

    setCeremony((prev) => ({
      ...prev,
      bubbleText: `→ ${employeeName}: ${truncate(stepLabel, 30)}`,
    }));

    dispatchEmployee(employeeId, role, ceremonyVersionRef.current);

    if (stepIndex === totalSteps - 1) {
      safeTimeout(() => {
        const undispatchedIds: string[] = [];
        setCeremony((prev) => {
          if (prev.phase !== 'dispatching') return prev;
          const allIds = new Set(agentsRef.current.keys());
          for (const id of allIds) {
            if (!prev.dispatchedIds.has(id)) {
              undispatchedIds.push(id);
            }
          }
          return {
            ...prev,
            phase: 'working',
            bubbleText: '',
            managerVisible: false,
            managerPosition: null,
          };
        });
        for (const dismissedId of undispatchedIds) {
          moveEmployeeToRest(dismissedId, 4, movementRefs);
        }
      }, 1000);
    }
  };

  const unsubDispatch = sceneIntentBus
    ? sceneIntentBus.on('scene.task.dispatched', (intent) => {
        handleDispatched(intent.payload as SceneTaskDispatchedPayload);
      })
    : eventBus.on(
        'task.assignment.dispatched',
        (e: RuntimeEvent<TaskAssignmentDispatchedPayload>) => {
          if (!e.payload.employeeId) return;
          handleDispatched({
            employeeId: e.payload.employeeId,
            employeeName: e.payload.employeeName,
            stepLabel: e.payload.stepLabel,
            stepIndex: e.payload.stepIndex,
            totalSteps: e.payload.totalSteps,
          });
        },
      );

  return () => {
    unsubDispatch();
  };
}
