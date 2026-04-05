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
  Zone,
} from '@offisim/shared-types';
import { UNASSIGNED_ZONE_ID, resolveZoneForRole } from '@offisim/shared-types';
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
  buildWorkActivityTarget,
  moveThroughPoints,
} from '../lib/scene-behavior';
import { buildZoneRouteWaypoints, getMeetingZoneId } from '../lib/scene-nav';
import { SEAT_OFFSETS } from '../lib/seat-offsets';
import { SeatRegistry, computeRestSeatPosition } from '../lib/seat-registry';
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

// ── Zone-aware coordinate helpers ────────────────────────────────

const MTG_RADIUS = 2.5;

/** Fallback center if zone not found. */
const ORIGIN: [number, number, number] = [0, 0, 0];

function getZoneCenter(zones: readonly Zone[], archetype: string): [number, number, number] {
  const z = zones.find((zone) => zone.archetype === archetype);
  return z ? [z.cx, 0, z.cz] : ORIGIN;
}

function getZoneCenterById(zones: readonly Zone[], zoneId: string): [number, number, number] {
  const z = zones.find((zone) => zone.zoneId === zoneId);
  return z ? [z.cx, 0, z.cz] : ORIGIN;
}

function computeMtgPositions(mtgCenter: [number, number, number]) {
  return Array.from({ length: 8 }, (_, i) => {
    const angle = (Math.PI * (i + 1)) / 9;
    return [
      mtgCenter[0] + Math.cos(angle) * MTG_RADIUS,
      0,
      mtgCenter[2] + Math.sin(angle) * MTG_RADIUS,
    ] as [number, number, number];
  });
}

