import type { GraphNodeEnteredPayload, RuntimeEvent } from '@offisim/shared-types';
import { getZoneCenter } from '../../../hooks/scene-orchestrator-positions';
import { createIdleCeremonyState } from '../../../hooks/useCeremonyState';
import { getMovementHandles } from '../../../runtime/movement-handle-registry';
import { buildManagerPresenceTarget } from '../../scene-behavior';
import type { CeremonyEventBus, CeremonyHandlerContext } from '../ceremony-handler-context';
import { moveEmployeeToRest } from '../ceremony-movement';

export function subscribeNodePhaseTransitions(
  eventBus: CeremonyEventBus,
  ctx: CeremonyHandlerContext,
): () => void {
  const {
    companyIdRef,
    zonesRef,
    registryRef,
    assignedWorkPositionsRef,
    assignedWorkZoneIdsRef,
    ceremonyVersionRef,
    hasActivePlanRef,
    lastLlmChunkRef,
    timerRefs,
    setCeremony,
    safeTimeout,
    clearAssignedSceneState,
    gatherAll,
    startEndCeremony,
  } = ctx;
  const movementRefs = {
    companyIdRef,
    zonesRef,
    registryRef,
    assignedWorkPositionsRef,
    assignedWorkZoneIdsRef,
  };

  const unsubNode = eventBus.on(
    'graph.node.entered',
    (e: RuntimeEvent<GraphNodeEnteredPayload>) => {
      const node = e.payload.nodeName;
      const version = ++ceremonyVersionRef.current;

      if (node === 'manager') {
        const handles = getMovementHandles(companyIdRef.current);
        for (const [employeeId, handle] of handles) {
          handle.stop();
          moveEmployeeToRest(employeeId, 5, movementRefs);
        }
        hasActivePlanRef.current = false;
        clearAssignedSceneState();
        safeTimeout(() => {
          if (ceremonyVersionRef.current !== version) return;
          const meetingCenter = getZoneCenter(zonesRef.current, 'meeting');
          gatherAll(version);
          setCeremony((prev) => ({
            ...prev,
            phase: 'analyzing',
            bubbleText: 'Analyzing request...',
            managerVisible: true,
            managerPosition: buildManagerPresenceTarget(meetingCenter, 'analyzing'),
          }));
        }, 300);
      }

      if (
        node === 'pm' ||
        node === 'planner' ||
        node === 'project_manager' ||
        node === 'product_manager'
      ) {
        const meetingCenter = getZoneCenter(zonesRef.current, 'meeting');
        setCeremony((prev) => ({
          ...prev,
          phase: 'planning',
          bubbleText: 'Planning tasks...',
          managerVisible: true,
          managerPosition: buildManagerPresenceTarget(meetingCenter, 'planning'),
        }));
      }

      if (node === 'step_dispatcher') {
        hasActivePlanRef.current = true;
        setCeremony((prev) => ({
          ...prev,
          phase: 'dispatching',
          bubbleText: 'Assigning tasks...',
        }));
      }

      if (node === 'boss_summary' || node === 'boss') {
        if (hasActivePlanRef.current) {
          startEndCeremony(lastLlmChunkRef.current || 'Work complete.', version);
          hasActivePlanRef.current = false;
        }
      }
    },
  );

  const unsubAborted = eventBus.on('execution.aborted', () => {
    ceremonyVersionRef.current += 1;
    timerRefs.current.forEach(clearTimeout);
    timerRefs.current.clear();
    setCeremony(createIdleCeremonyState());
    clearAssignedSceneState();
  });

  return () => {
    unsubNode();
    unsubAborted();
  };
}
