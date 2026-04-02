import type { EventBus } from '@offisim/core/browser';
import type { RuntimeEvent, Zone } from '@offisim/shared-types';
import { UNASSIGNED_ZONE_ID } from '@offisim/shared-types';
import type { OrbitControls } from '@react-three/drei';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrefabInstances } from '../../hooks/usePrefabInstances.js';
import { useSceneOrchestrator } from '../../hooks/useSceneOrchestrator.js';
import {
  buildZoneRouteWaypoints,
  elevateWaypoints,
  getMeetingZoneId,
} from '../../lib/scene-nav.js';
import type {
  SceneEmployeeEscalatedPayload,
  SceneIntentBus,
  SceneInteractionWaitingPayload,
  SceneTaskDispatchedPayload,
} from '../../runtime/scene-intents.js';
import type { AgentState } from '../../runtime/use-agent-states';
import {
  DRAG_THRESHOLD_PX,
  type DragState3D,
  type FlowLineData,
  type Zone3D,
  type Zone3DLayout,
  buildDispatchFlowLine,
  buildEmployeeToMeetingFlowLine,
  buildReportingFlowLines,
  hitTestZone3D,
  resolveEmployeeZoneDynamic,
} from './office3d-shared.js';

type OrbitControlsHandle = React.ComponentRef<typeof OrbitControls>;
export type Office3DPrefabInstance = ReturnType<typeof usePrefabInstances>['instances'][number];

interface UseOffice3DViewStateArgs {
  agents: Map<string, AgentState>;
  eventBus: EventBus;
  sceneIntentBus?: SceneIntentBus;
  activeCompanyId: string | null;
  sceneCompanyId: string;
  zones: readonly Zone[];
  zones3D: readonly Zone3D[];
  dropTargetZones3D: readonly Zone3D[];
  externalSelectedId: string | null;
  onSelectEmployee?: (id: string) => void;
  onDeselectEmployee?: () => void;
}

interface UseOffice3DViewStateResult {
  ceremony: ReturnType<typeof useSceneOrchestrator>;
  selectedEmployeeId: string | null;
  dragState: DragState3D | null;
  hoveredZoneId: string | null;
  flowLines: FlowLineData[];
  setFlowLines: React.Dispatch<React.SetStateAction<FlowLineData[]>>;
  controlsRef: React.RefObject<OrbitControlsHandle | null>;
  prefabInstances: ReturnType<typeof usePrefabInstances>['instances'];
  hasPrefabData: boolean;
  isDragging: boolean;
  zoneActivity: Record<string, { count: number; blocked: boolean }>;
  activeCount: number;
  blockedCount: number;
  handleSelectEmployee: (id: string) => void;
  handleDeselect: () => void;
  handleEmployeeDragStart: (
    empId: string,
    agent: AgentState,
    e: React.PointerEvent<Element>,
  ) => void;
  handleDragMove: (worldX: number, worldZ: number, screenX: number, screenY: number) => void;
  handleDragEnd: (worldX: number, worldZ: number) => void;
  handleDragCancel: () => void;
}

