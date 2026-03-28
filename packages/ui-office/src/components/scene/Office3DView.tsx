import type { RoleSlug, RuntimeEvent, Zone } from '@offisim/shared-types';
import { resolveZoneForRole, UNASSIGNED_ZONE_ID } from '@offisim/shared-types';
import { Environment, Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useAgentAnimation } from '../../hooks/useAgentAnimation.js';
import { useCharacterMovement } from '../../hooks/useCharacterMovement.js';
import { useCompanyZones } from '../../hooks/useCompanyZones.js';
import { usePrefabInstances } from '../../hooks/usePrefabInstances.js';
import {
  registerMovementHandle,
  unregisterMovementHandle,
  useSceneOrchestrator,
} from '../../hooks/useSceneOrchestrator.js';
import { STATE_LABELS } from '../../lib/state-labels';
import { SEAT_OFFSETS } from '../../lib/zone-config.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import type { AgentState } from '../../runtime/use-agent-states';
import { useSceneColors } from '../../theme/use-scene-colors.js';
import { useCompany } from '../company/CompanyContext.js';
import { shouldAnimateOfficeScene } from './scene-render-policy.js';
import { Lobster3D } from './Lobster3D.js';
import { MeetingBubble3D } from './MeetingBubble3D.js';
import { Prefab3D } from './prefabs/index.js';
import {
  BookshelfMesh3D,
  MeetingTableMesh3D,
  PlantMesh3D,
  RestAreaMesh3D,
  ServerRackMesh3D,
  WorkstationMesh3D,
} from './prefabs/index.js';

// ── 3D-specific zone position/size bridge ────────────────────────────
// Zone uses { cx, cz, w, d } (2D/logical coords).
// Three.js needs [x, y, z] position and [w, d] size.
// Derived dynamically from useCompanyZones() via useMemo inside components.

interface Zone3DLayout {
  /** Three.js world position [x, y, z] — y=0 means on the floor plane. */
  position: [number, number, number];
  /** Floor footprint [width, depth] in world units. */
  size: [number, number];
}

/** Zone with 3D layout attached (position + size derived from cx/cz/w/d). */
type Zone3D = Zone & Zone3DLayout;

/** Derive 3D layout from a Zone's cx/cz/w/d fields. */
function toZone3DLayout(z: Zone): Zone3DLayout {
  return {
    position: [z.cx, 0, z.cz] as [number, number, number],
    size: [z.w, z.d] as [number, number],
  };
}

/** Resolve employee zone using dynamic zones. Returns the zone ID or UNASSIGNED_ZONE_ID. */
function resolveEmployeeZoneDynamic(
  agent: { role: string; workstationId?: string | null },
  zones: readonly Zone[],
): string {
  // Priority: persisted workstationId → role-based fallback
  if (agent.workstationId) {
    const validIds = new Set(zones.filter((z) => z.deskSlots > 0).map((z) => z.zoneId));
    if (validIds.has(agent.workstationId)) return agent.workstationId;
  }
  return resolveZoneForRole(agent.role as RoleSlug, zones)?.zoneId ?? UNASSIGNED_ZONE_ID;
}

// ── Drag state ───────────────────────────────────────────────────────

interface DragState3D {
  /** Employee being dragged. */
  employeeId: string;
  /** Resolved source zone at drag-start time. */
  sourceZoneId: string;
  /** Whether the drag threshold has been exceeded. */
  active: boolean;
  /** Current world position of the drag ghost [x, y, z]. */
  position: [number, number, number];
  /** Screen position where pointer went down — for threshold check. */
  startScreenX: number;
  startScreenY: number;
}

/** Minimum screen-pixel movement before a click becomes a drag. */
const DRAG_THRESHOLD_PX = 5;

/** Reusable raycasting objects (avoid allocating per frame). */
const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();
const _floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _intersectPoint = new THREE.Vector3();

/**
 * Hit-test a world-space XZ position against drop-target zone bounding boxes.
 * Returns the first matching drop-target zone (with 3D layout), or null.
 */
function hitTestZone3D(
  worldX: number,
  worldZ: number,
  dropTargets: readonly Zone3D[],
): Zone3D | null {
  for (const zone of dropTargets) {
    const halfW = zone.size[0] / 2;
    const halfD = zone.size[1] / 2;
    const cx = zone.position[0];
    const cz = zone.position[2];
    if (
      worldX >= cx - halfW &&
      worldX <= cx + halfW &&
      worldZ >= cz - halfD &&
      worldZ <= cz + halfD
    ) {
      return zone;
    }
  }
  return null;
}

const OUTFIT_COLORS = [
  '#3b82f6',
  '#a855f7',
  '#22c55e',
  '#818cf8',
  '#f97316',
  '#ef4444',
  '#06b6d4',
  '#f59e0b',
];

const SKIN_TONES = ['#fce7f3', '#fef3c7', '#92400e', '#fdf2f8', '#fff1f2', '#d4a574', '#f5deb3'];

// ── Furniture components ────────────────────────────────────────────
// Extracted to packages/ui-office/src/components/scene/prefabs/
// Imports: WorkstationMesh3D, BookshelfMesh3D, RestAreaMesh3D,
//          MeetingTableMesh3D, ServerRackMesh3D, PlantMesh3D, Prefab3D

// ── Zone floor label ────────────────────────────────────────────────

