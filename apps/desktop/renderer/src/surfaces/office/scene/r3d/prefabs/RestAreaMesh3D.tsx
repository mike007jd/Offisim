/**
 * RestAreaMesh3D — Rest area with sofas, coffee table, and vending machine.
 *
 * Extracted from Office3DView.tsx RestAreaFurniture component.
 */

import { RoundedBox } from '@react-three/drei';
import { EmissiveMaterial, SceneMaterial } from '../scene-materials.js';
import { useSceneColors } from '../use-scene-colors.js';

const SEAT_CUSHION_THICKNESS = 0.1;
const SEAT_CUSHION_RADIUS = 0.04;

export interface RestAreaMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
}

export function RestAreaMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
}: RestAreaMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <RoundedBox
        args={[3.9, 0.42, 1.12]}
        position={[-0.9, 0.24, -1.45]}
        radius={0.12}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="leather" color={sc.accentWarm} />
      </RoundedBox>
      <RoundedBox
        args={[3.9, 0.72, 0.28]}
        position={[-0.9, 0.58, -1.94]}
        radius={0.1}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="leather" color={sc.accentWarm} />
      </RoundedBox>
      <RoundedBox
        args={[1.1, 0.42, 2.6]}
        position={[-2.3, 0.24, -0.16]}
        radius={0.12}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="leather" color={sc.accentWarm} />
      </RoundedBox>
      <RoundedBox
        args={[0.28, 0.68, 2.6]}
        position={[-2.82, 0.56, -0.16]}
        radius={0.1}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="leather" color={sc.accentWarm} />
      </RoundedBox>

      {[-2.1, -1.05, 0.0].map((x) => (
        <RoundedBox
          key={`sofa-seat-${x}`}
          args={[0.78, SEAT_CUSHION_THICKNESS, 0.58]}
          position={[x, 0.49, -1.38]}
          radius={SEAT_CUSHION_RADIUS}
          smoothness={4}
          castShadow
        >
          <SceneMaterial materialClass="fabric" color={sc.furnitureLight} />
        </RoundedBox>
      ))}
      {[-0.9, 0.15].map((z) => (
        <RoundedBox
          key={`chaise-seat-${z}`}
          args={[0.58, SEAT_CUSHION_THICKNESS, 0.82]}
          position={[-2.28, 0.49, z]}
          radius={SEAT_CUSHION_RADIUS}
          smoothness={4}
          castShadow
        >
          <SceneMaterial materialClass="fabric" color={sc.furnitureLight} />
        </RoundedBox>
      ))}

      <RoundedBox
        args={[0.72, 0.18, 0.72]}
        position={[2.0, 0.2, 1.3]}
        radius={0.08}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="fabric" color={sc.furnitureLight} />
      </RoundedBox>
      <group position={[2.55, 0, -1.5]}>
        <mesh position={[0, 0.82, 0]} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 1.64, 10]} />
          <SceneMaterial materialClass="metal-brushed" color={sc.deskEdge} />
        </mesh>
        <mesh position={[0, 0.06, 0]} castShadow>
          <cylinderGeometry args={[0.28, 0.32, 0.06, 18]} />
          <SceneMaterial materialClass="metal" color={sc.deskEdge} />
        </mesh>
        <mesh position={[0, 1.68, 0]} castShadow>
          <coneGeometry args={[0.34, 0.34, 18, 1, true]} />
          <SceneMaterial materialClass="fabric" color={sc.furnitureLight} />
        </mesh>
        <mesh position={[0, 1.55, 0]}>
          <sphereGeometry args={[0.09, 14, 10]} />
          <EmissiveMaterial color={sc.whiteboardSurface} tier="accent" intensity={0.34} />
        </mesh>
      </group>
    </group>
  );
}
