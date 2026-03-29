import { Environment, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useMemo } from 'react';
import type { CeremonyState } from '../../hooks/useSceneOrchestrator.js';
import { useCompanyZones } from '../../hooks/useCompanyZones.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import type { AgentState } from '../../runtime/use-agent-states';
import { useCompany } from '../company/CompanyContext.js';
import { getOffice3DPerformanceConfig } from './scene-performance-config.js';
import { shouldAnimateOfficeScene } from './scene-render-policy.js';
import { SceneFrameLoopController } from './SceneFrameLoopController.js';
import { useOffice3DViewState } from './useOffice3DViewState.js';
import type { Office3DPrefabInstance } from './useOffice3DViewState.js';
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

type OrbitControlsHandle = React.ComponentRef<typeof OrbitControls>;

interface Office3DViewProps {
  active?: boolean;
  selectedEmployeeId?: string | null;
  onSelectEmployee?: (id: string) => void;
  onDeselectEmployee?: () => void;
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
}

export default function Office3DView({
  active = true,
  selectedEmployeeId: externalSelectedId = null,
  onSelectEmployee,
  onDeselectEmployee,
}: Office3DViewProps) {
  const agents = useAgentStates();
  const { eventBus } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const sceneCompanyId = activeCompanyId ?? 'default-scene-company';
  const { zones } = useCompanyZones();

  const zones3D: Zone3D[] = useMemo(
    () => zones.map((zone) => ({ ...zone, ...toZone3DLayout(zone) })),
    [zones],
  );
  const dropTargetZones3D: Zone3D[] = useMemo(
    () => zones3D.filter((zone) => zone.deskSlots > 0),
    [zones3D],
  );
  const placed = usePlacedEmployees(agents, zones3D, zones);

  const {
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
  } = useOffice3DViewState({
    agents,
    eventBus,
    activeCompanyId,
    sceneCompanyId,
    zones,
    zones3D,
    dropTargetZones3D,
    externalSelectedId,
    onSelectEmployee,
    onDeselectEmployee,
  });

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
  };

  const controls: Office3DSceneControls = {
    controlsRef,
    shouldAnimate:
      active &&
      shouldAnimateOfficeScene({
        activeCount,
        blockedCount,
        isDragging,
        flowLineCount: flowLines.length,
        ceremonyPhase: ceremony.phase,
      }),
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
    />
  );
}

function Office3DViewInner({
  scene,
  ui,
  controls,
  actions,
}: Office3DViewInnerProps) {
  const {
    agents,
    placed,
    zones3D,
    hasPrefabData,
    prefabInstances,
    zoneActivity,
    ceremony,
  } = scene;
  const {
    selectedEmployeeId,
    isDragging,
    dragState,
    hoveredZoneId,
    flowLines,
    activeCount,
    blockedCount,
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
        />

        <Office3DFurnitureLayer
          hasPrefabData={hasPrefabData}
          prefabInstances={prefabInstances}
        />

        <Office3DEmployeeLayer
          placed={placed}
          selectedEmployeeId={selectedEmployeeId}
          isDragging={isDragging}
          dragState={dragState}
          handleSelectEmployee={handleSelectEmployee}
          handleEmployeeDragStart={handleEmployeeDragStart}
        />

        <Office3DMeetingLayer ceremony={ceremony} />

        <Office3DFlowLayer flowLines={flowLines} setFlowLines={setFlowLines} />

        <Office3DSceneHud activeCount={activeCount} blockedCount={blockedCount} />

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
