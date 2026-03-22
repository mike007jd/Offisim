/**
 * WorkstationMesh3D — 4-seat desk cluster with laptops and glass dividers.
 *
 * Extracted from Office3DView.tsx DeskCluster component.
 * Renders a complete workstation prefab with desk surface, legs,
 * glass dividers, laptops, and office chairs.
 */

import { RoundedBox } from '@react-three/drei';
import { useSceneColors } from '../../../theme/use-scene-colors.js';

// ── Sub-components (shared with other prefabs) ────────────────────

export function OfficeChair({ position, rotation = [0, 0, 0] }: {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  const sc = useSceneColors();
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.05, 16]} />
        <meshStandardMaterial color={sc.furnitureDark} />
      </mesh>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.4, 8]} />
        <meshStandardMaterial color={sc.furnitureLight} metalness={0.8} roughness={0.2} />
      </mesh>
      <RoundedBox args={[0.5, 0.08, 0.5]} position={[0, 0.45, 0]} radius={0.02} smoothness={4} castShadow>
        <meshStandardMaterial color={sc.furniture} />
      </RoundedBox>
      <RoundedBox args={[0.45, 0.5, 0.05]} position={[0, 0.75, 0.22]} radius={0.02} smoothness={4} castShadow>
        <meshStandardMaterial color={sc.furniture} />
      </RoundedBox>
    </group>
  );
}

export function Laptop({ position, rotation = [0, 0, 0] }: {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  const sc = useSceneColors();
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.01, 0]} castShadow>
        <boxGeometry args={[0.4, 0.02, 0.3]} />
        <meshStandardMaterial color={sc.metal} metalness={0.8} roughness={0.2} />
      </mesh>
      <group position={[0, 0.02, -0.15]} rotation={[-0.2, 0, 0]}>
        <mesh position={[0, 0.15, 0]} castShadow>
          <boxGeometry args={[0.4, 0.3, 0.02]} />
          <meshStandardMaterial color={sc.metal} metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0.15, 0.011]}>
          <planeGeometry args={[0.38, 0.28]} />
          <meshBasicMaterial color={sc.screen} />
        </mesh>
      </group>
    </group>
  );
}

// ── Main component ────────────────────────────────────────────────

export interface WorkstationMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
}

export function WorkstationMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
}: WorkstationMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {/* Desk surface */}
      <RoundedBox args={[3.2, 0.05, 3.2]} position={[0, 0.75, 0]} radius={0.02} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color={sc.desk} roughness={0.2} />
      </RoundedBox>
      {/* Legs */}
      {[-1.5, 1.5].map(x => [-1.5, 1.5].map(z => (
        <mesh key={`leg-${x}-${z}`} position={[x, 0.375, z]} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 0.75, 8]} />
          <meshStandardMaterial color={sc.deskEdge} metalness={0.5} />
        </mesh>
      )))}
      {/* Glass dividers */}
      <mesh position={[0, 1.05, 0]} castShadow>
        <boxGeometry args={[3.0, 0.6, 0.05]} />
        <meshPhysicalMaterial color={sc.partition} transmission={0.9} opacity={1} roughness={0.1} ior={1.5} thickness={0.05} transparent />
      </mesh>
      <mesh position={[0, 1.05, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[3.0, 0.6, 0.05]} />
        <meshPhysicalMaterial color={sc.partition} transmission={0.9} opacity={1} roughness={0.1} ior={1.5} thickness={0.05} transparent />
      </mesh>
      {/* 4 workstations — laptops face OUTWARD toward the employee/chair */}
      {([
        [-0.8, -0.8, Math.PI + 0.2],  // top-left: screen faces -z (toward chair)
        [0.8, -0.8, Math.PI - 0.2],   // top-right: screen faces -z
        [-0.8, 0.8, -0.2],            // bottom-left: screen faces +z (toward chair)
        [0.8, 0.8, 0.2],              // bottom-right: screen faces +z
      ] as [number, number, number][]).map(([x, z, rot], i) => (
        <group key={`ws-${i}`} position={[x, 0, z]}>
          <Laptop position={[0, 0.775, 0]} rotation={[0, rot, 0]} />
          <OfficeChair position={[0, 0, z < 0 ? -0.8 : 0.8]} rotation={[0, z < 0 ? Math.PI : 0, 0]} />
        </group>
      ))}
    </group>
  );
}
