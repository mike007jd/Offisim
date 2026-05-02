/**
 * WorkstationMesh3D — 4-seat desk cluster with laptops and glass dividers.
 *
 * Extracted from Office3DView.tsx DeskCluster component.
 * Renders a complete workstation prefab with desk surface, legs,
 * glass dividers, laptops, and office chairs.
 */

import { RoundedBox } from '@react-three/drei';
import { SceneMaterial } from '../../../theme/scene-materials.js';
import { useSceneColors } from '../../../theme/use-scene-colors.js';

// ── Sub-components (shared with other prefabs) ────────────────────

export function OfficeChair({
  position,
  rotation = [0, 0, 0],
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  const sc = useSceneColors();
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.05, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.05, 16]} />
        <SceneMaterial materialClass="plastic" color={sc.furnitureDark} />
      </mesh>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.4, 8]} />
        <SceneMaterial
          materialClass="metal"
          color={sc.furnitureLight}
          overrides={{ roughness: 0.3 }}
        />
      </mesh>
      <RoundedBox
        args={[0.5, 0.08, 0.5]}
        position={[0, 0.45, 0]}
        radius={0.02}
        smoothness={4}
        castShadow
      >
        <SceneMaterial materialClass="leather" color={sc.furniture} />
      </RoundedBox>
      <RoundedBox
        args={[0.45, 0.5, 0.05]}
        position={[0, 0.75, 0.22]}
        radius={0.02}
        smoothness={4}
        castShadow
      >
        <SceneMaterial materialClass="leather" color={sc.furniture} />
      </RoundedBox>
    </group>
  );
}

export function Laptop({
  position,
  rotation = [0, 0, 0],
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  const sc = useSceneColors();
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.01, 0]} castShadow>
        <boxGeometry args={[0.4, 0.02, 0.3]} />
        <SceneMaterial materialClass="metal" color={sc.metal} overrides={{ roughness: 0.25 }} />
      </mesh>
      <group position={[0, 0.02, -0.15]} rotation={[-0.2, 0, 0]}>
        <mesh position={[0, 0.15, 0]} castShadow>
          <boxGeometry args={[0.4, 0.3, 0.02]} />
          <SceneMaterial materialClass="metal" color={sc.metal} overrides={{ roughness: 0.25 }} />
        </mesh>
        <mesh position={[0, 0.15, 0.011]}>
          <planeGeometry args={[0.38, 0.28]} />
          <meshBasicMaterial color={sc.screen} />
        </mesh>
      </group>
    </group>
  );
}

