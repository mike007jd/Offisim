import type { RoleSlug, Zone } from '@offisim/shared-types';
import { isInsideZone, resolveZoneForRole } from '@offisim/shared-types';
import { Environment, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCompanyZones } from '../../hooks/useCompanyZones.js';
import {
  type CeremonyState,
  getMovementDebugInfo,
  getMovementHandle,
} from '../../hooks/useSceneOrchestrator.js';
import {
  buildDispatchRoute,
  buildReturnToMeetingRoute,
  moveThroughPoints,
} from '../../lib/scene-behavior';
import { buildZoneRouteWaypoints, getMeetingZoneId } from '../../lib/scene-nav';
import { SeatRegistry } from '../../lib/seat-registry.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import type { AgentState } from '../../runtime/use-agent-states';
import { useCompany } from '../company/CompanyContext.js';
import { SceneFrameLoopController } from './SceneFrameLoopController.js';
import { type PlacedEmployee, usePlacedEmployees } from './office3d-employees.js';
import {
  AmbientStateLight,
  DragController,
  DragGhost3D,
  RoomShell,
} from './office3d-scene-primitives.js';
import {
  Office3DEmployeeLayer,
  Office3DFlowLayer,
  Office3DFurnitureLayer,
  Office3DManagerLayer,
  Office3DMeetingLayer,
  Office3DSceneHud,
  Office3DZoneLayer,
} from './office3d-sections.js';
import {
  type DragState3D,
  type FlowLineData,
  type Zone3D,
  toZone3DLayout,
} from './office3d-shared.js';
import { getOffice3DPerformanceConfig } from './scene-performance-config.js';
import { shouldAnimateOfficeScene } from './scene-render-policy.js';
import { useOffice3DViewState } from './useOffice3DViewState.js';
import type { Office3DPrefabInstance } from './useOffice3DViewState.js';

type OrbitControlsHandle = React.ComponentRef<typeof OrbitControls>;

interface Office3DViewProps {
  active?: boolean;
  ceremony: CeremonyState;
  leftInset?: number;
  rightInset?: number;
  selectedEmployeeId?: string | null;
  onSelectEmployee?: (id: string) => void;
  onDeselectEmployee?: () => void;
  renderEmployeeBadge?: (employeeId: string) => React.ReactNode;
}

interface Office3DSceneData {
  agents: Map<string, AgentState>;
  placed: PlacedEmployee[];
  zones3D: readonly Zone3D[];
  hasPrefabData: boolean;
  prefabInstances: Office3DPrefabInstance[];
  zoneActivity: Record<string, { count: number; blocked: boolean }>;
  ceremony: CeremonyState;
}

interface Office3DSceneUiState {
  selectedEmployeeId: string | null;
  isDragging: boolean;
  dragState: DragState3D | null;
  hoveredZoneId: string | null;
  flowLines: FlowLineData[];
  activeCount: number;
  blockedCount: number;
  viewportInsets: {
    left: number;
    right: number;
  };
}

interface Office3DSceneControls {
  controlsRef: React.RefObject<OrbitControlsHandle | null>;
  shouldAnimate: boolean;
}

interface Office3DSceneActions {
  setFlowLines: React.Dispatch<React.SetStateAction<FlowLineData[]>>;
  handleDeselect: () => void;
  handleSelectEmployee: (id: string) => void;
  handleEmployeeDragStart: (
    empId: string,
    agent: AgentState,
    e: React.PointerEvent<Element>,
  ) => void;
  handleDragMove: (worldX: number, worldZ: number, screenX: number, screenY: number) => void;
  handleDragEnd: (worldX: number, worldZ: number) => void;
  handleDragCancel: () => void;
}

interface Office3DViewInnerProps {
  scene: Office3DSceneData;
  ui: Office3DSceneUiState;
  controls: Office3DSceneControls;
  actions: Office3DSceneActions;
  renderEmployeeBadge?: (employeeId: string) => React.ReactNode;
}