function ZoneLabel({
  position,
  size,
  color,
  name,
  isDragging,
  isHovered,
  isSource,
  activityCount,
  hasBlocked,
  isMeetingActive,
}: {
  position: [number, number, number];
  size: [number, number];
  color: string;
  name: string;
  /** True when any drag is active. */
  isDragging?: boolean;
  /** True when ghost is hovering over this zone. */
  isHovered?: boolean;
  /** True when this zone is the drag source (don't highlight as drop target). */
  isSource?: boolean;
  /** Number of active (non-idle, non-blocked) employees in this zone. */
  activityCount?: number;
  /** True when any employee in this zone is blocked. */
  hasBlocked?: boolean;
  /** True when this is the MTG zone and a meeting is active. */
  isMeetingActive?: boolean;
}) {
  // During drag: valid drop targets get brighter, hovered zone pulses, source stays dim
  const floorOpacity = isDragging ? (isHovered && !isSource ? 0.35 : isSource ? 0.08 : 0.2) : 0.12;
  const borderOpacity = isDragging ? (isHovered && !isSource ? 0.9 : isSource ? 0.3 : 0.6) : 0.4;

  // Memoize edge PlaneGeometry to avoid GPU leak on every render
  const edgePlaneGeo = useMemo(() => new THREE.PlaneGeometry(size[0], size[1]), [size[0], size[1]]);
  useEffect(
    () => () => {
      edgePlaneGeo.dispose();
    },
    [edgePlaneGeo],
  );

  return (
    <group position={position}>
      {/* Zone floor overlay */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={size} />
        <meshStandardMaterial color={color} transparent opacity={floorOpacity} />
        <lineSegments>
          <edgesGeometry args={[edgePlaneGeo]} />
          <lineBasicMaterial color={color} transparent opacity={borderOpacity} />
        </lineSegments>
      </mesh>
      {/* Zone activity glow — only visible when not dragging */}
      {!isDragging && (
        <ZoneActivityGlow
          size={size}
          activityCount={activityCount ?? 0}
          hasBlocked={hasBlocked ?? false}
        />
      )}
      {/* Meeting active label above MTG zone */}
      {isMeetingActive && <MeetingActiveLabel />}
      {/* "Drop here" indicator during drag */}
      {isDragging && !isSource && (
        <Html position={[0, 0.8, 0]} center style={{ pointerEvents: 'none' }}>
          <div
            style={{
              background: isHovered ? 'rgba(30,64,175,0.85)' : 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)',
              border: `1px solid ${isHovered ? '#60a5fa' : `${color}40`}`,
              borderRadius: '8px',
              padding: '4px 14px',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s, border-color 0.15s',
            }}
          >
            <span
              style={{
                color: isHovered ? '#ffffff' : color,
                fontSize: '11px',
                fontWeight: 700,
                fontFamily: 'Inter, system-ui, sans-serif',
              }}
            >
              Drop here
            </span>
          </div>
        </Html>
      )}
      {/* HUD label floating above zone */}
      <Html position={[0, 0.5, -size[1] / 2 + 0.5]} center style={{ pointerEvents: 'none' }}>
        <div
          style={{
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(8px)',
            border: `1px solid ${color}40`,
            borderRadius: '8px',
            padding: '4px 12px',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              color: color,
              fontSize: '11px',
              fontWeight: 900,
              letterSpacing: '3px',
              textTransform: 'uppercase',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            {name}
          </span>
        </div>
      </Html>
    </group>
  );
}

// ── Low-poly character ──────────────────────────────────────────────

function LowPolyCharacter({
  outfitColor,
  skinTone,
  state,
  limbRefs,
}: {
  outfitColor: string;
  skinTone: string;
  state: string;
  limbRefs?: import('../../hooks/useCharacterMovement').CharacterLimbRefs;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ringMatRef = useRef<THREE.MeshBasicMaterial>(null);

  useAgentAnimation(state, { groupRef, ringMatRef });

  return (
    <group ref={groupRef}>
      {/* Legs */}
      <mesh ref={limbRefs?.leftLeg} position={[-0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      <mesh ref={limbRefs?.rightLeg} position={[0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      {/* Torso */}
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[0.36, 0.5, 0.2]} />
        <meshStandardMaterial color={outfitColor} roughness={0.7} />
      </mesh>
      {/* Arms */}
      <mesh ref={limbRefs?.leftArm} position={[-0.25, 0.75, 0]} castShadow>
        <boxGeometry args={[0.1, 0.45, 0.1]} />
        <meshStandardMaterial color={skinTone} roughness={0.4} />
      </mesh>
      <mesh ref={limbRefs?.rightArm} position={[0.25, 0.75, 0]} castShadow>
        <boxGeometry args={[0.1, 0.45, 0.1]} />
        <meshStandardMaterial color={skinTone} roughness={0.4} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <meshStandardMaterial color={skinTone} roughness={0.4} />
      </mesh>
      {/* Hair */}
      <mesh position={[0, 1.48, 0]} castShadow>
        <boxGeometry args={[0.32, 0.16, 0.32]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
      </mesh>
      {/* Status ring at feet — color/opacity/pulse driven by useAgentAnimation */}
      <mesh ref={ringRef} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.4, 0.55, 32]} />
        <meshBasicMaterial ref={ringMatRef} transparent opacity={0} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ── Status bubble labels ────────────────────────────────────────────

function StatusBubble3D({
  state,
  taskDesc,
  blockReason,
  subTasks,
}: {
  state: string;
  /** Optional truncated task description (working state). */
  taskDesc?: string;
  /** Reason for blockage (blocked state). */
  blockReason?: string;
  /** Sub-task list for multi-task progress display. */
  subTasks?: import('../../runtime/use-agent-states').SubTaskInfo[];
}) {
  const label = STATE_LABELS[state];
  if (!label) return null;

  const isBlocked = state === 'blocked' || state === 'failed';
  const isReporting = state === 'reporting';
  const isWorking = state === 'executing';

  const bubbleColor = isBlocked
    ? 'rgba(239,68,68,0.20)'
    : isReporting
      ? 'rgba(6,182,212,0.20)'
      : 'rgba(0,0,0,0.70)';
  const borderColor = isBlocked
    ? 'rgba(239,68,68,0.50)'
    : isReporting
      ? 'rgba(6,182,212,0.50)'
      : 'rgba(255,255,255,0.10)';

  // Multi-task progress display
  const hasMultiTasks = subTasks && subTasks.length > 1;
  const completedCount = subTasks?.filter((s) => s.status === 'done').length ?? 0;
  const totalCount = subTasks?.length ?? 0;
  const allDone = hasMultiTasks && completedCount === totalCount;
  const hasFailed = subTasks?.some((s) => s.status === 'failed') ?? false;

  // Main label text
  let displayText = label;
  if (hasMultiTasks) {
    // Multi-task: show count
    if (allDone) {
      displayText = `${totalCount}/${totalCount} done`;
    } else if (hasFailed) {
      displayText = `${completedCount}/${totalCount} (error)`;
    } else {
      displayText = `${completedCount}/${totalCount} tasks`;
    }
  } else if (isWorking && taskDesc) {
    displayText = taskDesc.length > 20 ? `${taskDesc.slice(0, 20)}…` : taskDesc;
  } else if (isBlocked && blockReason) {
    displayText = blockReason.length > 20 ? `${blockReason.slice(0, 20)}…` : blockReason;
  } else if (isReporting) {
    displayText = 'Delivering…';
  }

  // Icon prefix
  const icon = allDone ? '✅' : hasFailed ? '❌' : hasMultiTasks ? '⚙️' : '';
  const textColor = allDone
    ? '#4ade80'
    : hasFailed
      ? '#fca5a5'
      : isBlocked
        ? '#fca5a5'
        : isReporting
          ? '#67e8f9'
          : 'rgba(255,255,255,0.80)';

  return (
    <Html position={[0, 2.2, 0]} center distanceFactor={12} style={{ pointerEvents: 'none' }}>
      <div
        style={{
          borderRadius: '9999px',
          background: allDone ? 'rgba(34,197,94,0.20)' : bubbleColor,
          backdropFilter: 'blur(4px)',
          border: `1px solid ${allDone ? 'rgba(34,197,94,0.50)' : borderColor}`,
          padding: '2px 8px',
          fontSize: '9px',
          fontFamily: 'monospace',
          color: textColor,
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        {isReporting && !hasMultiTasks && (
          <span
            style={{
              display: 'inline-block',
              width: '5px',
              height: '5px',
              borderRadius: '50%',
              background: '#06b6d4',
              animation: 'pulse 1s infinite',
            }}
          />
        )}
        {icon && <span>{icon}</span>}
        {displayText}
      </div>
    </Html>
  );
}

// ── Employee placement ──────────────────────────────────────────────

// SEAT_OFFSETS imported from zone-config.ts (shared with useSceneOrchestrator)

interface PlacedEmployee {
  id: string;
  agent: AgentState;
  globalIndex: number;
  position: [number, number, number];
}

const DEFAULT_SEAT_OFFSET = SEAT_OFFSETS[0] ?? [0, 0, 0];
type OrbitControlsHandle = React.ComponentRef<typeof OrbitControls>;

function usePlacedEmployees(
  agents: Map<string, AgentState>,
  zones3D: readonly Zone3D[],
  zones: readonly Zone[],
): PlacedEmployee[] {
  return useMemo(() => {
    if (zones3D.length === 0) return [];

    // Find rest zone for idle employee positioning
    const restZone = zones3D.find((z) => z.archetype === 'rest');
    const restZoneLayout = restZone
      ? { position: restZone.position, size: restZone.size }
      : { position: [8, 0, 2] as [number, number, number], size: [14, 8] as [number, number] };
    const restZoneId = restZone?.zoneId ?? 'rest';

    // Space = State: idle employees go to rest area, working employees go to workstations.
    // The SceneOrchestrator overrides these positions during ceremonies via moveTo().
    const zoneEmployees = new Map<
      string,
      { id: string; agent: AgentState; globalIndex: number }[]
    >();
    for (const z of zones3D) {
      zoneEmployees.set(z.zoneId, []);
    }

    let globalIdx = 0;
    for (const [id, agent] of agents) {
      // Idle employees default to rest area — "space = state"
      const zoneId =
        agent.state === 'idle' ? restZoneId : resolveEmployeeZoneDynamic(agent, zones);
      const arr = zoneEmployees.get(zoneId);
      if (arr) {
        arr.push({ id, agent, globalIndex: globalIdx });
      }
      globalIdx++;
    }

    const placed: PlacedEmployee[] = [];
    for (const zone of zones3D) {
      const emps = zoneEmployees.get(zone.zoneId) ?? [];
      emps.forEach((emp, slotIdx) => {
        if (zone.zoneId === restZoneId) {
          // Rest area: scatter employees in a natural cluster
          const angle = (slotIdx / Math.max(emps.length, 1)) * Math.PI * 1.5 + 0.3;
          const radius = 1.2 + (slotIdx % 3) * 0.8;
          placed.push({
            id: emp.id,
            agent: emp.agent,
            globalIndex: emp.globalIndex,
            position: [
              restZoneLayout.position[0] + Math.cos(angle) * radius,
              0,
              restZoneLayout.position[2] + Math.sin(angle) * radius,
            ],
          });
        } else {
          // Work zones: place at desk positions, wrapping around if > 4
          const deskPos = SEAT_OFFSETS[slotIdx % SEAT_OFFSETS.length] ?? DEFAULT_SEAT_OFFSET;
          placed.push({
            id: emp.id,
            agent: emp.agent,
            globalIndex: emp.globalIndex,
            position: [
              zone.position[0] + deskPos[0],
              0,
              zone.position[2] + deskPos[2] + Math.floor(slotIdx / 4) * 2,
            ],
          });
        }
      });
    }
    return placed;
  }, [agents, zones3D, zones]);
}

function EmployeeMarker({
  emp,
  isSelected,
  isDragSource,
  taskDesc,
  onSelect,
  onDragStart,
}: {
  emp: PlacedEmployee;
  isSelected: boolean;
  /** True when this employee is the one currently being dragged. */
  isDragSource?: boolean;
  /** Optional truncated task description to show in status bubble. */
  taskDesc?: string;
  onSelect: (id: string) => void;
  onDragStart?: (empId: string, agent: AgentState, e: React.PointerEvent<Element>) => void;
}) {
  const sc = useSceneColors();
  const outfit = OUTFIT_COLORS[emp.globalIndex % OUTFIT_COLORS.length] ?? '#3b82f6';
  const skin = SKIN_TONES[emp.globalIndex % SKIN_TONES.length] ?? '#fce7f3';

  /** OpenClaw agents use the lobster model instead of the humanoid. */
  const isOpenClaw = emp.agent.role === 'openclaw';
  const openClawBrandColor = '#e74c3c';

  // Limb refs for walk cycle animation
  const leftLegRef = useRef<THREE.Mesh>(null);
  const rightLegRef = useRef<THREE.Mesh>(null);
  const leftArmRef = useRef<THREE.Mesh>(null);
  const rightArmRef = useRef<THREE.Mesh>(null);
  const limbRefs = useMemo(
    () => ({
      leftLeg: leftLegRef,
      rightLeg: rightLegRef,
      leftArm: leftArmRef,
      rightArm: rightArmRef,
    }),
    [],
  );

  // Character movement (walk cycle + position interpolation)
  const groupRef = useRef<THREE.Group>(null);
  const movementHandle = useCharacterMovement(groupRef, isOpenClaw ? null : limbRefs);

  // Register/unregister movement handle for SceneOrchestrator (company-scoped)
  const { activeCompanyId: markerCompanyId } = useCompany();
  useEffect(() => {
    if (!markerCompanyId) return;
    registerMovementHandle(markerCompanyId, emp.id, movementHandle);
    return () => unregisterMovementHandle(markerCompanyId, emp.id);
  }, [markerCompanyId, emp.id, movementHandle]);

  // Set initial position on mount
  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.position.set(emp.position[0], 0, emp.position[2]);
    }
  }, [emp.position]); // Initial sync before orchestrator takes over

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: R3F groups are pointer-only scene primitives, not keyboard-focusable DOM controls.
    <group
      ref={groupRef}
      position={emp.position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(emp.id);
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (onDragStart) {
          onDragStart(emp.id, emp.agent, e.nativeEvent as unknown as React.PointerEvent<Element>);
        }
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = 'grab';
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'default';
      }}
    >
      {/* Dim the source employee during drag */}
      <group scale={isDragSource ? [0.85, 0.85, 0.85] : [1, 1, 1]}>
        {isOpenClaw ? (
          <Lobster3D
            brandColor={openClawBrandColor}
            state={emp.agent.state}
            name={emp.agent.name ?? emp.id}
            isSelected={isSelected}
          />
        ) : (
          <>
            {isSelected && (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
                <ringGeometry args={[0.6, 0.75, 32]} />
                <meshBasicMaterial color={sc.selectionRing} transparent opacity={0.8} />
              </mesh>
            )}
            <LowPolyCharacter
              outfitColor={outfit}
              skinTone={skin}
              state={emp.agent.state}
              limbRefs={limbRefs}
            />
          </>
        )}
      </group>
      {isDragSource && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.5, 0.65, 32]} />
          <meshBasicMaterial color={sc.textMuted} transparent opacity={0.3} />
        </mesh>
      )}
      {emp.agent.state !== 'idle' && !isDragSource && (
        <StatusBubble3D state={emp.agent.state} taskDesc={taskDesc} subTasks={emp.agent.subTasks} />
      )}
    </group>
  );
}

// ── Room shell ──────────────────────────────────────────────────────

const ROOM_W = 40;
const ROOM_D = 30;
const WALL_H = 5;

function RoomShell({ onFloorClick }: { onFloorClick?: () => void }) {
  return (
    <group>
      {/* Floor */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: R3F floor mesh is a pointer-only scene primitive, not a keyboard-focusable DOM control. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow onClick={() => onFloorClick?.()}>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial color="#020617" roughness={0.9} />
      </mesh>
      {/* Grid overlay */}
      <gridHelper args={[ROOM_W, 40, '#1e293b', '#0f172a']} position={[0, 0.01, 0]} />
      {/* Back wall */}
      <mesh position={[0, WALL_H / 2, -ROOM_D / 2]} receiveShadow>
        <boxGeometry args={[ROOM_W, WALL_H, 0.3]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      {/* Left wall */}
      <mesh position={[-ROOM_W / 2, WALL_H / 2, 0]} receiveShadow>
        <boxGeometry args={[0.3, WALL_H, ROOM_D]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      {/* Right wall */}
      <mesh position={[ROOM_W / 2, WALL_H / 2, 0]} receiveShadow>
        <boxGeometry args={[0.3, WALL_H, ROOM_D]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
    </group>
  );
}

// ── Drag ghost (translucent cylinder character silhouette) ───────────

function DragGhost3D({ position }: { position: [number, number, number] }) {
  const sc = useSceneColors();
  return (
    <group position={position}>
      {/* Shadow disc on floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.6, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.25} />
      </mesh>
      {/* Body cylinder */}
      <mesh position={[0, 0.75, 0]} castShadow>
        <cylinderGeometry args={[0.25, 0.3, 1.2, 12]} />
        <meshStandardMaterial color={sc.selectionRing} transparent opacity={0.45} />
      </mesh>
      {/* Head sphere */}
      <mesh position={[0, 1.5, 0]} castShadow>
        <sphereGeometry args={[0.22, 12, 12]} />
        <meshStandardMaterial color={sc.selectionRing} transparent opacity={0.45} />
      </mesh>
      {/* Glowing ring at feet */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[0.45, 0.6, 32]} />
        <meshBasicMaterial color="#60a5fa" transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

// ── Drag controller (runs inside Canvas, handles raycasting) ────────

/**
 * Invisible floor plane mesh that captures pointer move/up events during drag.
 * Uses Three.js raycasting to project screen pointer → world XZ coordinates.
 */
function DragController({
  dragState,
  onDragMove,
  onDragEnd,
  onDragCancel,
  controlsRef,
}: {
  dragState: DragState3D | null;
  onDragMove: (worldX: number, worldZ: number, screenX: number, screenY: number) => void;
  onDragEnd: (worldX: number, worldZ: number) => void;
  onDragCancel: () => void;
  controlsRef: React.RefObject<{ enabled: boolean } | null>;
}) {
  const { camera, gl } = useThree();

  // Keep latest values in refs so the stable pointermove/pointerup effect
  // can always read the current state without being re-registered on every drag move.
  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;
  const onDragMoveRef = useRef(onDragMove);
  onDragMoveRef.current = onDragMove;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;
  const onDragCancelRef = useRef(onDragCancel);
  onDragCancelRef.current = onDragCancel;

  // Disable OrbitControls when drag is active
  useEffect(() => {
    if (!controlsRef.current) return;
    controlsRef.current.enabled = !dragState;
  }, [dragState, controlsRef]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragStateRef.current) {
        onDragCancelRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Pointer leave handler — cancel drag when pointer exits canvas
  useEffect(() => {
    const canvas = gl.domElement;
    const handleLeave = () => {
      if (dragStateRef.current) onDragCancelRef.current();
    };
    canvas.addEventListener('pointerleave', handleLeave);
    return () => canvas.removeEventListener('pointerleave', handleLeave);
  }, [gl.domElement]);

  /** Raycast from screen coords to the y=0 floor plane. */
  const raycastToFloor = useCallback(
    (clientX: number, clientY: number): [number, number, number] | null => {
      const canvas = gl.domElement;
      const rect = canvas.getBoundingClientRect();
      _pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(_pointer, camera);
      const hit = _raycaster.ray.intersectPlane(_floorPlane, _intersectPoint);
      if (!hit) return null;
      return [_intersectPoint.x, 0, _intersectPoint.z];
    },
    [camera, gl.domElement],
  );

  // Listen for pointer move/up on the canvas DOM element during active drag.
  // We attach DOM listeners rather than R3F mesh events for more reliable
  // capture (the ghost might obscure the invisible floor mesh).
  // Effect is stable (only re-runs when gl.domElement changes) because all
  // state-dependent values are accessed via refs inside the handlers.
  useEffect(() => {
    const canvas = gl.domElement;

    const handleMove = (e: PointerEvent) => {
      if (!dragStateRef.current) return;
      const pos = raycastToFloor(e.clientX, e.clientY);
      if (pos) {
        onDragMoveRef.current(pos[0], pos[2], e.clientX, e.clientY);
      }
    };

    const handleUp = (e: PointerEvent) => {
      if (!dragStateRef.current) return;
      const pos = raycastToFloor(e.clientX, e.clientY);
      if (pos) {
        onDragEndRef.current(pos[0], pos[2]);
      } else {
        onDragCancelRef.current();
      }
    };

    canvas.addEventListener('pointermove', handleMove);
    canvas.addEventListener('pointerup', handleUp);
    return () => {
      canvas.removeEventListener('pointermove', handleMove);
      canvas.removeEventListener('pointerup', handleUp);
    };
  }, [gl.domElement, raycastToFloor]);

  return null; // No visual output — purely event handling
}

// ── Task flow line data ─────────────────────────────────────────────

interface FlowLineData {
  id: string;
  from: [number, number, number];
  to: [number, number, number];
  /** 'normal' = blue assignment; 'handoff' = orange handoff */
  variant: 'normal' | 'handoff';
  /** Unix ms when this line was created — drives 2-second lifecycle. */
  createdAt: number;
}

// ── TaskFlowLine ────────────────────────────────────────────────────

/**
 * Animated line from manager/boss position → employee zone center.
 * Lifecycle: fade-in 0.3s → hold 1s → fade-out 0.7s (total 2s).
 */
function TaskFlowLine({
  from,
  to,
  color,
  onComplete,
}: {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  onComplete: () => void;
}) {
  const matRef = useRef<THREE.LineBasicMaterial>(null);
  const startRef = useRef(performance.now() / 1000);
  const doneRef = useRef(false);

  const points = useMemo(() => [new THREE.Vector3(...from), new THREE.Vector3(...to)], [from, to]);

  useFrame(() => {
    if (doneRef.current || !matRef.current) return;
    const elapsed = performance.now() / 1000 - startRef.current;
    let opacity = 0;
    if (elapsed < 0.3) {
      opacity = elapsed / 0.3;
    } else if (elapsed < 1.3) {
      opacity = 1;
    } else if (elapsed < 2.0) {
      opacity = 1 - (elapsed - 1.3) / 0.7;
    } else {
      doneRef.current = true;
      onComplete();
      return;
    }
    matRef.current.opacity = opacity * 0.85;
  });

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(points);
    return g;
  }, [points]);

  const lineObj = useMemo(() => {
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, linewidth: 2 });
    const l = new THREE.Line(geo, mat);
    return l;
  }, [geo, color]);

  // Update opacity via ref to the material
  useEffect(() => {
    if (matRef.current) return;
    matRef.current = lineObj.material as THREE.LineBasicMaterial;
  }, [lineObj]);

  // Dispose geometry and material on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      geo.dispose();
      (lineObj.material as THREE.LineBasicMaterial).dispose();
    };
  }, [geo, lineObj]);

  return <primitive object={lineObj} />;
}

// ── Zone activity glow overlay ──────────────────────────────────────

/**
 * Pulsing floor overlay driven by zone activity level.
 * Rendered as a thin plane just above the zone floor overlay.
 */
function ZoneActivityGlow({
  size,
  activityCount,
  hasBlocked,
}: {
  size: [number, number];
  activityCount: number;
  hasBlocked: boolean;
}) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  const targetOpacity = hasBlocked
    ? 0.18
    : activityCount >= 3
      ? 0.2
      : activityCount >= 1
        ? 0.1
        : 0.04;
  const baseColor = hasBlocked ? '#f59e0b' : '#60a5fa';

  useFrame((state) => {
    if (!matRef.current) return;
    const t = state.clock.elapsedTime;
    // Gentle pulse: ±20% of target opacity
    const pulse = Math.sin(t * 2.5) * 0.2 + 1;
    matRef.current.opacity = targetOpacity * pulse;
  });

  return (
    <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={size} />
      <meshBasicMaterial ref={matRef} color={baseColor} transparent opacity={targetOpacity} />
    </mesh>
  );
}

