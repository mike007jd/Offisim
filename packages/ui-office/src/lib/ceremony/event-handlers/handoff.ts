import {
  type HandoffCompletedPayload,
  type HandoffInitiatedPayload,
  type RoleSlug,
  type RuntimeEvent,
  resolveZoneForRole,
} from '@offisim/shared-types';
import {
  getObstacleFootprints,
  getZoneCenter,
  getZoneCenterById,
  resolveZoneIdForPosition,
} from '../../../hooks/scene-orchestrator-positions';
import { getMovementHandles } from '../../../runtime/movement-handle-registry';
import type {
  SceneHandoffCompletedPayload,
  SceneHandoffInitiatedPayload,
} from '../../../runtime/scene-intents';
import { addWaitingRelationship, removeWaitingRelationship } from '../../ceremony-visuals';
import { buildHandoffRoute, moveThroughPoints } from '../../scene-behavior';
import type { CeremonyEventBus, CeremonyHandlerContext } from '../ceremony-handler-context';
import { moveEmployeeAlongTransit } from '../ceremony-movement';

export function subscribeHandoff(
  eventBus: CeremonyEventBus,
  ctx: CeremonyHandlerContext,
): () => void {
  const {
    sceneIntentBus,
    agentsRef,
    companyIdRef,
    zonesRef,
    registryRef,
    assignedWorkPositionsRef,
    assignedWorkZoneIdsRef,
    ceremonyVersionRef,
    setCeremony,
    clearSceneBubbleText,
  } = ctx;
  const movementRefs = {
    companyIdRef,
    zonesRef,
    registryRef,
    assignedWorkPositionsRef,
    assignedWorkZoneIdsRef,
  };

  const resolveEmployeeTargetPosition = (employeeId: string): [number, number, number] | null => {
    const assigned = assignedWorkPositionsRef.current.get(employeeId);
    if (assigned) return assigned;

    const handle = getMovementHandles(companyIdRef.current).get(employeeId);
    const current = handle?.getPosition();
    if (current) return current;

    const agent = agentsRef.current.get(employeeId);
    if (agent) {
      const zoneId = resolveZoneForRole(agent.role as RoleSlug, zonesRef.current)?.zoneId;
      if (zoneId) return getZoneCenterById(zonesRef.current, zoneId);
    }
    return null;
  };

  const handleHandoffInitiated = (payload: SceneHandoffInitiatedPayload) => {
    const fromHandle = getMovementHandles(companyIdRef.current).get(payload.fromEmployeeId);
    const fromPosition =
      assignedWorkPositionsRef.current.get(payload.fromEmployeeId) ??
      fromHandle?.getPosition() ??
      null;
    const toPosition = resolveEmployeeTargetPosition(payload.toEmployeeId);
    const meetingCenter = getZoneCenter(zonesRef.current, 'meeting');
    const fromName = agentsRef.current.get(payload.fromEmployeeId)?.name ?? 'Teammate';
    const toName = agentsRef.current.get(payload.toEmployeeId)?.name ?? 'teammate';

    const bubbleText = `${fromName} → handoff to ${toName}`;
    setCeremony((prev) => {
      const waitingRelationships = addWaitingRelationship(prev.waitingRelationships, {
        waiterId: payload.toEmployeeId,
        waiterName: toName,
        waitingFor: payload.fromEmployeeId,
        waitingForName: fromName,
        kind: 'handoff',
      });
      if (prev.bubbleText === bubbleText && waitingRelationships === prev.waitingRelationships) {
        return prev;
      }
      return { ...prev, bubbleText, waitingRelationships };
    });

    if (fromHandle && fromPosition && toPosition) {
      const version = ceremonyVersionRef.current;
      moveThroughPoints(
        fromHandle,
        buildHandoffRoute(fromPosition, toPosition, meetingCenter, {
          obstacleFootprints: getObstacleFootprints(registryRef.current),
        }),
        3.5,
        () => {
          if (ceremonyVersionRef.current !== version) return;
          const returnPosition =
            assignedWorkPositionsRef.current.get(payload.fromEmployeeId) ??
            resolveEmployeeTargetPosition(payload.fromEmployeeId);
          if (returnPosition) {
            moveEmployeeAlongTransit(payload.fromEmployeeId, returnPosition, 3.2, movementRefs, {
              endZoneId:
                assignedWorkZoneIdsRef.current.get(payload.fromEmployeeId) ??
                resolveZoneIdForPosition(returnPosition, zonesRef.current),
            });
          }
        },
      );
    }
  };

  const handleHandoffCompleted = (payload: SceneHandoffCompletedPayload) => {
    setCeremony((prev) => {
      const waitingRelationships = removeWaitingRelationship(
        prev.waitingRelationships,
        payload.toEmployeeId,
      );
      if (waitingRelationships === prev.waitingRelationships) return prev;
      return { ...prev, bubbleText: 'Handoff received', waitingRelationships };
    });

    clearSceneBubbleText('Handoff received', 1200);
  };

  const unsubInitiated = sceneIntentBus
    ? sceneIntentBus.on('scene.handoff.initiated', (intent) => {
        handleHandoffInitiated(intent.payload as SceneHandoffInitiatedPayload);
      })
    : eventBus.on('handoff.initiated', (e: RuntimeEvent<HandoffInitiatedPayload>) => {
        handleHandoffInitiated({
          handoffId: e.payload.handoffId,
          fromEmployeeId: e.payload.fromEmployeeId,
          toEmployeeId: e.payload.toEmployeeId,
          reason: e.payload.reason,
          taskRunId: e.payload.taskRunId,
        });
      });

  const unsubCompleted = sceneIntentBus
    ? sceneIntentBus.on('scene.handoff.completed', (intent) => {
        handleHandoffCompleted(intent.payload as SceneHandoffCompletedPayload);
      })
    : eventBus.on('handoff.completed', (e: RuntimeEvent<HandoffCompletedPayload>) => {
        handleHandoffCompleted({
          handoffId: e.payload.handoffId,
          toEmployeeId: e.payload.toEmployeeId,
          taskRunId: e.payload.taskRunId,
        });
      });

  return () => {
    unsubInitiated();
    unsubCompleted();
  };
}