function getWorkstationPos(
  registry: SeatRegistry | null,
  zones: readonly Zone[],
  zoneId: string,
  slotIdx: number,
): [number, number, number] {
  if (registry) {
    const seat = registry.getSeat(zoneId, slotIdx);
    if (seat) return [...seat.position];
  }
  const center = getZoneCenterById(zones, zoneId);
  const offset = SEAT_OFFSETS[slotIdx % SEAT_OFFSETS.length] ?? SEAT_OFFSETS[0] ?? [0, 0, 0];
  return [center[0] + offset[0], 0, center[2] + offset[2]];
}

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

  useEffect(() => {
    registryRef.current = SeatRegistry.build(prefabInstances ?? [], zonesRef.current);
  }, [prefabInstances, zones]);

  const assignedWorkPositionsRef = useRef<Map<string, [number, number, number]>>(new Map());
  const assignedWorkZoneIdsRef = useRef<Map<string, string>>(new Map());
  const approvalHoldPositionsRef = useRef<Map<string, [number, number, number]>>(new Map());
  const clarificationHoldPositionsRef = useRef<Map<string, [number, number, number]>>(new Map());

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

  // Cleanup module-level Maps and pending timers on unmount / company switch
  const activeCompanyId = companyId;
  useEffect(() => {
    return () => {
      clearCompanyState(activeCompanyId);
      timerRefs.current.forEach(clearTimeout);
      timerRefs.current.clear();
    };
  }, [activeCompanyId]);

  /** Move all enabled employees to MTG semicircle positions. */
  const gatherAll = useCallback((_version: number) => {
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
    assignedWorkPositionsRef.current.clear();
    assignedWorkZoneIdsRef.current.clear();
    approvalHoldPositionsRef.current.clear();
    clarificationHoldPositionsRef.current.clear();

    const mtgCenter = getZoneCenter(zonesRef.current, 'meeting');
    const mtgPositions = computeMtgPositions(mtgCenter);

    allIds.forEach((id, idx) => {
      const handle = getMovementHandles(companyIdRef.current).get(id);
      if (!handle) return;
      const resolvedSeat = mtgPositions[idx % mtgPositions.length] ?? mtgPositions[0] ?? mtgCenter;
      const jittered: [number, number, number] = [
        resolvedSeat[0] + (Math.random() - 0.5) * 0.3,
        0,
        resolvedSeat[2] + (Math.random() - 0.5) * 0.3,
      ];
      handle.moveTo(jittered, 5); // ceremony speed
    });
  }, []);

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
      assignedWorkPositionsRef.current.set(employeeId, targetPos);
      assignedWorkZoneIdsRef.current.set(employeeId, zoneId);
      const mtgCenter = getZoneCenter(zonesRef.current, 'meeting');
      const targetZoneCenter = getZoneCenterById(zonesRef.current, zoneId);
      const meetingZoneId = getMeetingZoneId(zonesRef.current);
      const route = buildDispatchRoute(mtgCenter, targetZoneCenter, targetPos, {
        zoneWaypoints: buildZoneRouteWaypoints(zonesRef.current, meetingZoneId, zoneId),
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
    [safeTimeout],
  );

  /** End ceremony: gather participants back to MTG, show summary, then dismiss. */
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
        safeTimeout(() => {
          if (ceremonyVersionRef.current !== version) return;
          setCeremony(createIdleCeremonyState());
          assignedWorkPositionsRef.current.clear();
          assignedWorkZoneIdsRef.current.clear();
          approvalHoldPositionsRef.current.clear();
          clarificationHoldPositionsRef.current.clear();
        }, 1500);
        return;
      }

      let arrivedCount = 0;
      const mtgCenter = getZoneCenter(zonesRef.current, 'meeting');
      const mtgPositions = computeMtgPositions(mtgCenter);

      dispatchedIds.forEach((id, idx) => {
        const handle = getMovementHandles(companyIdRef.current).get(id);
        if (!handle) return;
        const seat = mtgPositions[idx % mtgPositions.length] ?? mtgPositions[0] ?? mtgCenter;
        const reportSeat: [number, number, number] = [
          seat[0] + (Math.random() - 0.5) * 0.3,
          0,
          seat[2] + (Math.random() - 0.5) * 0.3,
        ];
        const basePosition = assignedWorkPositionsRef.current.get(id) ?? reportSeat;
        const meetingZoneId = getMeetingZoneId(zonesRef.current);
        const workZoneId = assignedWorkZoneIdsRef.current.get(id);
        const route = buildReturnToMeetingRoute(basePosition, mtgCenter, reportSeat, {
          zoneWaypoints: workZoneId
            ? buildZoneRouteWaypoints(zonesRef.current, workZoneId, meetingZoneId).reverse()
            : [],
        });

        moveThroughPoints(handle, route, 5, () => {
          arrivedCount++;
          if (arrivedCount >= dispatchedIds.length && ceremonyVersionRef.current === version) {
            // All gathered — show summary for 1.5s then dismiss
            safeTimeout(() => {
              if (ceremonyVersionRef.current !== version) return;
              setCeremony((prev) => ({
                ...prev,
                phase: 'dismissing',
                bubbleText: '',
                managerVisible: false,
                managerPosition: null,
              }));
              for (const empId of dispatchedIds) {
                const h = getMovementHandles(companyIdRef.current).get(empId);
                h?.moveTo(
                  getRestPos(companyIdRef.current, registryRef.current, zonesRef.current),
                  4,
                );
              }
              // After 3s, ceremony is fully done
              safeTimeout(() => {
                if (ceremonyVersionRef.current !== version) return;
                setCeremony(createIdleCeremonyState());
                assignedWorkPositionsRef.current.clear();
                assignedWorkZoneIdsRef.current.clear();
                approvalHoldPositionsRef.current.clear();
                clarificationHoldPositionsRef.current.clear();
              }, 3000);
            }, 1500);
          }
        });
      });
    },
    [safeTimeout],
  );

  // ── EventBus subscriptions ──
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
          for (const [, handle] of handles) {
            handle.stop();
            handle.moveTo(
              getRestPos(companyIdRef.current, registryRef.current, zonesRef.current),
              5,
            ); // quick return to rest first
          }
          hasActivePlan = false;
          assignedWorkPositionsRef.current.clear();
          assignedWorkZoneIdsRef.current.clear();
          approvalHoldPositionsRef.current.clear();
          clarificationHoldPositionsRef.current.clear();
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
          setCeremony((prev) => {
            if (prev.phase !== 'dispatching') return prev;
            // Dismiss undispatched employees to rest
            const allIds = new Set(agentsRef.current.keys());
            for (const id of allIds) {
              if (!prev.dispatchedIds.has(id)) {
                const handle = getMovementHandles(companyIdRef.current).get(id);
                handle?.moveTo(
                  getRestPos(companyIdRef.current, registryRef.current, zonesRef.current),
                  4,
                );
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
            handleDispatched(e.payload);
          },
        );

    // Accumulate LLM stream chunks per node for real-time bubble text.
    // boss/boss_summary chunks form the end-ceremony summary.
    let accumulatedBossText = '';
    let currentStreamNode = '';

    const unsubChunk = eventBus.on('llm.stream.chunk', (e: RuntimeEvent) => {
      const payload = e.payload as { nodeName?: string; content?: string } | undefined;
      if (!payload?.content) return;

      const node = payload.nodeName ?? '';
      if (node !== currentStreamNode) {
        // New node started streaming — reset accumulation
        currentStreamNode = node;
        if (node === 'boss_summary' || node === 'boss') {
          accumulatedBossText = '';
        }
      }

      if (node === 'boss_summary' || node === 'boss') {
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
          if (e.payload.status === 'started') {
            handle.moveTo(buildWorkActivityTarget(basePosition, categorizeTool(e.payload)), 2.8);
          } else {
            handle.moveTo(basePosition, 2.4);
          }
        }

        if (e.payload.status !== 'started') {
          safeTimeout(() => {
            setCeremony((prev) => {
              if (prev.phase !== 'working' || prev.bubbleText !== label) return prev;
              return { ...prev, bubbleText: '' };
            });
          }, 900);
        }
      },
    );

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
      const basePosition = assignedWorkPositionsRef.current.get(employeeId);
      const handle = getMovementHandles(companyIdRef.current).get(employeeId);
      if (!basePosition || !handle) {
        return;
      }

      const meetingCenter = getZoneCenter(zonesRef.current, 'meeting');
      const meetingZoneId = getMeetingZoneId(zonesRef.current);
      const workZoneId = assignedWorkZoneIdsRef.current.get(employeeId);
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
          zoneWaypoints: workZoneId
            ? buildZoneRouteWaypoints(zonesRef.current, workZoneId, meetingZoneId).reverse()
            : [],
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
        const basePosition = assignedWorkPositionsRef.current.get(employeeId);
        const workZoneId = assignedWorkZoneIdsRef.current.get(employeeId);
        const handle = getMovementHandles(companyIdRef.current).get(employeeId);
        approvalHoldPositionsRef.current.delete(employeeId);
        clarificationHoldPositionsRef.current.delete(employeeId);
        if (basePosition && handle) {
          const meetingCenter = getZoneCenter(zonesRef.current, 'meeting');
          const meetingZoneId = getMeetingZoneId(zonesRef.current);
          const targetZoneCenter = workZoneId
            ? getZoneCenterById(zonesRef.current, workZoneId)
            : basePosition;
          moveThroughPoints(
            handle,
            buildDispatchRoute(meetingCenter, targetZoneCenter, basePosition, {
              zoneWaypoints: workZoneId
                ? buildZoneRouteWaypoints(zonesRef.current, meetingZoneId, workZoneId)
                : [],
            }),
            3.2,
          );
        }
      }

      safeTimeout(() => {
        setCeremony((prev) => {
          if (prev.bubbleText !== label) return prev;
          return { ...prev, bubbleText: '' };
        });
      }, 1200);
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
        handle.moveTo(buildStalledWorkTarget(basePosition, next), 2.2);
      }

      safeTimeout(() => {
        setCeremony((prev) => {
          if (prev.bubbleText !== label) return prev;
          return { ...prev, bubbleText: '' };
        });
      }, 1400);
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
          buildHandoffRoute(fromPosition, toPosition, meetingCenter),
          3.5,
          () => {
            if (ceremonyVersionRef.current !== version) return;
            const returnPosition =
              assignedWorkPositionsRef.current.get(payload.fromEmployeeId) ??
              resolveEmployeeTargetPosition(payload.fromEmployeeId);
            if (returnPosition) {
              fromHandle.moveTo(returnPosition, 3.2);
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

      safeTimeout(() => {
        setCeremony((prev) => {
          if (prev.bubbleText !== 'Handoff received') return prev;
          return { ...prev, bubbleText: '' };
        });
      }, 1200);
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
      // Clear all pending ceremony timeouts on effect teardown
      timerRefs.current.forEach(clearTimeout);
      timerRefs.current.clear();
    };
  }, [eventBus, sceneIntentBus, gatherAll, dispatchEmployee, startEndCeremony, safeTimeout]);

  return ceremony;
}