// ── Meeting zone "MEETING" label and connectors ─────────────────────

/** Floating "MEETING" pill above the MTG zone when a meeting is active. */
function MeetingActiveLabel() {
  const sc = useSceneColors();
  return (
    <Html position={[0, 2.5, 0]} center style={{ pointerEvents: 'none' }}>
      <div
        style={{
          background: 'rgba(148,163,184,0.20)',
          backdropFilter: 'blur(6px)',
          border: `1px solid ${sc.textMuted}`,
          borderRadius: '9999px',
          padding: '3px 14px',
          whiteSpace: 'nowrap',
          animation: 'pulse 2s infinite',
        }}
      >
        <span
          style={{
            color: sc.text,
            fontSize: '10px',
            fontWeight: 900,
            letterSpacing: '3px',
            textTransform: 'uppercase',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          MEETING
        </span>
      </div>
    </Html>
  );
}

/** Lines connecting each meeting participant to the meeting room center. */
export function MeetingParticipantLines({
  participantPositions,
}: {
  participantPositions: [number, number, number][];
}) {
  const sc = useSceneColors();
  const MTG_CENTER: [number, number, number] = [-10, 0.5, -8];

  const prevLinesRef = useRef<THREE.Line[]>([]);

  const lines = useMemo(() => {
    // Dispose previous geometry/material to prevent GPU memory leaks
    for (const line of prevLinesRef.current) {
      line.geometry.dispose();
      (line.material as THREE.LineBasicMaterial).dispose();
    }
    const newLines = participantPositions.map((pos) => {
      const points = [new THREE.Vector3(...MTG_CENTER), new THREE.Vector3(...pos)];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({
        color: sc.textMuted,
        transparent: true,
        opacity: 0.35,
        linewidth: 1,
      });
      return new THREE.Line(geo, mat);
    });
    prevLinesRef.current = newLines;
    return newLines;
  }, [participantPositions, sc.textMuted]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const line of prevLinesRef.current) {
        line.geometry.dispose();
        (line.material as THREE.LineBasicMaterial).dispose();
      }
    };
  }, []);

  return (
    <>
      {lines.map((line) => (
        <primitive key={line.uuid} object={line} />
      ))}
    </>
  );
}

