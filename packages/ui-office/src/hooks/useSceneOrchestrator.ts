/**
 * useSceneOrchestrator — ceremony orchestrator for the 3D office scene.
 *
 * Listens to EventBus graph.node.entered events and coordinates:
 * - Start ceremony: all employees gather at MTG zone (manager trigger)
 * - Task dispatch: individual employees dispatched to workstations
 * - End ceremony: participants return to MTG, then dismiss to rest (boss_summary)
 * - Concurrent interruption: new message cancels ongoing ceremony
 *
 * All position mutations happen via the CharacterMovementHandle API
 * (ref-based, zero re-renders). The orchestrator manages ceremony
 * state in React state for the MeetingBubble3D to consume.
 */

import type {
  EmployeeStatePayload,
  GraphNodeEnteredPayload,
  HandoffCompletedPayload,
  HandoffInitiatedPayload,
  InteractionRequest,
  InteractionRequestedPayload,
  InteractionResolvedPayload,
  InteractionRestoredPayload,
  PrefabInstanceRow,
  RoleSlug,
  RuntimeEvent,
  TaskAssignmentDispatchedPayload,
  ToolExecutionTelemetryPayload,
} from '@offisim/shared-types';
import { UNASSIGNED_ZONE_ID, resolveZoneForRole, type Zone } from '@offisim/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { addWaitingRelationship, removeWaitingRelationship } from '../lib/ceremony-visuals';
import { truncate } from '../lib/format-time';
import {
  buildApprovalHoldTarget,
  buildClarificationHoldTarget,
  buildDispatchRoute,
  buildHandoffRoute,
  buildManagerPresenceTarget,
  buildReturnToMeetingRoute,
  buildStalledWorkTarget,
  buildTransitRoute,
  buildWorkActivityTarget,
  moveThroughPoints,
} from '../lib/scene-behavior';
import { buildZoneRouteWaypoints, getMeetingZoneId } from '../lib/scene-nav';
import {
  SeatRegistry,
  computeRestSeatPosition,
} from '../lib/seat-registry';
import { categorizeTool } from '../lib/tool-category';
import type {
  SceneEmployeeEscalatedPayload,
  SceneHandoffCompletedPayload,
  SceneHandoffInitiatedPayload,
  SceneIntentBus,
  SceneInteractionResolvedPayload,
  SceneInteractionWaitingPayload,
  SceneTaskDispatchedPayload,
} from '../runtime/scene-intents';
import type { AgentState } from '../runtime/use-agent-states';
import type { CharacterMovementHandle } from './useCharacterMovement';
import {
  computeMtgPositions,
  getObstacleFootprints,
  getWorkstationApproachPos,
  getWorkstationPos,
  getZoneCenter,
  getZoneCenterById,
  resolveZoneIdForPosition,
} from './scene-orchestrator-positions';

// ── Zone-aware coordinate helpers ────────────────────────────────

function getRestSlotKey(companyId: string): string {
  return `${companyId}:rest-counter`;
}

function getRestPos(
  companyId: string,
  registry: SeatRegistry | null,
  zones: readonly Zone[],
): [number, number, number] {
  const key = getRestSlotKey(companyId);
  const idx = zoneSlotCounters.get(key) ?? 0;
  zoneSlotCounters.set(key, idx + 1);
  if (registry) {
    return [...registry.getRestSeat(zones, idx)];
  }
  const restCenter = getZoneCenter(zones, 'rest');
  return computeRestSeatPosition(restCenter[0], restCenter[2], idx);
}

export function createIdleCeremonyState(): CeremonyState {
  return {
    phase: 'idle',
    bubbleText: '',
    participantIds: new Set(),
    dispatchedIds: new Set(),
    managerVisible: false,
    managerPosition: null,
    waitingRelationships: [],
  };
}

export const IDLE_CEREMONY: CeremonyState = createIdleCeremonyState();

// ── Ceremony state (exposed to MeetingBubble3D) ─────────────────

export type CeremonyPhase =
  | 'idle'
  | 'gathering' // employees walking to MTG
  | 'analyzing' // manager LLM running
  | 'planning' // PM creating plan
  | 'dispatching' // step_dispatcher assigning
  | 'working' // employees at workstations
  | 'reporting' // boss_summary, employees returning to MTG
  | 'dismissing'; // everyone walking back to rest

