import { Html } from '@react-three/drei';
import type { AgentState } from '../../runtime/use-agent-states';
import { MeetingBubble3D } from './MeetingBubble3D.js';
import { EmployeeMarker, type PlacedEmployee } from './office3d-employees.js';
import { TaskFlowLine, ZoneLabel } from './office3d-scene-primitives.js';
import type { DragState3D, FlowLineData, Zone3D } from './office3d-shared.js';
import {
  BookshelfMesh3D,
  MeetingTableMesh3D,
  PlantMesh3D,
  RestAreaMesh3D,
  ServerRackMesh3D,
  WorkstationMesh3D,
} from './prefabs/index.js';
import { Prefab3D } from './prefabs/index.js';
import type { Office3DPrefabInstance } from './useOffice3DViewState.js';

const FALLBACK_FURNITURE = [
  { Component: MeetingTableMesh3D, position: [-10, 0, -8] as [number, number, number] },
  { Component: ServerRackMesh3D, position: [8, 0, -8] as [number, number, number] },
  { Component: BookshelfMesh3D, position: [-10, 0, 2] as [number, number, number] },
  { Component: RestAreaMesh3D, position: [8, 0, 2] as [number, number, number] },
  { Component: WorkstationMesh3D, position: [-13, 0, 11] as [number, number, number] },
  { Component: WorkstationMesh3D, position: [0, 0, 11] as [number, number, number] },
  { Component: WorkstationMesh3D, position: [12, 0, 11] as [number, number, number] },
  { Component: PlantMesh3D, position: [-18, 0, -13] as [number, number, number] },
  { Component: PlantMesh3D, position: [-18, 0, 13] as [number, number, number] },
  { Component: PlantMesh3D, position: [18, 0, -13] as [number, number, number] },
  { Component: PlantMesh3D, position: [18, 0, 13] as [number, number, number] },
  { Component: PlantMesh3D, position: [0, 0, 13] as [number, number, number] },
];

export function Office3DZoneLayer({
  zones3D,
  zoneActivity,
  isDragging,
  hoveredZoneId,
  dragState,
}: {
  zones3D: readonly Zone3D[];
  zoneActivity: Record<string, { count: number; blocked: boolean }>;
  isDragging: boolean;
  hoveredZoneId: string | null;
  dragState: DragState3D | null;
}) {
  return (
    <>
      {zones3D.map((zone) => (
        <ZoneLabel
          key={zone.zoneId}
          position={zone.position}
          size={zone.size}
          color={zone.accentColor}
          name={zone.label}
          isDragging={isDragging && zone.deskSlots > 0}
          isHovered={hoveredZoneId === zone.zoneId}
          isSource={isDragging ? dragState?.sourceZoneId === zone.zoneId : false}
          activityCount={zoneActivity[zone.zoneId]?.count ?? 0}
          hasBlocked={zoneActivity[zone.zoneId]?.blocked ?? false}
          isMeetingActive={
            zone.archetype === 'meeting' && (zoneActivity[zone.zoneId]?.count ?? 0) > 0
          }
        />
      ))}
    </>
  );
}

export function Office3DFurnitureLayer({
  hasPrefabData,
  prefabInstances,
}: {
  hasPrefabData: boolean;
  prefabInstances: Office3DPrefabInstance[];
}) {
  if (hasPrefabData) {
    return (
      <>
        {prefabInstances.map(({ instance, definition }) => (
          <Prefab3D
            key={instance.instance_id}
            definition={definition}
            position={[instance.position_x, 0, instance.position_y]}
            rotation={instance.rotation}
          />
        ))}
      </>
    );
  }

  return (
    <>
      {FALLBACK_FURNITURE.map(({ Component, position }, index) => (
        <Component key={`${Component.name}-${index}`} position={position} />
      ))}
    </>
  );
}

export function Office3DEmployeeLayer({
  placed,
  selectedEmployeeId,
  isDragging,
  dragState,
  handleSelectEmployee,
  handleEmployeeDragStart,
}: {
  placed: PlacedEmployee[];
  selectedEmployeeId: string | null;
  isDragging: boolean;
  dragState: DragState3D | null;
  handleSelectEmployee: (id: string) => void;
  handleEmployeeDragStart: (
    empId: string,
    agent: AgentState,
    e: React.PointerEvent<Element>,
  ) => void;
}) {
  return (
    <>
      {placed.map((employee) => (
        <EmployeeMarker
          key={employee.id}
          emp={employee}
          isSelected={selectedEmployeeId === employee.id}
          isDragSource={isDragging && dragState?.employeeId === employee.id}
          onSelect={handleSelectEmployee}
          onDragStart={handleEmployeeDragStart}
        />
      ))}
    </>
  );
}

export function Office3DMeetingLayer({
  ceremony,
}: {
  ceremony: import('../../hooks/useSceneOrchestrator').CeremonyState;
}) {
  return <MeetingBubble3D ceremony={ceremony} />;
}

export function Office3DFlowLayer({
  flowLines,
  setFlowLines,
}: {
  flowLines: FlowLineData[];
  setFlowLines: React.Dispatch<React.SetStateAction<FlowLineData[]>>;
}) {
  return (
    <>
      {flowLines.map((line) => (
        <TaskFlowLine
          key={line.id}
          from={line.from}
          to={line.to}
          color={line.variant === 'handoff' ? '#f97316' : '#60a5fa'}
          onComplete={() => setFlowLines((prev) => prev.filter((entry) => entry.id !== line.id))}
        />
      ))}
    </>
  );
}

export function Office3DSceneHud({
  activeCount,
  blockedCount,
}: {
  activeCount: number;
  blockedCount: number;
}) {
  return (
    <Html position={[18, 14, 0]} center style={{ pointerEvents: 'none' }}>
      <div
        style={{
          fontSize: '10px',
          fontFamily: 'monospace',
          color: 'rgba(255,255,255,0.6)',
          background: 'rgba(0,0,0,0.4)',
          borderRadius: '8px',
          padding: '4px 8px',
          backdropFilter: 'blur(4px)',
          whiteSpace: 'nowrap',
        }}
      >
        <div>{activeCount} active</div>
        {blockedCount > 0 && <div style={{ color: '#fbbf24' }}>{blockedCount} blocked</div>}
      </div>
    </Html>
  );
}
