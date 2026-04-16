import type { Zone } from '@offisim/shared-types';
import { Html } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { useAgentAnimation } from '../../hooks/useAgentAnimation.js';
import { useCharacterMovement } from '../../hooks/useCharacterMovement.js';
import {
  registerMovementHandle,
  unregisterMovementHandle,
} from '../../hooks/useSceneOrchestrator.js';
import {
  type SeatRegistry,
  computeRestSeatPosition,
  computeWorkspaceFallbackSeatPosition,
} from '../../lib/seat-registry.js';
import { STATE_LABELS } from '../../lib/state-labels';
import type { AgentState, SubTaskInfo } from '../../runtime/use-agent-states';
import { useSceneColors } from '../../theme/use-scene-colors.js';
import { useCompany } from '../company/CompanyContext.js';
import type { Zone3D } from './office3d-shared.js';
import { resolveEmployeeSceneZoneId } from './office3d-shared.js';

import { outfitColorFromSeed, resolveAvatarSeed, skinToneFromSeed } from '../../lib/avatar-seed.js';

export interface PlacedEmployee {
  id: string;
  agent: AgentState;
  globalIndex: number;
  seed: string;
  position: [number, number, number];
}

export function usePlacedEmployees(
  agents: Map<string, AgentState>,
  zones3D: readonly Zone3D[],
  zones: readonly Zone[],
  registry: SeatRegistry | null,
): PlacedEmployee[] {
  return useMemo(() => {
    if (zones3D.length === 0) return [];

    const restZone = zones3D.find((zone) => zone.archetype === 'rest');
    const restZoneLayout = restZone
      ? { position: restZone.position, size: restZone.size }
      : { position: [8, 0, 2] as [number, number, number], size: [14, 8] as [number, number] };
    const restZoneId = restZone?.zoneId ?? 'rest';

    const zoneEmployees = new Map<
      string,
      { id: string; agent: AgentState; globalIndex: number; seed: string }[]
    >();
    for (const zone of zones3D) {
      zoneEmployees.set(zone.zoneId, []);
    }

    let globalIdx = 0;
    for (const [id, agent] of agents) {
      const zoneId = agent.state === 'idle' ? restZoneId : resolveEmployeeSceneZoneId(agent, zones);
      const zoneBucket = zoneEmployees.get(zoneId);
      if (zoneBucket) {
        zoneBucket.push({ id, agent, globalIndex: globalIdx, seed: resolveAvatarSeed(agent) });
      }
      globalIdx++;
    }

    const placed: PlacedEmployee[] = [];
    for (const zone of zones3D) {
      const zoneEmployeesForZone = zoneEmployees.get(zone.zoneId) ?? [];
      zoneEmployeesForZone.forEach((employee, slotIdx) => {
        if (zone.zoneId === restZoneId) {
          if (registry) {
            const restPos = registry.getRestSeat(zones, slotIdx);
            placed.push({
              id: employee.id,
              agent: employee.agent,
              globalIndex: employee.globalIndex,
              seed: employee.seed,
              position: restPos,
            });
            return;
          }
          placed.push({
            id: employee.id,
            agent: employee.agent,
            globalIndex: employee.globalIndex,
            seed: employee.seed,
            position: computeRestSeatPosition(
              restZoneLayout.position[0],
              restZoneLayout.position[2],
              slotIdx,
            ),
          });
          return;
        }

        // Try SeatRegistry first
        if (registry) {
          const seat = registry.getSeat(zone.zoneId, slotIdx);
          if (seat) {
            placed.push({
              id: employee.id,
              agent: employee.agent,
              globalIndex: employee.globalIndex,
              seed: employee.seed,
              position: [...seat.position],
            });
            return;
          }
        }
        // Fallback: deterministic zone-center offset
        const deskPos = computeWorkspaceFallbackSeatPosition(
          zone.position[0],
          zone.position[2],
          slotIdx,
        );
        placed.push({
          id: employee.id,
          agent: employee.agent,
          globalIndex: employee.globalIndex,
          seed: employee.seed,
          position: deskPos,
        });
      });
    }

    return placed;
  }, [agents, zones3D, zones, registry]);
}

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
      <mesh ref={limbRefs?.leftLeg} position={[-0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      <mesh ref={limbRefs?.rightLeg} position={[0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[0.36, 0.5, 0.2]} />
        <meshStandardMaterial color={outfitColor} roughness={0.7} />
      </mesh>
      <mesh ref={limbRefs?.leftArm} position={[-0.25, 0.75, 0]} castShadow>
        <boxGeometry args={[0.1, 0.45, 0.1]} />
        <meshStandardMaterial color={skinTone} roughness={0.4} />
      </mesh>
      <mesh ref={limbRefs?.rightArm} position={[0.25, 0.75, 0]} castShadow>
        <boxGeometry args={[0.1, 0.45, 0.1]} />
        <meshStandardMaterial color={skinTone} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <meshStandardMaterial color={skinTone} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.48, 0]} castShadow>
        <boxGeometry args={[0.32, 0.16, 0.32]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
      </mesh>
      <mesh ref={ringRef} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.4, 0.55, 32]} />
        <meshBasicMaterial ref={ringMatRef} transparent opacity={0} toneMapped={false} />
      </mesh>
    </group>
  );
}