export interface WaitingRelationship {
  waiterId: string;
  waiterName: string;
  waitingFor: 'user' | string;
  waitingForName?: string | null;
  kind: InteractionRequest['kind'] | 'handoff';
}

export interface CeremonyState {
  phase: CeremonyPhase;
  /** Text to show in the meeting bubble. */
  bubbleText: string;
  /** Employee IDs participating in current ceremony. */
  participantIds: Set<string>;
  /** Employees dispatched to workstations (won't return to MTG at end). */
  dispatchedIds: Set<string>;
  managerVisible: boolean;
  managerPosition: [number, number, number] | null;
  waitingRelationships: WaitingRelationship[];
}

export function describeWorkingToolActivity(
  payload: Pick<ToolExecutionTelemetryPayload, 'toolName' | 'serverName' | 'status' | 'errorType'>,
): string | null {
  const category = categorizeTool(payload);
  if (payload.status === 'started') {
    switch (category) {
      case 'search':
        return 'Searching code...';
      case 'read':
        return 'Reading files...';
      case 'edit':
        return 'Editing workspace...';
      case 'shell':
        return 'Running shell task...';
      default:
        return 'Using tools...';
    }
  }
  if (payload.status === 'completed') {
    switch (category) {
      case 'search':
        return 'Search complete';
      case 'read':
        return 'Files reviewed';
      case 'edit':
        return 'Edits applied';
      case 'shell':
        return 'Shell task complete';
      default:
        return 'Tool step complete';
    }
  }
  if (payload.status === 'denied') {
    return payload.errorType === 'TOOL_PERMISSION_REQUIRED'
      ? 'Waiting on approval...'
      : 'Tool access blocked';
  }
  if (payload.status === 'error') {
    return 'Tool step failed';
  }
  return null;
}

export function describeInteractionSceneRequest(
  request: Pick<InteractionRequest, 'kind'>,
  restored = false,
): string {
  switch (request.kind) {
    case 'permission_request':
      return restored ? 'Approval wait restored' : 'Waiting for approval...';
    case 'plan_review':
      return restored ? 'Plan review restored' : 'Waiting for plan review...';
    case 'agent_question':
      return restored ? 'Clarification restored' : 'Waiting for clarification...';
  }
}

export function describeInteractionSceneResolution(payload: {
  request: Pick<InteractionRequest, 'kind'>;
  response: Pick<InteractionResolvedPayload['response'], 'selectedOptionId'>;
}): string {
  const { request, response } = payload;
  if (request.kind === 'permission_request') {
    return response.selectedOptionId.startsWith('approve')
      ? 'Approval received'
      : 'Approval denied';
  }
  if (request.kind === 'plan_review') {
    return response.selectedOptionId === 'revise_plan' ? 'Revising the plan...' : 'Plan approved';
  }
  return 'Clarification received';
}

export function describeEmployeeEscalation(
  employeeName: string,
  state: 'blocked' | 'failed',
): string {
  return state === 'failed' ? `${employeeName} hit a failure` : `${employeeName} is blocked`;
}

// ── Handle registry (company-scoped) ────────────────────────────

/** Per-company registry for movement handles — prevents cross-company leaks. */
const companyHandles = new Map<string, Map<string, CharacterMovementHandle>>();

function getHandleMap(companyId: string): Map<string, CharacterMovementHandle> {
  let map = companyHandles.get(companyId);
  if (!map) {
    map = new Map();
    companyHandles.set(companyId, map);
  }
  return map;
}

/** Accessor used internally by the orchestrator. */
function getMovementHandles(companyId: string): Map<string, CharacterMovementHandle> {
  return companyHandles.get(companyId) ?? new Map();
}

export function getMovementHandle(
  companyId: string,
  employeeId: string,
): CharacterMovementHandle | undefined {
  return getMovementHandles(companyId).get(employeeId);
}

export function registerMovementHandle(
  companyId: string,
  employeeId: string,
  handle: CharacterMovementHandle,
) {
  // Safety cap: evict oldest company entries if too many accumulate (FIFO by Map insertion order)
  if (!companyHandles.has(companyId) && companyHandles.size >= 5) {
    const oldest = companyHandles.keys().next().value;
    if (oldest !== undefined) companyHandles.delete(oldest);
  }

  const map = getHandleMap(companyId);
  map.set(employeeId, handle);

  // Warn if a single company accumulates too many handles (likely a leak)
  if (map.size > 200) {
    console.warn(
      `[useSceneOrchestrator] company "${companyId}" has ${map.size} movement handles — possible leak`,
    );
  }
}