export default function Office3DView({
  active = true,
  ceremony,
  leftInset = 0,
  rightInset = 0,
  selectedEmployeeId: externalSelectedId = null,
  onSelectEmployee,
  onDeselectEmployee,
  renderEmployeeBadge,
}: Office3DViewProps) {
  const agents = useAgentStates();
  const { eventBus, sceneIntentBus } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const { zones } = useCompanyZones();

  const zones3D: Zone3D[] = useMemo(
    () => zones.map((zone) => ({ ...zone, ...toZone3DLayout(zone) })),
    [zones],
  );
  const dropTargetZones3D: Zone3D[] = useMemo(
    () => zones3D.filter((zone) => zone.deskSlots > 0),
    [zones3D],
  );

  const {
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
  } = useOffice3DViewState({
    agents,
    eventBus,
    sceneIntentBus,
    ceremony,
    activeCompanyId,
    zones,
    zones3D,
    dropTargetZones3D,
    externalSelectedId,
    onSelectEmployee,
    onDeselectEmployee,
  });

  const [debugMotionActive, setDebugMotionActive] = useState(false);
  const debugMotionTimerRef = useRef<number | null>(null);
  const armDebugMotion = useCallback(() => {
    setDebugMotionActive(true);
    if (typeof window === 'undefined') return;
    if (debugMotionTimerRef.current !== null) {
      window.clearTimeout(debugMotionTimerRef.current);
    }
    debugMotionTimerRef.current = window.setTimeout(() => {
      debugMotionTimerRef.current = null;
      setDebugMotionActive(false);
    }, 30000);
  }, []);

  useEffect(
    () => () => {
      if (typeof window !== 'undefined' && debugMotionTimerRef.current !== null) {
        window.clearTimeout(debugMotionTimerRef.current);
      }
    },
    [],
  );

  const seatRegistry = useMemo(
    () =>
      SeatRegistry.build(
        prefabInstances.map((p) => p.instance),
        zones,
      ),
    [prefabInstances, zones],
  );

  const placed = usePlacedEmployees(agents, zones3D, zones, seatRegistry);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined' || !window.__OFFISIM_DEBUG__) {
      return;
    }

    const previous = window.__OFFISIM_DEBUG__;
    const obstacleFootprints = seatRegistry.getObstacleFootprints();
    let lastRoute: {
      employeeId: string;
      kind: string;
      points: [number, number, number][];
    } | null = null;
    const buildMeetingStagingTarget = (zone: Zone): [number, number, number] => [
      zone.cx - zone.w / 2 + 1,
      0,
      zone.cz - zone.d / 2 + 0.5,
    ];
    const findZoneById = (zoneId: string | null) =>
      zoneId ? (zones.find((zone) => zone.zoneId === zoneId) ?? null) : null;
    const findPlacedEmployee = (employeeId: string) =>
      placed.find((entry) => entry.id === employeeId) ?? null;
    const findCurrentPosition = (employeeId: string): [number, number, number] | null => {
      const live = activeCompanyId
        ? getMovementHandle(activeCompanyId, employeeId)?.getPosition()
        : null;
      if (live) return live;
      const employee = findPlacedEmployee(employeeId);
      return employee ? [...employee.position] : null;
    };
    const findZoneIdForPosition = (position: readonly [number, number, number]): string | null =>
      zones.find((zone) => isInsideZone(position[0], position[2], zone))?.zoneId ?? null;
    const rememberRoute = (
      employeeId: string,
      kind: 'dispatch' | 'return-to-meeting',
      route: readonly [number, number, number][],
    ) => {
      lastRoute = {
        employeeId,
        kind,
        points: route.map((point) => [...point] as [number, number, number]),
      };
    };
    const getWorkspaceSeatTargets = (zone: Zone) => {
      const seat = seatRegistry.getSeat(zone.zoneId, 0);
      if (!seat) {
        const fallback: [number, number, number] = [zone.cx, 0, zone.cz];
        return {
          seat: fallback,
          approach: fallback,
        };
      }
      return {
        seat: [...seat.position] as [number, number, number],
        approach: [...seat.approachPosition] as [number, number, number],
      };
    };
    const moveEmployeeToMeeting = (employeeId: string) => {
      if (!activeCompanyId) return false;
      const handle = getMovementHandle(activeCompanyId, employeeId);
      const meetingZone = zones.find((zone) => zone.zoneId === getMeetingZoneId(zones));
      if (!handle || !meetingZone) return false;
      const target = buildMeetingStagingTarget(meetingZone);
      handle.stop();
      handle.teleportTo?.(target);
      return true;
    };
    const dispatchEmployeeToWorkspace = (employeeId: string) => {
      if (!activeCompanyId) return false;
      const handle = getMovementHandle(activeCompanyId, employeeId);
      const current = findCurrentPosition(employeeId);
      const employee = findPlacedEmployee(employeeId);
      const role = employee?.agent.role;
      const targetZone = role ? resolveZoneForRole(role as RoleSlug, zones) : null;
      if (!handle || !current || !targetZone) return false;
      const target = getWorkspaceSeatTargets(targetZone);
      const route = buildDispatchRoute(current, [targetZone.cx, 0, targetZone.cz], target.seat, {
        zoneWaypoints: buildZoneRouteWaypoints(zones, getMeetingZoneId(zones), targetZone.zoneId),
        obstacleFootprints,
        terminalApproach: target.approach,
      });
      rememberRoute(employeeId, 'dispatch', route);
      armDebugMotion();
      moveThroughPoints(handle, route, 8);
      return true;
    };
    const returnEmployeeToMeeting = (employeeId: string) => {
      if (!activeCompanyId) return false;
      const handle = getMovementHandle(activeCompanyId, employeeId);
      const current = findCurrentPosition(employeeId);
      const currentZoneId = current ? findZoneIdForPosition(current) : null;
      const meetingZoneId = getMeetingZoneId(zones);
      const meetingZone = findZoneById(meetingZoneId);
      if (!handle || !current || !meetingZone) return false;
      const target = buildMeetingStagingTarget(meetingZone);
      const currentZone = findZoneById(currentZoneId);
      const departureApproach =
        currentZone && currentZone.zoneId !== meetingZoneId
          ? getWorkspaceSeatTargets(currentZone).approach
          : undefined;
      const route = buildReturnToMeetingRoute(
        current,
        [meetingZone.cx, 0, meetingZone.cz],
        target,
        {
          departureApproach,
          zoneWaypoints:
            currentZone && currentZone.zoneId !== meetingZoneId
              ? buildZoneRouteWaypoints(zones, currentZone.zoneId, meetingZoneId)
              : [],
          obstacleFootprints,
        },
      );
      rememberRoute(employeeId, 'return-to-meeting', route);
      armDebugMotion();
      moveThroughPoints(handle, route, 8);
      return true;
    };
    const getSceneState = () => {
      const fallback = previous.getSceneState?.() ?? {
        employeeCount: placed.length,
        employeeIds: placed.map((employee) => employee.id),
      };
      const positionsById = new Map(
        (activeCompanyId ? getMovementDebugInfo(activeCompanyId) : []).map((entry) => [
          entry.id,
          entry,
        ]),
      );

      return {
        ...fallback,
        employeeCount: placed.length,
        employeeIds: placed.map((employee) => employee.id),
        employeeDebugInfo: placed.map((employee) => {
          const debugPosition = positionsById.get(employee.id);
          return {
            id: employee.id,
            x: debugPosition?.x ?? employee.position[0],
            y: debugPosition?.y ?? employee.position[2],
            roleSlug: employee.agent.role,
            isMoving: debugPosition?.isMoving ?? false,
          };
        }),
        obstacleFootprints: seatRegistry.getObstacleFootprints().map((footprint) => ({
          cx: footprint.cx,
          cz: footprint.cz,
          halfW: footprint.halfW,
          halfD: footprint.halfD,
        })),
        zones: zones.map((zone) => ({
          zoneId: zone.zoneId,
          archetype: zone.archetype,
          cx: zone.cx,
          cz: zone.cz,
          w: zone.w,
          d: zone.d,
        })),
        lastRoute,
      };
    };

    window.__OFFISIM_DEBUG__ = {
      ...previous,
      sceneActions: {
        moveEmployeeToMeeting,
        dispatchEmployeeToWorkspace,
        returnEmployeeToMeeting,
      },
      getSceneState,
    };

    return () => {
      if (window.__OFFISIM_DEBUG__?.getSceneState === getSceneState) {
        window.__OFFISIM_DEBUG__ = {
          ...window.__OFFISIM_DEBUG__,
          getSceneState: previous.getSceneState,
        };
      }
    };
  }, [activeCompanyId, armDebugMotion, placed, seatRegistry, zones]);

  const scene: Office3DSceneData = {
    agents,
    placed,
    zones3D,
    hasPrefabData,
    prefabInstances,
    zoneActivity,
    ceremony,
  };

  const ui: Office3DSceneUiState = {
    selectedEmployeeId,
    isDragging,
    dragState,
    hoveredZoneId,
    flowLines,
    activeCount,
    blockedCount,
    viewportInsets: { left: leftInset, right: rightInset },
  };

  const controls: Office3DSceneControls = {
    controlsRef,
    shouldAnimate:
      active &&
      (debugMotionActive ||
        shouldAnimateOfficeScene({
          activeCount,
          blockedCount,
          isDragging,
          flowLineCount: flowLines.length,
          ceremonyPhase: ceremony.phase,
        })),
  };

  const actions: Office3DSceneActions = {
    setFlowLines,
    handleDeselect,
    handleSelectEmployee,
    handleEmployeeDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  };

  return (
    <Office3DViewInner
      scene={scene}
      ui={ui}
      controls={controls}
      actions={actions}
      renderEmployeeBadge={renderEmployeeBadge}
    />
  );
}