function StatusBubble3D({
  state,
  taskDesc,
  blockReason,
  subTasks,
}: {
  state: string;
  taskDesc?: string;
  blockReason?: string;
  subTasks?: SubTaskInfo[];
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

  const hasMultiTasks = subTasks && subTasks.length > 1;
  const completedCount = subTasks?.filter((task) => task.status === 'done').length ?? 0;
  const totalCount = subTasks?.length ?? 0;
  const allDone = hasMultiTasks && completedCount === totalCount;
  const hasFailed = subTasks?.some((task) => task.status === 'failed') ?? false;

  let displayText = label;
  if (hasMultiTasks) {
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

export function EmployeeMarker({
  emp,
  isSelected,
  isDragSource,
  taskDesc,
  onSelect,
  onDragStart,
}: {
  emp: PlacedEmployee;
  isSelected: boolean;
  isDragSource?: boolean;
  taskDesc?: string;
  onSelect: (id: string) => void;
  onDragStart?: (empId: string, agent: AgentState, e: React.PointerEvent<Element>) => void;
}) {
  const sc = useSceneColors();
  const outfit = outfitColorFromSeed(emp.seed);
  const skin = skinToneFromSeed(emp.seed);

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

  const groupRef = useRef<THREE.Group>(null);
  const seededPositionRef = useRef(false);
  const movementHandle = useCharacterMovement(groupRef, limbRefs);

  const { activeCompanyId: markerCompanyId } = useCompany();
  useEffect(() => {
    if (!markerCompanyId) return;
    registerMovementHandle(markerCompanyId, emp.id, movementHandle);
    return () => unregisterMovementHandle(markerCompanyId, emp.id);
  }, [markerCompanyId, emp.id, movementHandle]);

  useEffect(() => {
    // Cast needed: in jsdom tests groupRef.current is a DOM element, not THREE.Group
    const group = groupRef.current as {
      position?: { x: number; z: number; set(x: number, y: number, z: number): void };
    } | null;
    if (!group?.position?.set) {
      return;
    }

    if (!seededPositionRef.current) {
      group.position.set(emp.position[0], 0, emp.position[2]);
      seededPositionRef.current = true;
      return;
    }

    if (movementHandle.isMoving()) {
      return;
    }

    const currentPosition = movementHandle.getPosition();
    if (!currentPosition) {
      group.position.set(emp.position[0], 0, emp.position[2]);
      return;
    }

    const drift = Math.hypot(
      currentPosition[0] - emp.position[0],
      currentPosition[2] - emp.position[2],
    );
    if (drift < 0.05) {
      group.position.set(emp.position[0], 0, emp.position[2]);
    }
  }, [emp.position, movementHandle]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: react-three-fiber groups are not keyboard-focusable DOM nodes.
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
      <group scale={isDragSource ? [0.85, 0.85, 0.85] : [1, 1, 1]}>
        {isSelected && (
          <>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
              <ringGeometry args={[0.6, 0.75, 32]} />
              <meshBasicMaterial color={sc.selectionRing} transparent opacity={0.8} />
            </mesh>
            <Html position={[0, 1.85, 0]} center style={{ pointerEvents: 'none' }}>
              <div
                style={{
                  background: 'rgba(59,130,246,0.85)',
                  color: '#ffffff',
                  fontSize: '9px',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  whiteSpace: 'nowrap',
                  fontFamily: 'system-ui, sans-serif',
                }}
              >
                {emp.agent.name ?? emp.id}
              </div>
            </Html>
          </>
        )}
        <LowPolyCharacter
          outfitColor={outfit}
          skinTone={skin}
          state={emp.agent.state}
          limbRefs={limbRefs}
        />
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