export function unregisterMovementHandle(companyId: string, employeeId: string) {
  const map = companyHandles.get(companyId);
  if (map) {
    map.delete(employeeId);
    if (map.size === 0) companyHandles.delete(companyId);
  }
}

export function getMovementDebugInfo(companyId: string): Array<{
  id: string;
  x: number;
  y: number;
  isMoving: boolean;
}> {
  return [...getMovementHandles(companyId).entries()]
    .map(([id, handle]) => {
      const position = handle.getPosition();
      if (!position) return null;
      return {
        id,
        x: position[0],
        y: position[2],
        isMoving: handle.isMoving(),
      };
    })
    .filter(
      (entry): entry is { id: string; x: number; y: number; isMoving: boolean } => entry != null,
    );
}

// ── Slot tracker for workstation assignment ──────────────────────

const zoneSlotCounters = new Map<string, number>();

function getNextSlot(zoneId: string): number {
  const n = zoneSlotCounters.get(zoneId) ?? 0;
  zoneSlotCounters.set(zoneId, n + 1);
  return n;
}

function resetSlotCounters() {
  zoneSlotCounters.clear();
}

/** Clean up module-level state for a company (call on unmount / company switch). */
export function clearCompanyState(companyId: string): void {
  companyHandles.delete(companyId);
  for (const key of zoneSlotCounters.keys()) {
    if (key.startsWith(`${companyId}:`)) zoneSlotCounters.delete(key);
  }
}

// ── Hook ────────────────────────────────────────────────────────

interface OrchestratorDeps {
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
}

