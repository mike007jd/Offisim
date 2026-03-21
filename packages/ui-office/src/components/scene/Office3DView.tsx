import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, Html } from '@react-three/drei';
import * as THREE from 'three';
import { Lobster3D } from './Lobster3D.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAgentStates } from '../../runtime/use-agent-states';
import type { AgentState } from '../../runtime/use-agent-states';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';
import { COMPANY_ID } from '../../lib/constants';
import { STATE_LABELS } from '../../lib/state-labels';
import { ZONES, DROP_TARGET_ZONES, STATUS_COLORS as _STATUS_COLORS, resolveEmployeeZone } from '../../lib/zone-config.js';
import type { RuntimeEvent } from '@aics/shared-types';
import { usePrefabInstances } from '../../hooks/usePrefabInstances.js';
import { Prefab3D } from './prefabs/index.js';
import {
  WorkstationMesh3D,
  BookshelfMesh3D,
  RestAreaMesh3D,
  MeetingTableMesh3D,
  ServerRackMesh3D,
  PlantMesh3D,
} from './prefabs/index.js';

// ── 3D-specific zone position/size bridge ────────────────────────────
// zone-config uses { cx, cz, w, d } (2D/logical coords).
// Three.js needs [x, y, z] position and [w, d] size.
// This mapping is the ONLY place that bridges the two formats.

interface Zone3DLayout {
  /** Three.js world position [x, y, z] — y=0 means on the floor plane. */
  position: [number, number, number];
  /** Floor footprint [width, depth] in world units. */
  size: [number, number];
}

/** Maps zone ID → Three.js position and size (derived from zone-config cx/cz/w/d). */
const ZONE_3D_LAYOUT: Readonly<Record<string, Zone3DLayout>> = Object.fromEntries(
  ZONES.map(z => [z.id, { position: [z.cx, 0, z.cz] as [number, number, number], size: [z.w, z.d] as [number, number] }]),
);

/** Zones that accept employee drops (those with desk slots) — with 3D layout attached. */
const DROP_TARGET_ZONES_3D = DROP_TARGET_ZONES.map(z => ({ ...z, ...ZONE_3D_LAYOUT[z.id]! }));

/** All zones with 3D layout attached (for rendering zone overlays). */
const ZONES_3D = ZONES.map(z => ({ ...z, ...ZONE_3D_LAYOUT[z.id]! }));

// Re-export STATUS_COLORS under the local alias used in this file
const STATE_COLORS = _STATUS_COLORS;

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
function hitTestZone3D(worldX: number, worldZ: number): typeof DROP_TARGET_ZONES_3D[number] | null {
  for (const zone of DROP_TARGET_ZONES_3D) {
    const halfW = zone.size[0] / 2;
    const halfD = zone.size[1] / 2;
    const cx = zone.position[0];
    const cz = zone.position[2];
    if (
      worldX >= cx - halfW && worldX <= cx + halfW &&
      worldZ >= cz - halfD && worldZ <= cz + halfD
    ) {
      return zone;
    }
  }
  return null;
}

const OUTFIT_COLORS = [
  '#3b82f6', '#a855f7', '#22c55e', '#818cf8',
  '#f97316', '#ef4444', '#06b6d4', '#f59e0b',
];

const SKIN_TONES = [
  '#fce7f3', '#fef3c7', '#92400e', '#fdf2f8',
  '#fff1f2', '#d4a574', '#f5deb3',
];

// ── Furniture components ────────────────────────────────────────────
// Extracted to packages/ui-office/src/components/scene/prefabs/
// Imports: WorkstationMesh3D, BookshelfMesh3D, RestAreaMesh3D,
//          MeetingTableMesh3D, ServerRackMesh3D, PlantMesh3D, Prefab3D

// ── Zone floor label ────────────────────────────────────────────────