export function useOffice3DViewState({
  agents,
  eventBus,
  sceneIntentBus,
  activeCompanyId,
  sceneCompanyId,
  zones,
  zones3D,
  dropTargetZones3D,
  externalSelectedId,
  onSelectEmployee,
  onDeselectEmployee,
}: UseOffice3DViewStateArgs): UseOffice3DViewStateResult {
  const zone3DLayoutMap: Readonly<Record<string, Zone3DLayout>> = useMemo(
    () =>
      Object.fromEntries(
        zones3D.map((zone) => [zone.zoneId, { position: zone.position, size: zone.size }]),
      ),
    [zones3D],
  );

  const zone3DLayoutMapRef = useRef(zone3DLayoutMap);
  zone3DLayoutMapRef.current = zone3DLayoutMap;

  const zonesRef = useRef(zones);
  zonesRef.current = zones;

  const dropTargetZones3DRef = useRef(dropTargetZones3D);
  dropTargetZones3DRef.current = dropTargetZones3D;

  const ceremony = useSceneOrchestrator({
    companyId: sceneCompanyId,
    eventBus,
    sceneIntentBus,
    agents,
    zones,
  });

  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const selectedEmployeeId = onSelectEmployee ? externalSelectedId : localSelectedId;

  useEffect(() => {
    if (selectedEmployeeId && !agents.has(selectedEmployeeId)) {
      if (onDeselectEmployee) {
        onDeselectEmployee();
      } else {
        setLocalSelectedId(null);
      }
    }
  }, [agents, selectedEmployeeId, onDeselectEmployee]);

  const [dragState, setDragState] = useState<DragState3D | null>(null);
  const dragStateRef = useRef<DragState3D | null>(null);
  dragStateRef.current = dragState;

  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const [flowLines, setFlowLines] = useState<FlowLineData[]>([]);
  const controlsRef = useRef<OrbitControlsHandle>(null);

  const { instances: prefabInstances } = usePrefabInstances();
  const hasPrefabData = prefabInstances.length > 0;
  const isDragging = dragState?.active ?? false;

  const zoneActivity = useMemo(() => {
    const activity: Record<string, { count: number; blocked: boolean }> = {};
    for (const zone of zones3D) {
      activity[zone.zoneId] = { count: 0, blocked: false };
    }
    for (const [, agent] of agents) {
      const zoneId = resolveEmployeeZoneDynamic(agent, zones);
      if (!activity[zoneId]) {
        continue;
      }
      if (agent.state !== 'idle') {
        activity[zoneId].count++;
      }
      if (agent.state === 'blocked' || agent.state === 'failed') {
        activity[zoneId].blocked = true;
      }
    }
    return activity;
  }, [agents, zones3D, zones]);

  const activeCount = useMemo(
    () => [...agents.values()].filter((agent) => agent.state !== 'idle').length,
    [agents],
  );
  const blockedCount = useMemo(
    () =>
      [...agents.values()].filter((agent) => agent.state === 'blocked' || agent.state === 'failed')
        .length,
    [agents],
  );

  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  const appendFlowLine = useCallback((line: FlowLineData | null) => {
    if (!line) {
      return;
    }
    setFlowLines((prev) => {
      const now = Date.now();
      const cleaned = prev.filter((existing) => now - existing.createdAt < 5000);
      return [...cleaned, line].slice(-24);
    });
  }, []);

  useEffect(() => {
    setFlowLines([]);
    if (!activeCompanyId) {
      return;
    }

    const appendDispatchFlowLine = (payload: { employeeId?: string | null }) => {
      const layoutMap = zone3DLayoutMapRef.current;
      const currentZones = zonesRef.current;
      const defaultWorkspaceZoneId =
        currentZones.find((zone) => zone.archetype === 'workspace')?.zoneId ?? UNASSIGNED_ZONE_ID;
      const assignedZoneId = payload.employeeId
        ? resolveEmployeeZoneDynamic(
            agentsRef.current.get(payload.employeeId) ?? { role: 'employee' },
            currentZones,
          )
        : defaultWorkspaceZoneId;

      const meetingZone = currentZones.find((zone) => zone.archetype === 'meeting');
      const meetingLayout = meetingZone ? layoutMap[meetingZone.zoneId] : undefined;
      const fallbackZone = currentZones.find((zone) => zone.archetype === 'workspace');
      const targetLayout =
        layoutMap[assignedZoneId] ?? (fallbackZone ? layoutMap[fallbackZone.zoneId] : undefined);
      if (!meetingLayout || !targetLayout) {
        return;
      }

      appendFlowLine(
        buildDispatchFlowLine(
          meetingLayout,
          targetLayout,
          elevateWaypoints(
            buildZoneRouteWaypoints(currentZones, meetingZone?.zoneId ?? 'meeting', assignedZoneId),
          ),
        ),
      );
    };

    const unsubscribe = sceneIntentBus
      ? sceneIntentBus.on('scene.task.dispatched', (intent) => {
          appendDispatchFlowLine(intent.payload as SceneTaskDispatchedPayload);
        })
      : eventBus.on('task.state.changed', (event: RuntimeEvent) => {
          const payload = event.payload as { taskState?: string; assignedTo?: string } | undefined;
          if (payload?.taskState !== 'active') {
            return;
          }
          appendDispatchFlowLine({ employeeId: payload.assignedTo ?? null });
        });

    const handleApprovalFlowLine = (payload: SceneInteractionWaitingPayload) => {
      if (payload.kind !== 'permission_request' || !payload.employeeId) {
        return;
      }
      appendFlowLine(
        buildEmployeeToMeetingFlowLine(
          payload.employeeId,
          agentsRef.current,
          zonesRef.current,
          zone3DLayoutMapRef.current,
          'approval',
          elevateWaypoints(
            buildZoneRouteWaypoints(
              zonesRef.current,
              resolveEmployeeZoneDynamic(
                agentsRef.current.get(payload.employeeId) ?? { role: 'employee' },
                zonesRef.current,
              ),
              getMeetingZoneId(zonesRef.current),
            ),
          ),
        ),
      );
    };

    const unsubscribeInteractionWaiting = sceneIntentBus
      ? sceneIntentBus.on('scene.interaction.waiting', (intent) =>
          handleApprovalFlowLine(intent.payload as SceneInteractionWaitingPayload),
        )
      : (() => {
          const offRequested = eventBus.on('interaction.requested', (event: RuntimeEvent) => {
            const payload = event.payload as { request?: { kind?: string; employeeId?: string } };
            if (!payload.request?.kind) {
              return;
            }
            handleApprovalFlowLine({
              kind: payload.request.kind as SceneInteractionWaitingPayload['kind'],
              employeeId: payload.request.employeeId ?? null,
              restored: false,
            });
          });
          const offRestored = eventBus.on('interaction.restored', (event: RuntimeEvent) => {
            const payload = event.payload as { request?: { kind?: string; employeeId?: string } };
            if (!payload.request?.kind) {
              return;
            }
            handleApprovalFlowLine({
              kind: payload.request.kind as SceneInteractionWaitingPayload['kind'],
              employeeId: payload.request.employeeId ?? null,
              restored: true,
            });
          });
          return () => {
            offRequested();
            offRestored();
          };
        })();

    const appendBlockedFlowLine = (payload: SceneEmployeeEscalatedPayload) => {
      appendFlowLine(
        buildEmployeeToMeetingFlowLine(
          payload.employeeId,
          agentsRef.current,
          zonesRef.current,
          zone3DLayoutMapRef.current,
          'blocked',
          elevateWaypoints(
            buildZoneRouteWaypoints(
              zonesRef.current,
              resolveEmployeeZoneDynamic(
                agentsRef.current.get(payload.employeeId) ?? { role: 'employee' },
                zonesRef.current,
              ),
              getMeetingZoneId(zonesRef.current),
            ),
          ),
        ),
      );
    };

    const unsubscribeEmployeeState = sceneIntentBus
      ? sceneIntentBus.on('scene.employee.escalated', (intent) => {
          appendBlockedFlowLine(intent.payload as SceneEmployeeEscalatedPayload);
        })
      : eventBus.on('employee.state.changed', (event: RuntimeEvent) => {
          const payload = event.payload as { employeeId?: string; next?: string } | undefined;
          if (!payload?.employeeId || (payload.next !== 'blocked' && payload.next !== 'failed')) {
            return;
          }
          appendBlockedFlowLine({
            employeeId: payload.employeeId,
            next: payload.next,
          });
        });

    const appendReportingFlowLines = () => {
      for (const line of buildReportingFlowLines(
        agentsRef.current,
        zonesRef.current,
        zone3DLayoutMapRef.current,
      )) {
        appendFlowLine(line);
      }
    };

    const unsubscribeNodeEntered = sceneIntentBus
      ? sceneIntentBus.on('scene.reporting.started', (_intent) => {
          appendReportingFlowLines();
        })
      : eventBus.on('graph.node.entered', (event: RuntimeEvent) => {
          const payload = event.payload as { nodeName?: string } | undefined;
          if (payload?.nodeName !== 'boss_summary') {
            return;
          }
          appendReportingFlowLines();
        });

    return () => {
      unsubscribe();
      unsubscribeInteractionWaiting();
      unsubscribeEmployeeState();
      unsubscribeNodeEntered();
    };
  }, [eventBus, sceneIntentBus, activeCompanyId, appendFlowLine]);

  const handleSelectEmployee = useCallback(
    (id: string) => {
      if (onSelectEmployee) {
        onSelectEmployee(id);
      } else {
        setLocalSelectedId(id);
      }
      if (activeCompanyId) {
        eventBus.emit({
          type: 'scene.employee.selected',
          entityId: id,
          entityType: 'employee',
          companyId: activeCompanyId,
          timestamp: Date.now(),
          payload: { employeeId: id, source: 'scene' },
        });
      }
    },
    [activeCompanyId, eventBus, onSelectEmployee],
  );

  const handleDeselect = useCallback(() => {
    if (onDeselectEmployee) {
      onDeselectEmployee();
    } else {
      setLocalSelectedId(null);
    }
    if (activeCompanyId) {
      eventBus.emit({
        type: 'ui.selection.changed',
        entityId: '',
        entityType: 'employee',
        companyId: activeCompanyId,
        timestamp: Date.now(),
        payload: { entityId: null, source: 'scene' },
      });
    }
  }, [activeCompanyId, eventBus, onDeselectEmployee]);

  const handleEmployeeDragStart = useCallback(
    (empId: string, agent: AgentState, e: React.PointerEvent<Element>) => {
      const nativeEvent = e as unknown as PointerEvent;
      if (nativeEvent.button !== 0) {
        return;
      }
      const zoneId = resolveEmployeeZoneDynamic(agent, zonesRef.current);
      setDragState({
        employeeId: empId,
        sourceZoneId: zoneId,
        active: false,
        position: [0, 0, 0],
        startScreenX: nativeEvent.clientX,
        startScreenY: nativeEvent.clientY,
      });
    },
    [],
  );

  const handleDragMove = useCallback(
    (worldX: number, worldZ: number, screenX: number, screenY: number) => {
      setDragState((prev) => {
        if (!prev) {
          return null;
        }
        const dx = screenX - prev.startScreenX;
        const dy = screenY - prev.startScreenY;
        const active = prev.active || Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD_PX;
        return {
          ...prev,
          active,
          position: [worldX, 0, worldZ],
        };
      });

      const zone = hitTestZone3D(worldX, worldZ, dropTargetZones3DRef.current);
      setHoveredZoneId(zone?.zoneId ?? null);
    },
    [],
  );

  const handleDragEnd = useCallback(
    (worldX: number, worldZ: number) => {
      const currentDragState = dragStateRef.current;
      if (!currentDragState) {
        return;
      }

      if (currentDragState.active) {
        const targetZone = hitTestZone3D(worldX, worldZ, dropTargetZones3DRef.current);
        if (activeCompanyId && targetZone && targetZone.zoneId !== currentDragState.sourceZoneId) {
          eventBus.emit({
            type: 'employee.workstation.drop-requested',
            entityId: currentDragState.employeeId,
            entityType: 'employee',
            companyId: activeCompanyId,
            timestamp: Date.now(),
            payload: {
              employeeId: currentDragState.employeeId,
              targetWorkstationId: targetZone.zoneId,
            },
          });
        }
      } else {
        handleSelectEmployee(currentDragState.employeeId);
      }

      setDragState(null);
      setHoveredZoneId(null);
      document.body.style.cursor = 'default';
    },
    [activeCompanyId, eventBus, handleSelectEmployee],
  );

  const handleDragCancel = useCallback(() => {
    setDragState(null);
    setHoveredZoneId(null);
    document.body.style.cursor = 'default';
  }, []);

  return {
    ceremony,
    selectedEmployeeId,
    dragState,
    hoveredZoneId,
    flowLines,
    setFlowLines,
    controlsRef,
    prefabInstances,
    hasPrefabData,
    isDragging,
    zoneActivity,
    activeCount,
    blockedCount,
    handleSelectEmployee,
    handleDeselect,
    handleEmployeeDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  };
}