// ── Ambient light controller (company state → color) ───────────────

/**
 * Reads agent states and adjusts the scene ambient light color/intensity.
 * Rendered inside Canvas so it has access to the scene.
 */
export function AmbientStateLight({ agents }: { agents: Map<string, AgentState> }) {
  const lightRef = useRef<THREE.AmbientLight>(null);

  const { targetColor, targetIntensity } = useMemo(() => {
    const values = [...agents.values()];
    const hasBlocked = values.some((a) => a.state === 'blocked' || a.state === 'failed');
    const hasActive = values.some((a) => a.state !== 'idle');
    const hasMeeting = values.some((a) => a.state === 'meeting');
    const color = hasBlocked
      ? '#ff9944'
      : hasMeeting
        ? '#c4bfee'
        : hasActive
          ? '#ffffff'
          : '#aabbcc';
    return { targetColor: color, targetIntensity: hasMeeting ? 0.6 : 0.8 };
  }, [agents]);

  const targetColorObj = useMemo(() => new THREE.Color(targetColor), [targetColor]);

  useFrame(() => {
    if (!lightRef.current) return;
    // Lerp toward target color/intensity each frame for smooth transitions
    const current = lightRef.current.color;
    current.lerp(targetColorObj, 0.02);
    lightRef.current.intensity = THREE.MathUtils.lerp(
      lightRef.current.intensity,
      targetIntensity,
      0.02,
    );
  });

  return <ambientLight ref={lightRef} intensity={0.8} color={targetColor} />;
}

