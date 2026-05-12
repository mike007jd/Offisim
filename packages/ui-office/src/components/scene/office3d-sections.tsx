import { DARK_SEMANTIC_COLORS } from '@offisim/ui-core/tokens';
import { Html } from '@react-three/drei';
import { useRef } from 'react';
import { CEREMONY_LABELS } from '../../lib/ceremony-labels';
import type { EmployeePerformanceCueMap } from '../../runtime/employee-performance-cues.js';
import type { AgentState } from '../../runtime/use-agent-states';
import { ManagerPresence3D } from './ManagerPresence3D.js';
import { MeetingBubble3D } from './MeetingBubble3D.js';
import { EmployeeMarker, type PlacedEmployee } from './office3d-employees.js';
import {
  TaskFlowLine,
  ZoneLabel,
  createLabelLayoutAccumulator,
} from './office3d-scene-primitives.js';
import {
  type DragState3D,
  type FlowLineData,
  type Zone3D,
  getFlowLineColor,
  getFlowLineVariantLabel,
} from './office3d-shared.js';
import {
  BookshelfMesh3D,
  CoffeeTableMesh3D,
  MeetingTableMesh3D,
  PlantMesh3D,
  RestAreaMesh3D,
  ServerRackMesh3D,
  VendingMachineMesh3D,
  WaterCoolerMesh3D,
  WhiteboardMesh3D,
  WorkstationMesh3D,
} from './prefabs/index.js';
import { Prefab3D } from './prefabs/index.js';
import type { Office3DPrefabInstance } from './useOffice3DViewState.js';

const FALLBACK_FURNITURE = [
  { Component: MeetingTableMesh3D, position: [-10, 0, -8] as [number, number, number] },
  { Component: WhiteboardMesh3D, position: [-10, 0, -11] as [number, number, number] },
  { Component: ServerRackMesh3D, position: [8, 0, -8] as [number, number, number] },
  { Component: BookshelfMesh3D, position: [-10, 0, 2] as [number, number, number] },
  { Component: RestAreaMesh3D, position: [8, 0, 2] as [number, number, number] },
  { Component: CoffeeTableMesh3D, position: [11, 0, 1] as [number, number, number] },
  { Component: VendingMachineMesh3D, position: [14, 0, 0] as [number, number, number] },
  { Component: WaterCoolerMesh3D, position: [14, 0, 3.3] as [number, number, number] },
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
  viewportInsets,
}: {
  zones3D: readonly Zone3D[];
  zoneActivity: Record<string, { count: number; blocked: boolean }>;
  isDragging: boolean;
  hoveredZoneId: string | null;
  dragState: DragState3D | null;
  viewportInsets: {
    left: number;
    right: number;
  };
}) {
  const labelLayoutAccumulator = useRef(createLabelLayoutAccumulator()).current;
  return (
    <>
      {zones3D.map((zone, index) => (
        <ZoneLabel
          key={zone.zoneId || `zone-${index}`}
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
          viewportInsets={viewportInsets}
          labelLayoutIndex={index}
          labelLayoutCount={zones3D.length}
          labelLayoutAccumulator={labelLayoutAccumulator}
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
        {prefabInstances.map(({ instance, definition }, index) => (
          <Prefab3D
            key={instance.instance_id || `${instance.prefab_id}-${index}`}
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
  employeePerformanceCues,
  renderEmployeeBadge,
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
  employeePerformanceCues: EmployeePerformanceCueMap;
  renderEmployeeBadge?: (employeeId: string) => React.ReactNode;
}) {
  return (
    <>
      {placed.map((employee, index) => (
        <EmployeeMarker
          key={employee.id || `employee-${index}`}
          emp={employee}
          isSelected={selectedEmployeeId === employee.id}
          isDragSource={isDragging && dragState?.employeeId === employee.id}
          onSelect={handleSelectEmployee}
          onDragStart={handleEmployeeDragStart}
          performanceCue={employeePerformanceCues.get(employee.id) ?? null}
          badge={renderEmployeeBadge?.(employee.id)}
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

export function Office3DManagerLayer({
  ceremony,
}: {
  ceremony: import('../../hooks/useSceneOrchestrator').CeremonyState;
}) {
  return (
    <ManagerPresence3D visible={ceremony.managerVisible} position={ceremony.managerPosition} />
  );
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
      {flowLines.map((line, index) => {
        const label = getFlowLineVariantLabel(line.variant);
        const labelPoint = getFlowLineLabelPoint(line.points);
        return (
          <group key={line.id || `flow-${index}`}>
            <TaskFlowLine
              points={line.points}
              color={getFlowLineColor(line.variant)}
              onComplete={() =>
                setFlowLines((prev) => prev.filter((entry) => entry.id !== line.id))
              }
            />
            {label && labelPoint && (
              <Html position={labelPoint} center style={{ pointerEvents: 'none' }}>
                <div
                  style={{
                    borderRadius: '9999px',
                    background: 'rgba(2,6,23,0.72)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: 'rgba(255,255,255,0.85)',
                    fontSize: '8px',
                    fontFamily: 'monospace',
                    padding: '2px 6px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
}

export function Office3DSceneHud({
  activeCount,
  blockedCount,
  ceremonyPhase,
}: {
  activeCount: number;
  blockedCount: number;
  ceremonyPhase: import('../../hooks/useSceneOrchestrator').CeremonyPhase;
}) {
  const ceremonyLabel = CEREMONY_LABELS[ceremonyPhase];
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
        {ceremonyLabel && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '4px',
              color: ceremonyLabel.color,
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '9999px',
                background: ceremonyLabel.color,
                boxShadow: `0 0 8px ${ceremonyLabel.color}`,
              }}
            />
            <span>{ceremonyLabel.label}</span>
          </div>
        )}
        <div>{activeCount} employees active</div>
        {blockedCount > 0 && (
          <div style={{ color: DARK_SEMANTIC_COLORS.warning }}>
            {blockedCount} employees blocked
          </div>
        )}
      </div>
    </Html>
  );
}

function getFlowLineLabelPoint(
  points: readonly [number, number, number][],
): [number, number, number] | null {
  if (points.length === 0) return null;
  if (points.length === 1) return points[0] ?? null;

  const middleIndex = Math.floor((points.length - 1) / 2);
  const start = points[middleIndex];
  const end = points[middleIndex + 1] ?? start;
  if (!start || !end) return null;

  return [(start[0] + end[0]) / 2, Math.max(start[1], end[1]) + 0.35, (start[2] + end[2]) / 2];
}