export function useSceneOrchestrator({
  companyId,
  eventBus,
  sceneIntentBus,
  agents,
  zones,
  prefabInstances,
}: OrchestratorDeps): CeremonyState {
  const [ceremony, setCeremony] = useState<CeremonyState>(() => createIdleCeremonyState());

  // Track current ceremony version to detect interruptions
  const ceremonyVersionRef = useRef(0);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const companyIdRef = useRef(companyId);
  companyIdRef.current = companyId;
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const registryRef = useRef<SeatRegistry | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: zones in deps triggers rebuild; zonesRef.current reads latest value
  useEffect(() => {
    registryRef.current = SeatRegistry.build(prefabInstances ?? [], zonesRef.current);
  }, [prefabInstances, zones]);

  const assignedWorkPositionsRef = useRef<Map<string, [number, number, number]>>(new Map());
  const assignedWorkApproachPositionsRef = useRef<Map<string, [number, number, number]>>(new Map());
  const assignedWorkZoneIdsRef = useRef<Map<string, string>>(new Map());
  const approvalHoldPositionsRef = useRef<Map<string, [number, number, number]>>(new Map());
  const clarificationHoldPositionsRef = useRef<Map<string, [number, number, number]>>(new Map());
  const clearAssignedSceneState = useCallback(() => {
    assignedWorkPositionsRef.current.clear();
    assignedWorkApproachPositionsRef.current.clear();
    assignedWorkZoneIdsRef.current.clear();
    approvalHoldPositionsRef.current.clear();
    clarificationHoldPositionsRef.current.clear();
  }, []);
  const getSceneObstacleFootprints = useCallback(
    () => getObstacleFootprints(registryRef.current),
    [],
  );

  // Timer tracking — clear all pending timeouts on unmount
  const timerRefs = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const safeTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timerRefs.current.delete(id);
      fn();
    }, ms);
    timerRefs.current.add(id);
    return id;
  }, []);
  const clearSceneBubbleText = useCallback(
    (label: string, delayMs: number) => {
      safeTimeout(() => {
        setCeremony((prev) => {
          if (prev.bubbleText !== label) return prev;
          return { ...prev, bubbleText: '' };
        });
      }, delayMs);
    },
    [safeTimeout],
  );
  const scheduleCeremonyReset = useCallback(
    (version: number, delayMs: number) => {
      safeTimeout(() => {
        if (ceremonyVersionRef.current !== version) return;
        setCeremony(createIdleCeremonyState());
        clearAssignedSceneState();
      }, delayMs);
    },
    [clearAssignedSceneState, safeTimeout],
  );

  // Cleanup module-level Maps and pending timers on unmount / company switch
  const activeCompanyId = companyId;
  useEffect(() => {
    return () => {
      clearCompanyState(activeCompanyId);
      timerRefs.current.forEach(clearTimeout);
      timerRefs.current.clear();
    };
  }, [activeCompanyId]);

  const moveEmployeeAlongTransit = useCallback(
    (
      employeeId: string,
      targetPosition: [number, number, number],
      speed: number,
      options?: {
        startZoneId?: string | null;
        endZoneId?: string | null;
        onComplete?: () => void;
      },
    ) => {
      const handle = getMovementHandles(companyIdRef.current).get(employeeId);
      if (!handle) return;

      const currentPosition =
        handle.getPosition() ?? assignedWorkPositionsRef.current.get(employeeId) ?? targetPosition;
      const startZoneId =
        options?.startZoneId ??
        assignedWorkZoneIdsRef.current.get(employeeId) ??
        resolveZoneIdForPosition(currentPosition, zonesRef.current);
      const endZoneId =
        options?.endZoneId ?? resolveZoneIdForPosition(targetPosition, zonesRef.current);
      const zoneWaypoints =
        startZoneId && endZoneId && startZoneId !== endZoneId
          ? buildZoneRouteWaypoints(zonesRef.current, startZoneId, endZoneId)
          : [];
      const route = buildTransitRoute(currentPosition, targetPosition, {
        zoneWaypoints,
        obstacleFootprints: getSceneObstacleFootprints(),
      }).slice(1);

      moveThroughPoints(handle, route, speed, options?.onComplete);
    },
    [getSceneObstacleFootprints],
  );

  const moveEmployeeToRest = useCallback(
    (employeeId: string, speed: number, onComplete?: () => void) => {
      const restZoneId = zonesRef.current.find((zone) => zone.archetype === 'rest')?.zoneId ?? null;
      moveEmployeeAlongTransit(
        employeeId,
        getRestPos(companyIdRef.current, registryRef.current, zonesRef.current),
        speed,
        { endZoneId: restZoneId, onComplete },
      );
    },
    [moveEmployeeAlongTransit],
  );
  const startDismissPhase = useCallback(
    (employeeIds: readonly string[], version: number) => {
      safeTimeout(() => {
        if (ceremonyVersionRef.current !== version) return;
        setCeremony((prev) => ({
          ...prev,
          phase: 'dismissing',
          bubbleText: '',
          managerVisible: false,
          managerPosition: null,
        }));
        for (const employeeId of employeeIds) {
          moveEmployeeToRest(employeeId, 4);
        }
        scheduleCeremonyReset(version, 3000);
      }, 1500);
    },
    [moveEmployeeToRest, safeTimeout, scheduleCeremonyReset],
  );

  /** Move all enabled employees to MTG semicircle positions. */
  const gatherAll = useCallback(
    (_version: number) => {
      const allIds = [...agentsRef.current.keys()];
      if (allIds.length === 0) return; // No employees to gather
      const participantIds = new Set(allIds);
      resetSlotCounters();

      setCeremony({
        phase: 'gathering',
        bubbleText: 'Gathering team...',
        participantIds,
        dispatchedIds: new Set(),
        managerVisible: false,
        managerPosition: null,
        waitingRelationships: [],
      });
      clearAssignedSceneState();

      const mtgCenter = getZoneCenter(zonesRef.current, 'meeting');
      const mtgPositions = computeMtgPositions(mtgCenter, allIds.length);

      allIds.forEach((id, idx) => {
        const handle = getMovementHandles(companyIdRef.current).get(id);
        if (!handle) return;
        const resolvedSeat = mtgPositions[idx] ?? mtgPositions[0] ?? mtgCenter;
        const jittered: [number, number, number] = [
          resolvedSeat[0] + (Math.random() - 0.5) * 0.3,
          0,
          resolvedSeat[2] + (Math.random() - 0.5) * 0.3,
        ];
        handle.moveTo(jittered, 5); // ceremony speed
      });
    },
    [clearAssignedSceneState],
  );

  /** Dispatch one employee from MTG to their workstation zone. */
  const dispatchEmployee = useCallback(
    (employeeId: string, role: string, version: number) => {
      const handle = getMovementHandles(companyIdRef.current).get(employeeId);
      if (!handle) return;

      // Determine target zone from role
      const resolvedZone = resolveZoneForRole(role as RoleSlug, zonesRef.current);
      const zoneId = resolvedZone?.zoneId ?? UNASSIGNED_ZONE_ID;
      const slot = getNextSlot(zoneId);
      const targetPos = getWorkstationPos(registryRef.current, zonesRef.current, zoneId, slot);
      const targetApproachPos = getWorkstationApproachPos(
        registryRef.current,
        zonesRef.current,
        zoneId,
        slot,
      );
      assignedWorkPositionsRef.current.set(employeeId, targetPos);
      assignedWorkApproachPositionsRef.current.set(employeeId, targetApproachPos);
      assignedWorkZoneIdsRef.current.set(employeeId, zoneId);
      const mtgCenter = getZoneCenter(zonesRef.current, 'meeting');
      const targetZoneCenter = getZoneCenterById(zonesRef.current, zoneId);
      const meetingZoneId = getMeetingZoneId(zonesRef.current);
      const currentPosition = handle.getPosition() ?? mtgCenter;
      const route = buildDispatchRoute(currentPosition, targetZoneCenter, targetPos, {
        zoneWaypoints: buildZoneRouteWaypoints(zonesRef.current, meetingZoneId, zoneId),
        obstacleFootprints: getSceneObstacleFootprints(),
        terminalApproach: targetApproachPos,
      });

      safeTimeout(() => {
        if (ceremonyVersionRef.current !== version) return; // interrupted
        moveThroughPoints(handle, route, 4);
      }, 500);

      setCeremony((prev) => ({
        ...prev,
        dispatchedIds: new Set([...prev.dispatchedIds, employeeId]),
      }));
    },
    [getSceneObstacleFootprints, safeTimeout],
  );

  /** End ceremony: gather participants back to MTG, show summary, then dismiss. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: moveEmployeeToRest is a stable useCallback with empty deps
  const startEndCeremony = useCallback(
    (summaryText: string, version: number) => {
      const meetingCenter = getZoneCenter(zonesRef.current, 'meeting');
      // Read current dispatched set before overwriting phase
      let capturedDispatchedIds: string[] = [];
      setCeremony((prev) => {
        capturedDispatchedIds = [...prev.dispatchedIds];
        return {
          ...prev,
          phase: 'reporting',
          bubbleText: summaryText || 'Summarizing results...',
          managerVisible: true,
          managerPosition: buildManagerPresenceTarget(meetingCenter, 'reporting'),
        };
      });

      // Only move employees that were actually dispatched to workstations
      const dispatchedIds =
        capturedDispatchedIds.length > 0 ? capturedDispatchedIds : [...agentsRef.current.keys()]; // fallback: all employees if no dispatch tracking

      // Guard: 0 employees → skip straight to dismiss
      if (dispatchedIds.length === 0) {
        scheduleCeremonyReset(version, 1500);
        return;
      }

      let arrivedCount = 0;
      let expectedArrivals = 0;
      const mtgCenter = getZoneCenter(zonesRef.current, 'meeting');
      const mtgPositions = computeMtgPositions(mtgCenter, dispatchedIds.length);

      dispatchedIds.forEach((id, idx) => {
        const handle = getMovementHandles(companyIdRef.current).get(id);
        if (!handle) return;
        expectedArrivals += 1;
        const seat = mtgPositions[idx] ?? mtgPositions[0] ?? mtgCenter;
        const reportSeat: [number, number, number] = [
          seat[0] + (Math.random() - 0.5) * 0.3,
          0,
          seat[2] + (Math.random() - 0.5) * 0.3,
        ];
        const basePosition = assignedWorkPositionsRef.current.get(id) ?? reportSeat;
        const departureApproach = assignedWorkApproachPositionsRef.current.get(id) ?? basePosition;
        const meetingZoneId = getMeetingZoneId(zonesRef.current);
        const workZoneId = assignedWorkZoneIdsRef.current.get(id);
        const route = buildReturnToMeetingRoute(basePosition, mtgCenter, reportSeat, {
          departureApproach,
          zoneWaypoints: workZoneId
            ? buildZoneRouteWaypoints(zonesRef.current, workZoneId, meetingZoneId).reverse()
            : [],
          obstacleFootprints: getSceneObstacleFootprints(),
        });

        moveThroughPoints(handle, route, 5, () => {
          arrivedCount++;
          if (arrivedCount >= expectedArrivals && ceremonyVersionRef.current === version) {
            startDismissPhase(dispatchedIds, version);
          }
        });
      });

      if (expectedArrivals === 0) {
        scheduleCeremonyReset(version, 1500);
      }
    },
    [getSceneObstacleFootprints, scheduleCeremonyReset, startDismissPhase],
  );

  // ── EventBus subscriptions ──
  // biome-ignore lint/correctness/useExhaustiveDependencies: moveEmployeeAlongTransit and moveEmployeeToRest are stable useCallbacks with empty deps
  useEffect(() => {
    // Track whether we have an active task plan
    let hasActivePlan = false;
    let lastLlmChunk = '';

    const unsubNode = eventBus.on(
      'graph.node.entered',
      (e: RuntimeEvent<GraphNodeEnteredPayload>) => {
        const node = e.payload.nodeName;
        const version = ++ceremonyVersionRef.current;

        if (node === 'manager') {
          // Interrupt any ongoing ceremony: stop all → send to rest → then gather
          const handles = getMovementHandles(companyIdRef.current);
          for (const [employeeId, handle] of handles) {
            handle.stop();
            moveEmployeeToRest(employeeId, 5); // quick return to rest first
          }
          hasActivePlan = false;
          clearAssignedSceneState();
          // Brief delay to visually separate the reset from the new gathering
          safeTimeout(() => {
            if (ceremonyVersionRef.current !== version) return; // another interrupt happened
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
          hasActivePlan = true;
          setCeremony((prev) => ({
            ...prev,
            phase: 'dispatching',
            bubbleText: 'Assigning tasks...',
          }));
        }

        if (node === 'boss_summary' || node === 'boss') {
          if (hasActivePlan) {
            startEndCeremony(lastLlmChunk || 'Work complete.', version);
            hasActivePlan = false;
          }
        }
      },
    );

    // Listen for individual task dispatches
    const handleDispatched = (payload: SceneTaskDispatchedPayload) => {
      const { employeeId, employeeName, stepLabel, stepIndex, totalSteps } = payload;
      const agent = agentsRef.current.get(employeeId);
      const role = agent?.role ?? 'developer';

      setCeremony((prev) => ({
        ...prev,
        bubbleText: `→ ${employeeName}: ${truncate(stepLabel, 30)}`,
      }));

      dispatchEmployee(employeeId, role, ceremonyVersionRef.current);

      // If this is the last step, switch to working phase
      if (stepIndex === totalSteps - 1) {
        safeTimeout(() => {
          const undispatchedIds: string[] = [];
          setCeremony((prev) => {
            if (prev.phase !== 'dispatching') return prev;
            // Dismiss undispatched employees to rest
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
          for (const employeeId of undispatchedIds) {
            moveEmployeeToRest(employeeId, 4);
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
            if (!e.payload.employeeId) {
              return;
            }
            handleDispatched({
              employeeId: e.payload.employeeId,
              employeeName: e.payload.employeeName,
              stepLabel: e.payload.stepLabel,
              stepIndex: e.payload.stepIndex,
              totalSteps: e.payload.totalSteps,
            });
          },
        );

    // Accumulate LLM stream chunks per node for real-time bubble text.
    // boss/boss_summary chunks form the end-ceremony summary.
    let accumulatedBossText = '';
    let currentStreamNode = '';

    const unsubChunk = eventBus.on('llm.stream.chunk', (e: RuntimeEvent) => {
      const payload = e.payload as
        | { nodeName?: string; content?: string; channel?: 'content' | 'reasoning' }
        | undefined;
      if (!payload?.content) return;

      const node = payload.nodeName ?? '';
      const channel = payload.channel ?? 'content';
      if (node !== currentStreamNode) {
        // New node started streaming — reset accumulation
        currentStreamNode = node;
        if (node === 'boss_summary' || node === 'boss') {
          accumulatedBossText = '';
        }
      }

      if (node === 'boss_summary' || node === 'boss') {
        if (channel !== 'content') {
          return;
        }
        accumulatedBossText += payload.content;
        lastLlmChunk = accumulatedBossText;
        // Live-update bubble with streaming boss summary (first 50 chars)
        const preview = truncate(accumulatedBossText, 50);
        setCeremony((prev) => {
          if (prev.phase !== 'reporting') return prev;
          return { ...prev, bubbleText: preview };
        });
      } else if (node === 'manager') {
        // Show manager's reasoning as it streams
        const text =
          payload.content.length > 40 ? `${payload.content.slice(0, 40)}…` : payload.content;
        lastLlmChunk = text;
      }
    });

    // Capture plan created — show summary and step count from actual PM output
    const unsubPlan = eventBus.on('plan.created', (e: RuntimeEvent) => {
      const payload = e.payload as { summary?: string; steps?: Array<unknown> } | undefined;
      const stepCount = payload?.steps?.length ?? 0;
      const summary = payload?.summary;
      if (stepCount > 0) {
        const text = summary
          ? `${truncate(summary, 30)} (${stepCount} steps)`
          : `Planning: ${stepCount} step${stepCount > 1 ? 's' : ''}`;
        setCeremony((prev) => ({
          ...prev,
          bubbleText: text,
        }));
      }
    });

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
          const obstacleFootprints = getSceneObstacleFootprints();
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

    const getAssignedEmployeeSceneContext = (employeeId: string) => {
      const basePosition = assignedWorkPositionsRef.current.get(employeeId);
      const departureApproach = assignedWorkApproachPositionsRef.current.get(employeeId);
      const workZoneId = assignedWorkZoneIdsRef.current.get(employeeId);
      const handle = getMovementHandles(companyIdRef.current).get(employeeId);
      return {
        basePosition,
        departureApproach,
        workZoneId,
        handle,
      };
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

      if (!payload.employeeId) {
        return;
      }

      const employeeId = payload.employeeId;
      const { basePosition, departureApproach, handle, workZoneId } =
        getAssignedEmployeeSceneContext(employeeId);
      if (!basePosition || !handle) {
        return;
      }

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
          obstacleFootprints: getSceneObstacleFootprints(),
        }),
        4,
      );
    };

    const unsubInteractionWaiting = sceneIntentBus
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
              obstacleFootprints: getSceneObstacleFootprints(),
            }),
            3.2,
          );
        }
      }

      clearSceneBubbleText(label, 1200);
    };

    const unsubInteractionResolved = sceneIntentBus
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
          buildStalledWorkTarget(basePosition, next, getSceneObstacleFootprints()),
          2.2,
        );
      }

      clearSceneBubbleText(label, 1400);
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
        if (zoneId) {
          return getZoneCenterById(zonesRef.current, zoneId);
        }
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
            obstacleFootprints: getSceneObstacleFootprints(),
          }),
          3.5,
          () => {
            if (ceremonyVersionRef.current !== version) return;
            const returnPosition =
              assignedWorkPositionsRef.current.get(payload.fromEmployeeId) ??
              resolveEmployeeTargetPosition(payload.fromEmployeeId);
            if (returnPosition) {
              moveEmployeeAlongTransit(payload.fromEmployeeId, returnPosition, 3.2, {
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

    const unsubEmployeeState = sceneIntentBus
      ? sceneIntentBus.on('scene.employee.escalated', (intent) => {
          handleEmployeeEscalated(intent.payload as SceneEmployeeEscalatedPayload);
        })
      : eventBus.on('employee.state.changed', (e: RuntimeEvent<EmployeeStatePayload>) => {
          if (e.payload.next !== 'blocked' && e.payload.next !== 'failed') {
            return;
          }
          handleEmployeeEscalated({
            employeeId: e.payload.employeeId,
            next: e.payload.next,
          });
        });

    const unsubHandoffInitiated = sceneIntentBus
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

    const unsubHandoffCompleted = sceneIntentBus
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

    // Abort → return ceremony to idle. Graph execution does not emit any
    // terminal node events when user cancels, so without this subscription the
    // 3D scene would freeze on whatever phase it was in (FS3 from Phase 4).
    const unsubAborted = eventBus.on('execution.aborted', () => {
      ceremonyVersionRef.current += 1;
      timerRefs.current.forEach(clearTimeout);
      timerRefs.current.clear();
      setCeremony(createIdleCeremonyState());
      clearAssignedSceneState();
    });

    return () => {
      unsubNode();
      unsubDispatch();
      unsubChunk();
      unsubPlan();
      unsubTool();
      unsubInteractionWaiting();
      unsubInteractionResolved();
      unsubEmployeeState();
      unsubHandoffInitiated();
      unsubHandoffCompleted();
      unsubAborted();
      // Clear all pending ceremony timeouts on effect teardown
      timerRefs.current.forEach(clearTimeout);
      timerRefs.current.clear();
    };
  }, [
    eventBus,
    sceneIntentBus,
    gatherAll,
    dispatchEmployee,
    startEndCeremony,
    safeTimeout,
    clearAssignedSceneState,
  ]);

  return ceremony;
}