function SceneFrameLoopController({
  animate,
  controlsRef,
}: {
  animate: boolean;
  controlsRef: React.RefObject<OrbitControlsHandle | null>;
}) {
  const { invalidate } = useThree();

  useEffect(() => {
    invalidate();
  }, [invalidate, animate]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const handleChange = () => invalidate();
    controls.addEventListener('change', handleChange);
    return () => {
      controls.removeEventListener('change', handleChange);
    };
  }, [controlsRef, invalidate]);

  useEffect(() => {
    if (!animate) return;

    let rafId = 0;
    const loop = () => {
      invalidate();
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [animate, invalidate]);

  return null;
}

// ── Main 3D View ────────────────────────────────────────────────────

interface Office3DViewProps {
  active?: boolean;
  selectedEmployeeId?: string | null;
  onSelectEmployee?: (id: string) => void;
  onDeselectEmployee?: () => void;
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

  // ── Dynamic zone loading ──
  const { zones } = useCompanyZones();

  // Derive 3D layouts from dynamic zones (replaces static ZONE_3D_LAYOUT / ZONES_3D)
  const zones3D: Zone3D[] = useMemo(
    () => zones.map((z) => ({ ...z, ...toZone3DLayout(z) })),
    [zones],
  );

  // Drop-target zones: those with desk slots (replaces static DROP_TARGET_ZONES_3D)
  const dropTargetZones3D: Zone3D[] = useMemo(
    () => zones3D.filter((z) => z.deskSlots > 0),
    [zones3D],
  );

  // Zone ID → 3D layout lookup (replaces static ZONE_3D_LAYOUT record)
  const zone3DLayoutMap: Readonly<Record<string, Zone3DLayout>> = useMemo(
    () =>
      Object.fromEntries(
        zones3D.map((z) => [z.zoneId, { position: z.position, size: z.size }]),
      ),
    [zones3D],
  );

  // Keep stable refs for event handlers that need latest zone data without re-subscribing
  const zone3DLayoutMapRef = useRef(zone3DLayoutMap);
  zone3DLayoutMapRef.current = zone3DLayoutMap;
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const dropTargetZones3DRef = useRef(dropTargetZones3D);
  dropTargetZones3DRef.current = dropTargetZones3D;

  const placed = usePlacedEmployees(agents, zones3D, zones);

  // ── Scene choreography (ceremony orchestration) ──
  const ceremony = useSceneOrchestrator({ companyId: sceneCompanyId, eventBus, agents, zones });

  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const selectedEmployeeId = onSelectEmployee ? externalSelectedId : localSelectedId;

  // Clear selection when the selected employee no longer exists (e.g. deleted)
  useEffect(() => {
    if (selectedEmployeeId && !agents.has(selectedEmployeeId)) {
      if (onDeselectEmployee) onDeselectEmployee();
      else setLocalSelectedId(null);
    }
  }, [agents, selectedEmployeeId, onDeselectEmployee]);

  const [dragState, setDragState] = useState<DragState3D | null>(null);
  const dragStateRef = useRef<DragState3D | null>(null);
  dragStateRef.current = dragState;
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const [flowLines, setFlowLines] = useState<FlowLineData[]>([]);
  const controlsRef = useRef<OrbitControlsHandle>(null);

  // ── Prefab data-driven rendering ──
  const { instances: prefabInstances } = usePrefabInstances();
  const hasPrefabData = prefabInstances.length > 0;

  const isDragging = dragState?.active ?? false;

  // ── Per-zone activity counters ──
  const zoneActivity = useMemo(() => {
    const activity: Record<string, { count: number; blocked: boolean }> = {};
    for (const zone of zones3D) activity[zone.zoneId] = { count: 0, blocked: false };
    for (const [, agent] of agents) {
      const zoneId = resolveEmployeeZoneDynamic(agent, zones);
      if (!activity[zoneId]) continue;
      if (agent.state !== 'idle') activity[zoneId].count++;
      if (agent.state === 'blocked' || agent.state === 'failed') activity[zoneId].blocked = true;
    }
    return activity;
  }, [agents, zones3D, zones]);

  // ── Scene-level stats for HUD ──
  const activeCount = useMemo(
    () => [...agents.values()].filter((a) => a.state !== 'idle').length,
    [agents],
  );
  const blockedCount = useMemo(
    () => [...agents.values()].filter((a) => a.state === 'blocked' || a.state === 'failed').length,
    [agents],
  );

  // Keep a stable ref to agents so the event handler reads latest without re-subscribing
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  // ── Task flow line event subscription ──
  useEffect(() => {
    setFlowLines([]); // Clear stale flow lines on company switch
    if (!activeCompanyId) {
      return;
    }
    const unsub = eventBus.on('task.state.changed', (event: RuntimeEvent) => {
      const payload = event.payload as { taskState?: string; assignedTo?: string } | undefined;
      if (payload?.taskState !== 'active') return;
      const layoutMap = zone3DLayoutMapRef.current;
      const currentZones = zonesRef.current;
      const defaultWorkspaceZoneId =
        currentZones.find((z) => z.archetype === 'workspace')?.zoneId ?? UNASSIGNED_ZONE_ID;
      const assignedZoneId = payload.assignedTo
        ? resolveEmployeeZoneDynamic(
            agentsRef.current.get(payload.assignedTo) ?? { role: 'employee' },
            currentZones,
          )
        : defaultWorkspaceZoneId;
      // Find meeting zone layout (archetype 'meeting') for flow line origin
      const mtgZone = currentZones.find((z) => z.archetype === 'meeting');
      const mtgLayout = mtgZone ? layoutMap[mtgZone.zoneId] : undefined;
      // Fallback: first workspace zone if assigned zone not in layout map
      const fallbackZone = currentZones.find((z) => z.archetype === 'workspace');
      const targetLayout =
        layoutMap[assignedZoneId] ??
        (fallbackZone ? layoutMap[fallbackZone.zoneId] : undefined);
      if (!mtgLayout || !targetLayout) return;
      const line: FlowLineData = {
        id: `flow-${Date.now()}-${Math.random()}`,
        from: [mtgLayout.position[0], 0.5, mtgLayout.position[2]],
        to: [targetLayout.position[0], 0.5, targetLayout.position[2]],
        variant: 'normal',
        createdAt: Date.now(),
      };
      setFlowLines((prev) => {
        const now = Date.now();
        const cleaned = prev.filter((l) => now - l.createdAt < 5000);
        return [...cleaned, line].slice(-20);
      });
    });
    return () => {
      unsub();
    };
  }, [eventBus, activeCompanyId]);

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

  // ── Drag-to-assign handlers ──

  /** Called from EmployeeMarker onPointerDown — starts potential drag. */
  const handleEmployeeDragStart = useCallback(
    (empId: string, agent: AgentState, e: React.PointerEvent<Element>) => {
      // Only primary button
      const nativeEvent = e as unknown as PointerEvent;
      if (nativeEvent.button !== 0) return;
      const zoneId = resolveEmployeeZoneDynamic(agent, zonesRef.current);
      setDragState({
        employeeId: empId,
        sourceZoneId: zoneId,
        active: false,
        position: [0, 0, 0], // will be set on first move
        startScreenX: nativeEvent.clientX,
        startScreenY: nativeEvent.clientY,
      });
    },
    [],
  );

  /** Pointer move during drag — update ghost position and check threshold. */
  const handleDragMove = useCallback(
    (worldX: number, worldZ: number, screenX: number, screenY: number) => {
      setDragState((prev) => {
        if (!prev) return null;
        // Check threshold
        const dx = screenX - prev.startScreenX;
        const dy = screenY - prev.startScreenY;
        const active = prev.active || Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD_PX;
        return {
          ...prev,
          active,
          position: [worldX, 0, worldZ],
        };
      });
      // Update hovered zone
      const zone = hitTestZone3D(worldX, worldZ, dropTargetZones3DRef.current);
      setHoveredZoneId(zone?.zoneId ?? null);
    },
    [],
  );

  /** Pointer up during drag — determine drop target and emit event. */
  const handleDragEnd = useCallback(
    (worldX: number, worldZ: number) => {
      const ds = dragStateRef.current;
      if (!ds) return;

      if (ds.active) {
        const targetZone = hitTestZone3D(worldX, worldZ, dropTargetZones3DRef.current);
        if (activeCompanyId && targetZone && targetZone.zoneId !== ds.sourceZoneId) {
          eventBus.emit({
            type: 'employee.workstation.drop-requested',
            entityId: ds.employeeId,
            entityType: 'employee',
            companyId: activeCompanyId,
            timestamp: Date.now(),
            payload: {
              employeeId: ds.employeeId,
              targetWorkstationId: targetZone.zoneId,
            },
          });
        }
      } else {
        handleSelectEmployee(ds.employeeId);
      }

      setDragState(null);
      setHoveredZoneId(null);
      document.body.style.cursor = 'default';
    },
    [activeCompanyId, eventBus, handleSelectEmployee],
  );

  /** Cancel drag (Escape, pointer leave). */
  const handleDragCancel = useCallback(() => {
    setDragState(null);
    setHoveredZoneId(null);
    document.body.style.cursor = 'default';
  }, []);

  return (
    <Office3DViewInner
      agents={agents}
      placed={placed}
      zones3D={zones3D}
      selectedEmployeeId={selectedEmployeeId}
      isDragging={isDragging}
      dragState={dragState}
      hoveredZoneId={hoveredZoneId}
      flowLines={flowLines}
      setFlowLines={setFlowLines}
      controlsRef={controlsRef}
      hasPrefabData={hasPrefabData}
      prefabInstances={prefabInstances}
      zoneActivity={zoneActivity}
      activeCount={activeCount}
      blockedCount={blockedCount}
      ceremony={ceremony}
      shouldAnimate={
        active &&
        shouldAnimateOfficeScene({
          activeCount,
          blockedCount,
          isDragging,
          flowLineCount: flowLines.length,
          ceremonyPhase: ceremony.phase,
        })
      }
      handleDeselect={handleDeselect}
      handleSelectEmployee={handleSelectEmployee}
      handleEmployeeDragStart={handleEmployeeDragStart}
      handleDragMove={handleDragMove}
      handleDragEnd={handleDragEnd}
      handleDragCancel={handleDragCancel}
    />
  );
}

// ── Inner view ───────────────────────────────────────────────────

function Office3DViewInner({
  agents,
  placed,
  zones3D,
  selectedEmployeeId,
  isDragging,
  dragState,
  hoveredZoneId,
  flowLines,
  setFlowLines,
  controlsRef,
  hasPrefabData,
  prefabInstances,
  zoneActivity,
  activeCount,
  blockedCount,
  ceremony,
  shouldAnimate,
  handleDeselect,
  handleSelectEmployee,
  handleEmployeeDragStart,
  handleDragMove,
  handleDragEnd,
  handleDragCancel,
}: {
  agents: Map<string, AgentState>;
  placed: PlacedEmployee[];
  zones3D: readonly Zone3D[];
  selectedEmployeeId: string | null;
  isDragging: boolean;
  dragState: DragState3D | null;
  hoveredZoneId: string | null;
  flowLines: FlowLineData[];
  setFlowLines: React.Dispatch<React.SetStateAction<FlowLineData[]>>;
  controlsRef: React.RefObject<OrbitControlsHandle | null>;
  hasPrefabData: boolean;
  prefabInstances: ReturnType<typeof usePrefabInstances>['instances'];
  zoneActivity: Record<string, { count: number; blocked: boolean }>;
  activeCount: number;
  blockedCount: number;
  ceremony: import('../../hooks/useSceneOrchestrator').CeremonyState;
  shouldAnimate: boolean;
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
}) {
  return (
    <div
      className="w-full h-full bg-slate-950"
      style={{ position: 'relative', cursor: isDragging ? 'grabbing' : undefined }}
    >
      <Canvas
        dpr={[1, 1.5]}
        frameloop="demand"
        shadows="percentage"
        camera={{ position: [0, 22, 28], fov: 45 }}
      >
        <SceneFrameLoopController animate={shouldAnimate} controlsRef={controlsRef} />
        <color attach="background" args={['#020617']} />
        <fog attach="fog" args={['#020617', 40, 100]} />

        {/* Lighting — AmbientStateLight replaces static ambientLight */}
        <AmbientStateLight agents={agents} />
        <directionalLight
          castShadow
          position={[12, 25, 12]}
          intensity={1.5}
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0005}
          shadow-camera-left={-25}
          shadow-camera-right={25}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
        />
        <pointLight position={[-15, 12, -10]} intensity={0.4} color="#3b82f6" />
        <pointLight position={[15, 8, 10]} intensity={0.3} color="#06b6d4" />
        <Environment preset="city" />

        {/* Room shell — floor click deselects */}
        <RoomShell onFloorClick={handleDeselect} />

        {/* ── Zone overlays (with drag highlight and activity glow) ── */}
        {zones3D.map((z) => (
          <ZoneLabel
            key={z.zoneId}
            position={z.position}
            size={z.size}
            color={z.accentColor}
            name={z.label}
            isDragging={isDragging && z.deskSlots > 0}
            isHovered={hoveredZoneId === z.zoneId}
            isSource={isDragging ? dragState?.sourceZoneId === z.zoneId : false}
            activityCount={zoneActivity[z.zoneId]?.count ?? 0}
            hasBlocked={zoneActivity[z.zoneId]?.blocked ?? false}
            isMeetingActive={
              z.archetype === 'meeting' && (zoneActivity[z.zoneId]?.count ?? 0) > 0
            }
          />
        ))}

        {/* ── Zone furniture: data-driven from PrefabInstances (with hardcoded fallback) ── */}
        {hasPrefabData ? (
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
        ) : (
          <>
            {/* Fallback: hardcoded furniture when no PrefabInstance data is loaded */}
            {/* MTG zone furniture (back row) */}
            <MeetingTableMesh3D position={[-10, 0, -8]} />
            {/* SRV zone furniture (back row) */}
            <ServerRackMesh3D position={[8, 0, -8]} />
            {/* LIB zone furniture (middle row) */}
            <BookshelfMesh3D position={[-10, 0, 2]} />
            {/* REST zone furniture (middle row) */}
            <RestAreaMesh3D position={[8, 0, 2]} />
            {/* DEV zone furniture (front row) */}
            <WorkstationMesh3D position={[-13, 0, 11]} />
            {/* PROD zone furniture (front row) */}
            <WorkstationMesh3D position={[0, 0, 11]} />
            {/* ART zone furniture (front row) */}
            <WorkstationMesh3D position={[12, 0, 11]} />
            {/* Decoration plants along walls */}
            <PlantMesh3D position={[-18, 0, -13]} />
            <PlantMesh3D position={[-18, 0, 13]} />
            <PlantMesh3D position={[18, 0, -13]} />
            <PlantMesh3D position={[18, 0, 13]} />
            <PlantMesh3D position={[0, 0, 13]} />
          </>
        )}

        {/* ── Employees ── */}
        {placed.map((emp) => (
          <EmployeeMarker
            key={emp.id}
            emp={emp}
            isSelected={selectedEmployeeId === emp.id}
            isDragSource={isDragging && dragState?.employeeId === emp.id}
            onSelect={handleSelectEmployee}
            onDragStart={handleEmployeeDragStart}
          />
        ))}

        {/* ── Meeting ceremony bubble ── */}
        <MeetingBubble3D ceremony={ceremony} />

        {/* ── Task flow lines ── */}
        {flowLines.map((line) => (
          <TaskFlowLine
            key={line.id}
            from={line.from}
            to={line.to}
            color={line.variant === 'handoff' ? '#f97316' : '#60a5fa'}
            onComplete={() => setFlowLines((prev) => prev.filter((l) => l.id !== line.id))}
          />
        ))}

        {/* ── Scene HUD overlay ── */}
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

        {/* ── Drag ghost ── */}
        {isDragging && dragState && <DragGhost3D position={dragState.position} />}

        {/* ── Drag controller (raycasting + event handling) ── */}
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
