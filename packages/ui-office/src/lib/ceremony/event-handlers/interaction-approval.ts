import type {
  InteractionRequestedPayload,
  InteractionResolvedPayload,
  InteractionRestoredPayload,
  RuntimeEvent,
} from '@offisim/shared-types';
import {
  getObstacleFootprints,
  getZoneCenter,
  getZoneCenterById,
} from '../../../hooks/scene-orchestrator-positions';
import { getMovementHandles } from '../../../runtime/movement-handle-registry';
import type {
  SceneInteractionResolvedPayload,
  SceneInteractionWaitingPayload,
} from '../../../runtime/scene-intents';
import {
  describeInteractionSceneRequest,
  describeInteractionSceneResolution,
} from '../../ceremony-descriptions';
import { addWaitingRelationship, removeWaitingRelationship } from '../../ceremony-visuals';
import {
  buildApprovalHoldTarget,
  buildClarificationHoldTarget,
  buildDispatchRoute,
  buildReturnToMeetingRoute,
  moveThroughPoints,
} from '../../scene-behavior';
import { buildZoneRouteWaypoints, getMeetingZoneId } from '../../scene-nav';
import type { CeremonyEventBus, CeremonyHandlerContext } from '../ceremony-handler-context';

export function subscribeInteractionApproval(
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
    assignedWorkApproachPositionsRef,
    assignedWorkZoneIdsRef,
    approvalHoldPositionsRef,
    clarificationHoldPositionsRef,
    setCeremony,
    clearSceneBubbleText,
  } = ctx;

  const getAssignedEmployeeSceneContext = (employeeId: string) => {
    const basePosition = assignedWorkPositionsRef.current.get(employeeId);
    const departureApproach = assignedWorkApproachPositionsRef.current.get(employeeId);
    const workZoneId = assignedWorkZoneIdsRef.current.get(employeeId);
    const handle = getMovementHandles(companyIdRef.current).get(employeeId);
    return { basePosition, departureApproach, workZoneId, handle };
  };

  const handleInteractionApproval = (payload: SceneInteractionWaitingPayload) => {
    const label = describeInteractionSceneRequest({ kind: payload.kind }, payload.restored);
    setCeremony((prev) => {
      const employeeId = payload.employeeId;
      const employeeName = employeeId
        ? (agentsRef.current.get(employeeId)?.name ?? 'A teammate')
        : 'A teammate';
      const waitingRelationships = employeeId
        ? addWaitingRelationship(prev.waitingRelationships, {
            waiterId: employeeId,
            waiterName: employeeName,
            waitingFor: 'user',
            kind: payload.kind,
          })
        : prev.waitingRelationships;
      if (prev.bubbleText === label && waitingRelationships === prev.waitingRelationships)
        return prev;
      return { ...prev, bubbleText: label, waitingRelationships };
    });

    if (!payload.employeeId) return;

    const employeeId = payload.employeeId;
    const { basePosition, departureApproach, handle, workZoneId } =
      getAssignedEmployeeSceneContext(employeeId);
    if (!basePosition || !handle) return;

    const meetingCenter = getZoneCenter(zonesRef.current, 'meeting');
    const meetingZoneId = getMeetingZoneId(zonesRef.current);
    const isApproval = payload.kind === 'permission_request';
    const positionsRef = isApproval ? approvalHoldPositionsRef : clarificationHoldPositionsRef;
    const buildHold = isApproval ? buildApprovalHoldTarget : buildClarificationHoldTarget;
    const holdTarget = payload.restored
      ? (positionsRef.current.get(employeeId) ??
        buildHold(meetingCenter, positionsRef.current.size))
      : buildHold(meetingCenter, positionsRef.current.size);
    positionsRef.current.set(employeeId, holdTarget);
    moveThroughPoints(
      handle,
      buildReturnToMeetingRoute(basePosition, meetingCenter, holdTarget, {
        departureApproach,
        zoneWaypoints: workZoneId
          ? buildZoneRouteWaypoints(zonesRef.current, workZoneId, meetingZoneId).reverse()
          : [],
        obstacleFootprints: getObstacleFootprints(registryRef.current),
      }),
      4,
    );
  };

  const handleResolvedInteraction = (payload: SceneInteractionResolvedPayload) => {
    const label = describeInteractionSceneResolution({
      request: { kind: payload.kind },
      response: { selectedOptionId: payload.selectedOptionId },
    });
    setCeremony((prev) => {
      const waitingRelationships = payload.employeeId
        ? removeWaitingRelationship(prev.waitingRelationships, payload.employeeId)
        : prev.waitingRelationships;
      if (prev.bubbleText === label && waitingRelationships === prev.waitingRelationships) {
        return prev;
      }
      return { ...prev, bubbleText: label, waitingRelationships };
    });

    if (payload.employeeId) {
      const employeeId = payload.employeeId;
      const { basePosition, handle, workZoneId } = getAssignedEmployeeSceneContext(employeeId);
      approvalHoldPositionsRef.current.delete(employeeId);
      clarificationHoldPositionsRef.current.delete(employeeId);
      if (basePosition && handle) {
        const meetingCenter = getZoneCenter(zonesRef.current, 'meeting');
        const meetingZoneId = getMeetingZoneId(zonesRef.current);
        const targetZoneCenter = workZoneId
          ? getZoneCenterById(zonesRef.current, workZoneId)
          : basePosition;
        const currentPosition = handle.getPosition() ?? meetingCenter;
        moveThroughPoints(
          handle,
          buildDispatchRoute(currentPosition, targetZoneCenter, basePosition, {
            zoneWaypoints: workZoneId
              ? buildZoneRouteWaypoints(zonesRef.current, meetingZoneId, workZoneId)
              : [],
            obstacleFootprints: getObstacleFootprints(registryRef.current),
          }),
          3.2,
        );
      }
    }

    clearSceneBubbleText(label, 1200);
  };

  const unsubWaiting = sceneIntentBus
    ? sceneIntentBus.on('scene.interaction.waiting', (intent) =>
        handleInteractionApproval(intent.payload as SceneInteractionWaitingPayload),
      )
    : (() => {
        const offRequested = eventBus.on(
          'interaction.requested',
          (e: RuntimeEvent<InteractionRequestedPayload>) =>
            handleInteractionApproval({
              kind: e.payload.request.kind,
              employeeId: e.payload.request.employeeId ?? null,
              restored: false,
            }),
        );
        const offRestored = eventBus.on(
          'interaction.restored',
          (e: RuntimeEvent<InteractionRestoredPayload>) =>
            handleInteractionApproval({
              kind: e.payload.request.kind,
              employeeId: e.payload.request.employeeId ?? null,
              restored: true,
            }),
        );
        return () => {
          offRequested();
          offRestored();
        };
      })();

  const unsubResolved = sceneIntentBus
    ? sceneIntentBus.on('scene.interaction.resolved', (intent) => {
        handleResolvedInteraction(intent.payload as SceneInteractionResolvedPayload);
      })
    : eventBus.on('interaction.resolved', (e: RuntimeEvent<InteractionResolvedPayload>) =>
        handleResolvedInteraction({
          kind: e.payload.request.kind,
          employeeId: e.payload.request.employeeId ?? null,
          selectedOptionId: e.payload.response.selectedOptionId,
        }),
      );

  return () => {
    unsubWaiting();
    unsubResolved();
  };
}
