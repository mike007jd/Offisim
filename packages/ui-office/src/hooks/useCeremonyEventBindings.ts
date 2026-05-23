import type { PrefabInstanceRow, RuntimeEvent, Zone } from '@offisim/shared-types';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useCeremonyEventCoordination } from '../lib/ceremony/ceremony-event-coordination';
import type { CeremonyHandlerContext } from '../lib/ceremony/ceremony-handler-context';
import {
  createDispatchEmployee,
  createGatherAll,
  createStartDismissPhase,
  createStartEndCeremony,
} from '../lib/ceremony/ceremony-phase-actions';
import { useCeremonySceneState } from '../lib/ceremony/ceremony-scene-state';
import { useCeremonyScheduling } from '../lib/ceremony/ceremony-scheduling';
import { subscribeCompanyStartup } from '../lib/ceremony/event-handlers/company-startup';
import { subscribeEmployeeStalled } from '../lib/ceremony/event-handlers/employee-stalled';
import { subscribeHandoff } from '../lib/ceremony/event-handlers/handoff';
import { subscribeInteractionApproval } from '../lib/ceremony/event-handlers/interaction-approval';
import { subscribeLlmChunkStream } from '../lib/ceremony/event-handlers/llm-chunk-stream';
import { subscribeNodePhaseTransitions } from '../lib/ceremony/event-handlers/node-phase-transitions';
import { subscribePlanCreated } from '../lib/ceremony/event-handlers/plan-created';
import { subscribeTaskDispatch } from '../lib/ceremony/event-handlers/task-dispatch';
import { subscribeToolTelemetry } from '../lib/ceremony/event-handlers/tool-telemetry';
import type { SceneIntentBus } from '../runtime/scene-intents';
import type { AgentState } from '../runtime/use-agent-states';
import type { CeremonyState } from './useCeremonyState';

export interface CeremonyEventBindingDeps {
  companyId: string;
  eventBus: {
    on: <TPayload = unknown>(
      prefix: string,
      handler: (e: RuntimeEvent<TPayload>) => void,
    ) => () => void;
  };
  sceneIntentBus?: SceneIntentBus;
  agents: Map<string, AgentState>;
  zones: readonly Zone[];
  prefabInstances?: readonly PrefabInstanceRow[];
  setCeremony: React.Dispatch<React.SetStateAction<CeremonyState>>;
  ceremonyVersionRef: React.MutableRefObject<number>;
}

export function useCeremonyEventBindings({
  companyId,
  eventBus,
  sceneIntentBus,
  agents,
  zones,
  prefabInstances,
  setCeremony,
  ceremonyVersionRef,
}: CeremonyEventBindingDeps): void {
  const companyIdRef = useRef(companyId);
  companyIdRef.current = companyId;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const zonesRef = useRef(zones);
  zonesRef.current = zones;

  const sceneState = useCeremonySceneState({ prefabInstances, zones });
  const coordination = useCeremonyEventCoordination();
  const scheduling = useCeremonyScheduling({
    ceremonyVersionRef,
    setCeremony,
    clearAssignedSceneState: sceneState.clearAssignedSceneState,
  });

  const phaseDeps = useMemo(
    () => ({
      companyIdRef,
      agentsRef,
      zonesRef,
      ceremonyVersionRef,
      registryRef: sceneState.registryRef,
      assignedWorkPositionsRef: sceneState.assignedWorkPositionsRef,
      assignedWorkApproachPositionsRef: sceneState.assignedWorkApproachPositionsRef,
      assignedWorkZoneIdsRef: sceneState.assignedWorkZoneIdsRef,
      setCeremony,
      clearAssignedSceneState: sceneState.clearAssignedSceneState,
      safeTimeout: scheduling.safeTimeout,
      scheduleCeremonyReset: scheduling.scheduleCeremonyReset,
    }),
    [ceremonyVersionRef, sceneState, setCeremony, scheduling],
  );

  const startDismissPhase = useMemo(() => createStartDismissPhase(phaseDeps), [phaseDeps]);
  const gatherAll = useCallback(
    (version: number) => createGatherAll(phaseDeps)(version),
    [phaseDeps],
  );
  const dispatchEmployee = useCallback(
    (employeeId: string, role: string, version: number) =>
      createDispatchEmployee(phaseDeps)(employeeId, role, version),
    [phaseDeps],
  );
  const startEndCeremony = useCallback(
    (summaryText: string, version: number) =>
      createStartEndCeremony(phaseDeps, startDismissPhase)(summaryText, version),
    [phaseDeps, startDismissPhase],
  );

  useEffect(() => {
    const ctx: CeremonyHandlerContext = {
      sceneIntentBus,
      companyIdRef,
      agentsRef,
      zonesRef,
      ceremonyVersionRef,
      registryRef: sceneState.registryRef,
      assignedWorkPositionsRef: sceneState.assignedWorkPositionsRef,
      assignedWorkApproachPositionsRef: sceneState.assignedWorkApproachPositionsRef,
      assignedWorkZoneIdsRef: sceneState.assignedWorkZoneIdsRef,
      approvalHoldPositionsRef: sceneState.approvalHoldPositionsRef,
      clarificationHoldPositionsRef: sceneState.clarificationHoldPositionsRef,
      hasActivePlanRef: coordination.hasActivePlanRef,
      lastLlmChunkRef: coordination.lastLlmChunkRef,
      timerRefs: scheduling.timerRefs,
      setCeremony,
      safeTimeout: scheduling.safeTimeout,
      clearSceneBubbleText: scheduling.clearSceneBubbleText,
      scheduleCeremonyReset: scheduling.scheduleCeremonyReset,
      clearAssignedSceneState: sceneState.clearAssignedSceneState,
      gatherAll,
      dispatchEmployee,
      startEndCeremony,
    };

    const unsubs: Array<() => void> = [];
    unsubs.push(subscribeCompanyStartup(eventBus, ctx));
    unsubs.push(subscribeNodePhaseTransitions(eventBus, ctx));
    unsubs.push(subscribeTaskDispatch(eventBus, ctx));
    unsubs.push(subscribeLlmChunkStream(eventBus, ctx));
    unsubs.push(subscribePlanCreated(eventBus, ctx));
    unsubs.push(subscribeToolTelemetry(eventBus, ctx));
    unsubs.push(subscribeInteractionApproval(eventBus, ctx));
    unsubs.push(subscribeHandoff(eventBus, ctx));
    unsubs.push(subscribeEmployeeStalled(eventBus, ctx));
    return () => {
      for (let i = unsubs.length - 1; i >= 0; i--) unsubs[i]?.();
    };
  }, [
    eventBus,
    sceneIntentBus,
    ceremonyVersionRef,
    sceneState,
    coordination,
    scheduling,
    setCeremony,
    gatherAll,
    dispatchEmployee,
    startEndCeremony,
  ]);
}
