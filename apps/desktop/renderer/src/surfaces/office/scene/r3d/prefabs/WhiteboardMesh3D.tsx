import { RoundedBox } from '@react-three/drei';
import { SceneMaterial } from '../scene-materials.js';
import { EmissiveDecalMaterial, SceneDecalMaterial } from '../scene-surface-materials.js';
import { useSceneColors } from '../use-scene-colors.js';

const WHITEBOARD_DEPTH = 0.08;
const WHITEBOARD_RADIUS = 0.038;

export interface WhiteboardMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
}

export function WhiteboardMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
}: WhiteboardMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const frameBars = [
    [0, 2.08, 2.52, 0.08],
    [0, 0.6, 2.52, 0.08],
    [-1.25, 1.34, 0.08, 1.44],
    [1.25, 1.34, 0.08, 1.44],
  ] as const;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <RoundedBox
        args={[2.38, 1.42, WHITEBOARD_DEPTH]}
        position={[0, 1.34, 0]}
        radius={WHITEBOARD_RADIUS}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <SceneMaterial materialClass="plastic" color={sc.whiteboardSurface} />
      </RoundedBox>

      {frameBars.map(([x, y, w, h]) => (
        <mesh key={`whiteboard-frame-${x}-${y}`} position={[x, y, 0.055]} castShadow>
          <boxGeometry args={[w, h, 0.08]} />
          <SceneMaterial materialClass="metal" color={sc.metal} />
        </mesh>
      ))}

      <mesh position={[0, 0.49, 0.12]} castShadow>
        <boxGeometry args={[1.75, 0.07, 0.16]} />
        <SceneMaterial materialClass="metal" color={sc.furnitureLight} />
      </mesh>
      <mesh position={[-0.55, 0.548, 0.22]} rotation={[0, 0, 0.08]} castShadow>
        <boxGeometry args={[0.32, 0.035, 0.035]} />
        <SceneMaterial materialClass="plastic" color={sc.whiteboardMarker[0]} />
      </mesh>
      <mesh position={[-0.15, 0.548, 0.22]} rotation={[0, 0, -0.04]} castShadow>
        <boxGeometry args={[0.32, 0.035, 0.035]} />
        <SceneMaterial materialClass="plastic" color={sc.whiteboardMarker[2]} />
      </mesh>

      <mesh position={[-0.55, 1.3, 0.05]}>
        <planeGeometry args={[0.32, 0.04]} />
        <EmissiveDecalMaterial color={sc.whiteboardMarker[0]} tier="accent" intensity={0.6} />
      </mesh>
      <mesh position={[0.1, 1.15, 0.05]} rotation={[0, 0, -0.18]}>
        <planeGeometry args={[0.52, 0.03]} />
        <SceneDecalMaterial materialClass="plastic" color={sc.whiteboardMarker[1]} />
      </mesh>
      <mesh position={[0.38, 0.95, 0.05]} rotation={[0, 0, 0.12]}>
        <planeGeometry args={[0.42, 0.03]} />
        <SceneDecalMaterial materialClass="plastic" color={sc.whiteboardMarker[2]} />
      </mesh>
      <mesh position={[0, 0.24, -0.05]} castShadow>
        <boxGeometry args={[0.08, 0.54, 0.08]} />
        <SceneMaterial materialClass="metal" color={sc.metal} />
      </mesh>
      <mesh position={[0, 0.04, -0.05]} castShadow>
        <boxGeometry args={[1.0, 0.08, 0.42]} />
        <SceneMaterial materialClass="metal" color={sc.metal} />
      </mesh>
    </group>
  );
}