function Office3DViewInner({
  scene,
  ui,
  controls,
  actions,
  renderEmployeeBadge,
}: Office3DViewInnerProps) {
  const { agents, placed, zones3D, hasPrefabData, prefabInstances, zoneActivity, ceremony } = scene;
  const {
    selectedEmployeeId,
    isDragging,
    dragState,
    hoveredZoneId,
    flowLines,
    activeCount,
    blockedCount,
    viewportInsets,
  } = ui;
  const { controlsRef, shouldAnimate } = controls;
  const perfConfig = getOffice3DPerformanceConfig(import.meta.env.DEV);
  const {
    setFlowLines,
    handleDeselect,
    handleSelectEmployee,
    handleEmployeeDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  } = actions;

  return (
    <div
      className="w-full h-full bg-slate-950"
      style={{ position: 'relative', cursor: isDragging ? 'grabbing' : undefined }}
    >
      <Canvas
        dpr={perfConfig.dpr}
        frameloop={shouldAnimate ? 'always' : 'demand'}
        shadows={perfConfig.shadows}
        camera={{ position: [0, 22, 28], fov: 45 }}
      >
        <SceneFrameLoopController animate={shouldAnimate} controlsRef={controlsRef} />
        <color attach="background" args={['#020617']} />
        <fog attach="fog" args={['#020617', 40, 100]} />

        <AmbientStateLight agents={agents} />
        <directionalLight
          castShadow
          position={[12, 25, 12]}
          intensity={1.5}
          shadow-mapSize={perfConfig.shadowMapSize}
          shadow-bias={-0.0005}
          shadow-camera-left={-25}
          shadow-camera-right={25}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
        />
        <pointLight position={[-15, 12, -10]} intensity={0.4} color="#3b82f6" />
        <pointLight position={[15, 8, 10]} intensity={0.3} color="#06b6d4" />
        {perfConfig.environmentPreset && <Environment preset={perfConfig.environmentPreset} />}

        <RoomShell onFloorClick={handleDeselect} />

        <Office3DZoneLayer
          zones3D={zones3D}
          zoneActivity={zoneActivity}
          isDragging={isDragging}
          hoveredZoneId={hoveredZoneId}
          dragState={dragState}
          viewportInsets={viewportInsets}
        />

        <Office3DFurnitureLayer hasPrefabData={hasPrefabData} prefabInstances={prefabInstances} />

        <Office3DEmployeeLayer
          placed={placed}
          selectedEmployeeId={selectedEmployeeId}
          isDragging={isDragging}
          dragState={dragState}
          handleSelectEmployee={handleSelectEmployee}
          handleEmployeeDragStart={handleEmployeeDragStart}
          renderEmployeeBadge={renderEmployeeBadge}
        />

        <Office3DMeetingLayer ceremony={ceremony} />
        <Office3DManagerLayer ceremony={ceremony} />

        <Office3DFlowLayer flowLines={flowLines} setFlowLines={setFlowLines} />

        <Office3DSceneHud
          activeCount={activeCount}
          blockedCount={blockedCount}
          ceremonyPhase={ceremony.phase}
        />

        {isDragging && dragState && <DragGhost3D position={dragState.position} />}

        <DragController
          dragState={dragState}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          controlsRef={controlsRef}
        />

        <OrbitControls
          ref={controlsRef}
          makeDefault
          minPolarAngle={0}
          maxPolarAngle={Math.PI / 2 - 0.1}
          minDistance={5}
          maxDistance={45}
          target={[0, 0, 2]}
        />
      </Canvas>
    </div>
  );
}