export function WorkSurfaceAccent3D({
  width,
  depth,
  opacity = 0.76,
}: {
  width: number;
  depth: number;
  opacity?: number;
}) {
  const sc = useSceneColors();
  return (
    <group position={[0, 0.006, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <SceneMaterial
          materialClass="fabric"
          color={sc.workMat}
          overrides={{ transparent: true, opacity }}
        />
      </mesh>
      <mesh position={[0, 0.006, -depth / 2 + 0.05]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[Math.min(width * 0.72, 0.62), 0.035]} />
        <meshBasicMaterial color={sc.cableAccent} transparent opacity={0.55} />
      </mesh>
    </group>
  );
}

export interface WorkstationUnit3DProps {
  position?: [number, number, number];
  rotation?: number;
  variant?: 'standard' | 'compact' | 'dual';
  state?: string;
}

export function WorkstationUnit3D({
  position = [0, 0, 0],
  rotation = 0,
  variant = 'standard',
  state: _state,
}: WorkstationUnit3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const isCompact = variant === 'compact';
  const isDual = variant === 'dual';
  const deskWidth = isCompact ? 1.45 : 2.1;
  const deskDepth = isCompact ? 1.05 : 1.25;
  const laptopPositions = isDual
    ? ([
        [-0.35, -0.2, Math.PI + 0.1],
        [0.35, -0.2, Math.PI - 0.1],
      ] as [number, number, number][])
    : ([[0, -0.2, Math.PI]] as [number, number, number][]);

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <RoundedBox
        args={[deskWidth, 0.055, deskDepth]}
        position={[0, 0.74, 0]}
        radius={0.02}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <SceneMaterial
          materialClass="wood"
          color={sc.desk}
          overrides={{ useProceduralNormal: true, normalScale: 0.06 }}
        />
      </RoundedBox>
      <group position={[0, 0.775, 0.16]}>
        <WorkSurfaceAccent3D width={deskWidth * 0.62} depth={deskDepth * 0.46} opacity={0.78} />
      </group>
      {[-1, 1].map((xSign) =>
        [-1, 1].map((zSign) => (
          <mesh
            key={`unit-leg-${xSign}-${zSign}`}
            position={[xSign * (deskWidth / 2 - 0.12), 0.37, zSign * (deskDepth / 2 - 0.12)]}
            castShadow
          >
            <cylinderGeometry args={[0.035, 0.035, 0.72, 8]} />
            <SceneMaterial
              materialClass="metal"
              color={sc.deskEdge}
              overrides={{ roughness: 0.3 }}
            />
          </mesh>
        )),
      )}
      <mesh position={[0, 1.05, -deskDepth / 2 + 0.06]} castShadow>
        <boxGeometry args={[deskWidth * 0.82, 0.48, 0.045]} />
        <SceneMaterial materialClass="glass" color={sc.partition} overrides={{ thickness: 0.04 }} />
      </mesh>
      {laptopPositions.map(([x, z, rot]) => (
        <Laptop key={`unit-laptop-${x}`} position={[x, 0.78, z]} rotation={[0, rot, 0]} />
      ))}
      {!isCompact && (
        <OfficeChair position={[0, 0, deskDepth / 2 + 0.5]} rotation={[0, Math.PI, 0]} />
      )}
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
      <RoundedBox
        args={[3.2, 0.05, 3.2]}
        position={[0, 0.75, 0]}
        radius={0.02}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <SceneMaterial
          materialClass="wood"
          color={sc.desk}
          overrides={{ useProceduralNormal: true, normalScale: 0.08 }}
        />
      </RoundedBox>
      {(
        [
          [-0.8, -0.9, Math.PI],
          [0.8, -0.9, Math.PI],
          [-0.8, 0.9, 0],
          [0.8, 0.9, 0],
        ] as [number, number, number][]
      ).map(([x, z, rot]) => (
        <group key={`mat-${x}-${z}`} position={[x, 0.785, z]} rotation={[0, rot, 0]}>
          <WorkSurfaceAccent3D width={0.76} depth={0.46} opacity={0.82} />
        </group>
      ))}
      {/* Legs */}
      {[-1.5, 1.5].map((x) =>
        [-1.5, 1.5].map((z) => (
          <mesh key={`leg-${x}-${z}`} position={[x, 0.375, z]} castShadow>
            <cylinderGeometry args={[0.04, 0.04, 0.75, 8]} />
            <SceneMaterial
              materialClass="metal"
              color={sc.deskEdge}
              overrides={{ roughness: 0.3 }}
            />
          </mesh>
        )),
      )}
      {/* Glass dividers */}
      <mesh position={[0, 1.05, 0]} castShadow>
        <boxGeometry args={[3.0, 0.6, 0.05]} />
        <SceneMaterial materialClass="glass" color={sc.partition} overrides={{ thickness: 0.05 }} />
      </mesh>
      <mesh position={[0, 1.05, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[3.0, 0.6, 0.05]} />
        <SceneMaterial materialClass="glass" color={sc.partition} overrides={{ thickness: 0.05 }} />
      </mesh>
      <mesh position={[0, 1.38, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[3.05, 0.025, 0.035]} />
        <SceneMaterial materialClass="metal" color={sc.metal} />
      </mesh>
      <mesh position={[0, 1.38, 0]}>
        <boxGeometry args={[3.05, 0.025, 0.035]} />
        <SceneMaterial materialClass="metal" color={sc.metal} />
      </mesh>
      {/* 4 workstations — laptops face OUTWARD toward the employee/chair */}
      {(
        [
          [-0.8, -0.8, Math.PI + 0.2], // top-left: screen faces -z (toward chair)
          [0.8, -0.8, Math.PI - 0.2], // top-right: screen faces -z
          [-0.8, 0.8, -0.2], // bottom-left: screen faces +z (toward chair)
          [0.8, 0.8, 0.2], // bottom-right: screen faces +z
        ] as [number, number, number][]
      ).map(([x, z, rot]) => (
        <group key={`ws-${x}-${z}-${rot}`} position={[x, 0, z]}>
          <Laptop position={[0, 0.775, 0]} rotation={[0, rot, 0]} />
          <OfficeChair
            position={[0, 0, z < 0 ? -0.8 : 0.8]}
            rotation={[0, z < 0 ? Math.PI : 0, 0]}
          />
        </group>
      ))}
    </group>
  );
}