function ZoneLabel({ position, size, color, name, isDragging, isHovered, isSource, activityCount, hasBlocked, isMeetingActive }: {
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
  const floorOpacity = isDragging
    ? (isHovered && !isSource ? 0.35 : isSource ? 0.08 : 0.2)
    : 0.12;
  const borderOpacity = isDragging
    ? (isHovered && !isSource ? 0.9 : isSource ? 0.3 : 0.6)
    : 0.4;

  return (
    <group position={position}>
      {/* Zone floor overlay */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={size} />
        <meshStandardMaterial color={color} transparent opacity={floorOpacity} />
        <lineSegments>
          <edgesGeometry args={[new THREE.PlaneGeometry(size[0], size[1])]} />
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
        <Html
          position={[0, 0.8, 0]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div style={{
            background: isHovered ? 'rgba(30,64,175,0.85)' : 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
            border: `1px solid ${isHovered ? '#60a5fa' : color + '40'}`,
            borderRadius: '8px',
            padding: '4px 14px',
            whiteSpace: 'nowrap',
            transition: 'background 0.15s, border-color 0.15s',
          }}>
            <span style={{
              color: isHovered ? '#ffffff' : color,
              fontSize: '11px',
              fontWeight: 700,
              fontFamily: 'Inter, system-ui, sans-serif',
            }}>
              Drop here
            </span>
          </div>
        </Html>
      )}
      {/* HUD label floating above zone */}
      <Html
        position={[0, 0.5, -size[1] / 2 + 0.5]}
        center
        style={{ pointerEvents: 'none' }}
      >
        <div style={{
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(8px)',
          border: `1px solid ${color}40`,
          borderRadius: '8px',
          padding: '4px 12px',
          whiteSpace: 'nowrap',
        }}>
          <span style={{
            color: color,
            fontSize: '11px',
            fontWeight: 900,
            letterSpacing: '3px',
            textTransform: 'uppercase',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}>
            {name}
          </span>
        </div>
      </Html>
    </group>
  );
}

// ── Low-poly character ──────────────────────────────────────────────

function LowPolyCharacter({ statusColor, outfitColor, skinTone, state }: {
  statusColor: string;
  outfitColor: string;
  skinTone: string;
  state: string;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((frameState) => {
    if (!groupRef.current) return;
    const t = frameState.clock.elapsedTime;

    // Reset to baseline every frame to prevent drift between state switches
    groupRef.current.position.x = 0;
    groupRef.current.position.y = 0;
    groupRef.current.rotation.y = 0;

    switch (state) {
      case 'idle':
        // Gentle breathing
        groupRef.current.position.y = Math.sin(t * 2) * 0.03;
        break;
      case 'executing':
      case 'working':
        // Typing motion - slight body bob
        groupRef.current.position.y = Math.sin(t * 8) * 0.02;
        groupRef.current.rotation.y = Math.sin(t * 3) * 0.05;
        break;
      case 'thinking':
        // Slow sway
        groupRef.current.position.y = Math.sin(t * 1.5) * 0.05;
        groupRef.current.rotation.y = Math.sin(t * 0.8) * 0.1;
        break;
      case 'blocked':
      case 'failed':
        // Frustrated shake
        groupRef.current.position.x = Math.sin(t * 15) * 0.03;
        break;
      case 'meeting':
      case 'talking':
        // Animated gesturing
        groupRef.current.rotation.y = Math.sin(t * 2) * 0.15;
        break;
      case 'success':
        // Happy bounce
        groupRef.current.position.y = Math.abs(Math.sin(t * 4)) * 0.1;
        break;
      default:
        groupRef.current.position.y = Math.sin(t * 2) * 0.02;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Legs */}
      <mesh position={[-0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      <mesh position={[0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      {/* Torso */}
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[0.36, 0.5, 0.2]} />
        <meshStandardMaterial color={outfitColor} roughness={0.7} />
      </mesh>
      {/* Arms */}
      <mesh position={[-0.25, 0.75, 0]} castShadow>
        <boxGeometry args={[0.1, 0.45, 0.1]} />
        <meshStandardMaterial color={skinTone} roughness={0.4} />
      </mesh>
      <mesh position={[0.25, 0.75, 0]} castShadow>
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
      {/* Status ring at feet */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.4, 0.5, 32]} />
        <meshBasicMaterial color={statusColor} transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

// ── Status bubble labels ────────────────────────────────────────────

function StatusBubble3D({ state, taskDesc, blockReason }: {
  state: string;
  /** Optional truncated task description (working state). */
  taskDesc?: string;
  /** Reason for blockage (blocked state). */
  blockReason?: string;
}) {
  const label = STATE_LABELS[state];
  if (!label) return null;

  const isBlocked = state === 'blocked' || state === 'failed';
  const isReporting = state === 'reporting';
  const isWorking = state === 'executing' || state === 'working';

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

  // Main label text
  let displayText = label;
  if (isWorking && taskDesc) {
    displayText = taskDesc.length > 20 ? taskDesc.slice(0, 20) + '…' : taskDesc;
  } else if (isBlocked && blockReason) {
    displayText = blockReason.length > 20 ? blockReason.slice(0, 20) + '…' : blockReason;
  } else if (isReporting) {
    displayText = 'Delivering…';
  }

  return (
    <Html position={[0, 2.2, 0]} center distanceFactor={12} style={{ pointerEvents: 'none' }}>
      <div style={{
        borderRadius: '9999px',
        background: bubbleColor,
        backdropFilter: 'blur(4px)',
        border: `1px solid ${borderColor}`,
        padding: '2px 8px',
        fontSize: '9px',
        fontFamily: 'monospace',
        color: isBlocked ? '#fca5a5' : isReporting ? '#67e8f9' : 'rgba(255,255,255,0.80)',
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      }}>
        {isReporting && (
          <span style={{
            display: 'inline-block',
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            background: '#06b6d4',
            animation: 'pulse 1s infinite',
          }} />
        )}
        {displayText}
      </div>
    </Html>
  );
}

// ── Employee placement ──────────────────────────────────────────────

/**
 * Workstation positions relative to zone center,
 * used for placing employees within department desk clusters.
 */
/** Chair/seat positions — OUTSIDE the desk, where employees sit */
const SEAT_POSITIONS: [number, number, number][] = [
  [-0.8, 0, -1.8],
  [0.8, 0, -1.8],
  [-0.8, 0, 1.8],
  [0.8, 0, 1.8],
];

interface PlacedEmployee {
  id: string;
  agent: AgentState;
  globalIndex: number;
  position: [number, number, number];
}

function usePlacedEmployees(agents: Map<string, AgentState>): PlacedEmployee[] {
  return useMemo(() => {
    // Group employees by zone using shared resolveEmployeeZone
    const zoneEmployees = new Map<string, { id: string; agent: AgentState; globalIndex: number }[]>();
    for (const z of ZONES_3D) {
      zoneEmployees.set(z.id, []);
    }

    let globalIdx = 0;
    for (const [id, agent] of agents) {
      const zoneId = resolveEmployeeZone(agent);
      const arr = zoneEmployees.get(zoneId);
      if (arr) {
        arr.push({ id, agent, globalIndex: globalIdx });
      }
      globalIdx++;
    }

    const placed: PlacedEmployee[] = [];
    for (const zone of ZONES_3D) {
      const emps = zoneEmployees.get(zone.id) ?? [];
      emps.forEach((emp, slotIdx) => {
        // Place at desk positions, wrapping around if > 4
        const deskPos = SEAT_POSITIONS[slotIdx % SEAT_POSITIONS.length]!;
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
      });
    }
    return placed;
  }, [agents]);
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
  const color = STATE_COLORS[emp.agent.state] ?? '#64748b';
  const outfit = OUTFIT_COLORS[emp.globalIndex % OUTFIT_COLORS.length] ?? '#3b82f6';
  const skin = SKIN_TONES[emp.globalIndex % SKIN_TONES.length] ?? '#fce7f3';

  /** OpenClaw agents use the lobster model instead of the humanoid. */
  const isOpenClaw = emp.agent.role === 'openclaw';
  // TODO: expose brandColor on AgentState once core runtime carries it
  const openClawBrandColor = '#e74c3c';

  return (
    <group
      position={emp.position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(emp.id);
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (onDragStart) {
          // Forward the native event for screen-space threshold check
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
          // OpenClaw agents render as a 3D lobster with built-in selection ring
          <Lobster3D
            brandColor={openClawBrandColor}
            state={emp.agent.state}
            name={emp.agent.name ?? emp.id}
            isSelected={isSelected}
          />
        ) : (
          <>
            {/* Selection ring — rendered below the humanoid when selected */}
            {isSelected && (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
                <ringGeometry args={[0.6, 0.75, 32]} />
                <meshBasicMaterial color="#3b82f6" transparent opacity={0.8} />
              </mesh>
            )}
            <LowPolyCharacter
              statusColor={color}
              outfitColor={outfit}
              skinTone={skin}
              state={emp.agent.state}
            />
          </>
        )}
      </group>
      {isDragSource && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.5, 0.65, 32]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={0.3} />
        </mesh>
      )}
      {emp.agent.state !== 'idle' && !isDragSource && (
        <StatusBubble3D state={emp.agent.state} taskDesc={taskDesc} />
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow onClick={onFloorClick}>
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
        <meshStandardMaterial color="#3b82f6" transparent opacity={0.45} />
      </mesh>
      {/* Head sphere */}
      <mesh position={[0, 1.5, 0]} castShadow>
        <sphereGeometry args={[0.22, 12, 12]} />
        <meshStandardMaterial color="#3b82f6" transparent opacity={0.45} />
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
  const raycastToFloor = useCallback((clientX: number, clientY: number): [number, number, number] | null => {
    const canvas = gl.domElement;
    const rect = canvas.getBoundingClientRect();
    _pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_pointer, camera);
    const hit = _raycaster.ray.intersectPlane(_floorPlane, _intersectPoint);
    if (!hit) return null;
    return [_intersectPoint.x, 0, _intersectPoint.z];
  }, [camera, gl.domElement]);

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
function TaskFlowLine({ from, to, color, onComplete }: {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  onComplete: () => void;
}) {
  const matRef = useRef<THREE.LineBasicMaterial>(null);
  const startRef = useRef(performance.now() / 1000);
  const doneRef = useRef(false);

  const points = useMemo(() => [
    new THREE.Vector3(...from),
    new THREE.Vector3(...to),
  ], [from, to]);

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
function ZoneActivityGlow({ size, activityCount, hasBlocked }: {
  size: [number, number];
  activityCount: number;
  hasBlocked: boolean;
}) {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  const targetOpacity = hasBlocked ? 0.18 : activityCount >= 3 ? 0.20 : activityCount >= 1 ? 0.10 : 0.04;
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
  return (
    <Html position={[0, 2.5, 0]} center style={{ pointerEvents: 'none' }}>
      <div style={{
        background: 'rgba(148,163,184,0.20)',
        backdropFilter: 'blur(6px)',
        border: '1px solid #94a3b8',
        borderRadius: '9999px',
        padding: '3px 14px',
        whiteSpace: 'nowrap',
        animation: 'pulse 2s infinite',
      }}>
        <span style={{
          color: '#e2e8f0',
          fontSize: '10px',
          fontWeight: 900,
          letterSpacing: '3px',
          textTransform: 'uppercase',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}>
          MEETING
        </span>
      </div>
    </Html>
  );
}

/** Lines connecting each meeting participant to the meeting room center. */
export function MeetingParticipantLines({ participantPositions }: {
  participantPositions: [number, number, number][];
}) {
  const MTG_CENTER: [number, number, number] = [-10, 0.5, -8];

  const lines = useMemo(() => participantPositions.map((pos) => {
    const points = [new THREE.Vector3(...MTG_CENTER), new THREE.Vector3(...pos)];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.35, linewidth: 1 });
    return new THREE.Line(geo, mat);
  }), [participantPositions]);

  return (
    <>
      {lines.map((line, i) => <primitive key={i} object={line} />)}
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

  const targetColor = useMemo(() => {
    const values = [...agents.values()];
    const hasBlocked = values.some(a => a.state === 'blocked' || a.state === 'failed');
    const hasActive = values.some(a => a.state !== 'idle');
    const hasMeeting = values.some(a => a.state === 'meeting');
    if (hasBlocked) return '#ff9944';
    if (hasMeeting) return '#c4bfee';
    if (hasActive) return '#ffffff';
    return '#aabbcc';
  }, [agents]);

  const targetIntensity = useMemo(() => {
    const values = [...agents.values()];
    const hasMeeting = values.some(a => a.state === 'meeting');
    return hasMeeting ? 0.6 : 0.8;
  }, [agents]);

  // Memoize the THREE.Color object so we don't allocate a new one every frame
  const targetColorObj = useMemo(() => new THREE.Color(targetColor), [targetColor]);

  useFrame(() => {
    if (!lightRef.current) return;
    // Lerp toward target color/intensity each frame for smooth transitions
    const current = lightRef.current.color;
    current.lerp(targetColorObj, 0.02);
    lightRef.current.intensity = THREE.MathUtils.lerp(lightRef.current.intensity, targetIntensity, 0.02);
  });

  return <ambientLight ref={lightRef} intensity={0.8} color={targetColor} />;
}

// ── Main 3D View ────────────────────────────────────────────────────

export default function Office3DView() {
  const agents = useAgentStates();
  const placed = usePlacedEmployees(agents);
  const { eventBus } = useAicsRuntime();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState3D | null>(null);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const [flowLines, setFlowLines] = useState<FlowLineData[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);

  // ── Prefab data-driven rendering ──
  const { instances: prefabInstances } = usePrefabInstances();
  const hasPrefabData = prefabInstances.length > 0;

  const isDragging = dragState?.active ?? false;

  // ── Per-zone activity counters ──
  const zoneActivity = useMemo(() => {
    const activity: Record<string, { count: number; blocked: boolean }> = {};
    for (const zone of ZONES_3D) activity[zone.id] = { count: 0, blocked: false };
    for (const [, agent] of agents) {
      const zoneId = resolveEmployeeZone(agent);
      if (!activity[zoneId]) continue;
      if (agent.state !== 'idle') activity[zoneId].count++;
      if (agent.state === 'blocked' || agent.state === 'failed') activity[zoneId].blocked = true;
    }
    return activity;
  }, [agents]);

  // ── Scene-level stats for HUD ──
  const activeCount = useMemo(() => [...agents.values()].filter(a => a.state !== 'idle').length, [agents]);
  const blockedCount = useMemo(() => [...agents.values()].filter(a => a.state === 'blocked' || a.state === 'failed').length, [agents]);

  // Keep a stable ref to agents so the event handler reads latest without re-subscribing
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  // ── Task flow line event subscription ──
  useEffect(() => {
    const unsub = eventBus.on('task.state.changed', (event: RuntimeEvent) => {
      const payload = event.payload as { taskState?: string; assignedTo?: string } | undefined;
      if (payload?.taskState !== 'active') return;
      const assignedZoneId = payload.assignedTo
        ? resolveEmployeeZone(agentsRef.current.get(payload.assignedTo) ?? { role: 'employee' })
        : 'PROD';
      const mtgLayout = ZONE_3D_LAYOUT['MTG'];
      const targetLayout = ZONE_3D_LAYOUT[assignedZoneId] ?? ZONE_3D_LAYOUT['PROD'];
      if (!mtgLayout || !targetLayout) return;
      const line: FlowLineData = {
        id: `flow-${Date.now()}-${Math.random()}`,
        from: [mtgLayout.position[0], 0.5, mtgLayout.position[2]],
        to: [targetLayout.position[0], 0.5, targetLayout.position[2]],
        variant: 'normal',
        createdAt: Date.now(),
      };
      setFlowLines(prev => {
        const now = Date.now();
        const cleaned = prev.filter(l => now - l.createdAt < 5000);
        return [...cleaned, line].slice(-20);
      });
    });
    return () => { unsub(); };
  }, [eventBus]);

  const handleSelectEmployee = useCallback((id: string) => {
    setSelectedEmployeeId(id);
    eventBus.emit({
      type: 'scene.employee.selected',
      entityId: id,
      entityType: 'employee',
      companyId: COMPANY_ID,
      timestamp: Date.now(),
      payload: { employeeId: id, source: 'scene' },
    });
  }, [eventBus]);

  const handleDeselect = useCallback(() => {
    setSelectedEmployeeId(null);
    eventBus.emit({
      type: 'ui.selection.changed',
      entityId: '',
      entityType: 'employee',
      companyId: COMPANY_ID,
      timestamp: Date.now(),
      payload: { entityId: null, source: 'scene' },
    });
  }, [eventBus]);

  // ── Drag-to-assign handlers ──

  /** Called from EmployeeMarker onPointerDown — starts potential drag. */
  const handleEmployeeDragStart = useCallback((
    empId: string,
    agent: AgentState,
    e: React.PointerEvent<Element>,
  ) => {
    // Only primary button
    const nativeEvent = e as unknown as PointerEvent;
    if (nativeEvent.button !== 0) return;
    const zoneId = resolveEmployeeZone(agent);
    setDragState({
      employeeId: empId,
      sourceZoneId: zoneId,
      active: false,
      position: [0, 0, 0], // will be set on first move
      startScreenX: nativeEvent.clientX,
      startScreenY: nativeEvent.clientY,
    });
  }, []);

  /** Pointer move during drag — update ghost position and check threshold. */
  const handleDragMove = useCallback((worldX: number, worldZ: number, screenX: number, screenY: number) => {
    setDragState(prev => {
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
    const zone = hitTestZone3D(worldX, worldZ);
    setHoveredZoneId(zone?.id ?? null);
  }, []);

  /** Pointer up during drag — determine drop target and emit event. */
  const handleDragEnd = useCallback((worldX: number, worldZ: number) => {
    const ds = dragState;
    if (!ds) return;

    if (ds.active) {
      const targetZone = hitTestZone3D(worldX, worldZ);
      if (targetZone && targetZone.id !== ds.sourceZoneId) {
        // Valid drop — emit workstation assignment event
        eventBus.emit({
          type: 'employee.workstation.drop-requested',
          entityId: ds.employeeId,
          entityType: 'employee',
          companyId: COMPANY_ID,
          timestamp: Date.now(),
          payload: {
            employeeId: ds.employeeId,
            targetWorkstationId: targetZone.id,
          },
        });
      }
      // If dropped outside valid zone or on source zone → no-op
    } else {
      // Didn't exceed threshold — treat as click
      handleSelectEmployee(ds.employeeId);
    }

    setDragState(null);
    setHoveredZoneId(null);
    document.body.style.cursor = 'default';
  }, [dragState, eventBus, handleSelectEmployee]);

  /** Cancel drag (Escape, pointer leave). */
  const handleDragCancel = useCallback(() => {
    setDragState(null);
    setHoveredZoneId(null);
    document.body.style.cursor = 'default';
  }, []);

  return (
    <div className="w-full h-full bg-slate-950" style={{ cursor: isDragging ? 'grabbing' : undefined }}>
      <Canvas shadows camera={{ position: [0, 22, 28], fov: 45 }}>
        <color attach="background" args={['#020617']} />
        <fog attach="fog" args={['#020617', 40, 100]} />

        {/* Lighting — AmbientStateLight replaces static ambientLight */}
        <AmbientStateLight agents={agents} />
        <directionalLight
          castShadow
          position={[12, 25, 12]}
          intensity={1.5}
          shadow-mapSize={[2048, 2048]}
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
        {ZONES_3D.map((z) => (
          <ZoneLabel
            key={z.id}
            position={z.position}
            size={z.size}
            color={z.accent}
            name={z.label}
            isDragging={isDragging && z.deskSlots > 0}
            isHovered={hoveredZoneId === z.id}
            isSource={isDragging ? dragState!.sourceZoneId === z.id : false}
            activityCount={zoneActivity[z.id]?.count ?? 0}
            hasBlocked={zoneActivity[z.id]?.blocked ?? false}
            isMeetingActive={z.id === 'MTG' && (zoneActivity['MTG']?.count ?? 0) > 0}
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
            isDragSource={isDragging && dragState!.employeeId === emp.id}
            onSelect={handleSelectEmployee}
            onDragStart={handleEmployeeDragStart}
          />
        ))}

        {/* ── Task flow lines ── */}
        {flowLines.map((line) => (
          <TaskFlowLine
            key={line.id}
            from={line.from}
            to={line.to}
            color={line.variant === 'handoff' ? '#f97316' : '#60a5fa'}
            onComplete={() => setFlowLines(prev => prev.filter(l => l.id !== line.id))}
          />
        ))}

        {/* ── Scene HUD overlay ── */}
        <Html position={[18, 14, 0]} center style={{ pointerEvents: 'none' }}>
          <div style={{
            fontSize: '10px',
            fontFamily: 'monospace',
            color: 'rgba(255,255,255,0.6)',
            background: 'rgba(0,0,0,0.4)',
            borderRadius: '8px',
            padding: '4px 8px',
            backdropFilter: 'blur(4px)',
            whiteSpace: 'nowrap',
          }}>
            <div>⚡ {activeCount} active</div>
            {blockedCount > 0 && (
              <div style={{ color: '#fbbf24' }}>⚠ {blockedCount} blocked</div>
            )}
          </div>
        </Html>

        {/* ── Drag ghost ── */}
        {isDragging && dragState && (
          <DragGhost3D position={dragState.position} />
        )}

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
