import { RoundedBox } from '@react-three/drei';
import { useSceneColors } from '../../../theme/use-scene-colors.js';

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

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.08, 1.1, 0.08]} />
        <meshStandardMaterial color={sc.furnitureLight} metalness={0.55} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.95, 0]} castShadow>
        <boxGeometry args={[0.08, 1.1, 0.08]} />
        <meshStandardMaterial color={sc.furnitureLight} metalness={0.55} roughness={0.4} />
      </mesh>

      <RoundedBox
        args={[2.1, 1.3, 0.08]}
        position={[0, 1.25, 0]}
        radius={0.05}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#f8fafc" roughness={0.85} />
      </RoundedBox>

      <mesh position={[0, 0.55, 0.08]} castShadow>
        <boxGeometry args={[1.5, 0.06, 0.16]} />
        <meshStandardMaterial color={sc.furniture} roughness={0.55} />
      </mesh>

      <mesh position={[-0.55, 1.3, 0.05]}>
        <boxGeometry args={[0.32, 0.04, 0.02]} />
        <meshStandardMaterial color="#06b6d4" emissive="#0f172a" emissiveIntensity={0.12} />
      </mesh>
      <mesh position={[0.1, 1.15, 0.05]} rotation={[0, 0, -0.18]}>
        <boxGeometry args={[0.52, 0.03, 0.02]} />
        <meshStandardMaterial color="#334155" roughness={0.7} />
      </mesh>
      <mesh position={[0.38, 0.95, 0.05]} rotation={[0, 0, 0.12]}>
        <boxGeometry args={[0.42, 0.03, 0.02]} />
        <meshStandardMaterial color="#f97316" roughness={0.7} />
      </mesh>
    </group>
  );
}
