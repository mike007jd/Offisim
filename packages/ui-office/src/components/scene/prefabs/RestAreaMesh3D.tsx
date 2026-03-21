/**
 * RestAreaMesh3D — Rest area with sofas, coffee table, and vending machine.
 *
 * Extracted from Office3DView.tsx RestAreaFurniture component.
 */

import { RoundedBox } from '@react-three/drei';
import { PlantMesh3D } from './DecorativeMesh3D.js';

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
  const rotY = (rotation * Math.PI) / 180;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {/* Carpet */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[10, 6]} />
        <meshStandardMaterial color="#334155" roughness={0.9} />
      </mesh>
      {/* Sofa set 1 - L shape */}
      <RoundedBox args={[4, 0.4, 1.2]} position={[-1, 0.2, -2.2]} radius={0.1} castShadow>
        <meshStandardMaterial color="#f59e0b" roughness={0.7} />
      </RoundedBox>
      <RoundedBox args={[4, 0.6, 0.3]} position={[-1, 0.5, -2.75]} radius={0.1} castShadow>
        <meshStandardMaterial color="#f59e0b" roughness={0.7} />
      </RoundedBox>
      {/* Sofa set 2 */}
      <RoundedBox args={[3, 0.4, 1]} position={[1, 0.2, 2]} radius={0.1} castShadow>
        <meshStandardMaterial color="#d97706" roughness={0.7} />
      </RoundedBox>
      <RoundedBox args={[3, 0.6, 0.3]} position={[1, 0.5, 2.45]} radius={0.1} castShadow>
        <meshStandardMaterial color="#d97706" roughness={0.7} />
      </RoundedBox>
      {/* Coffee table */}
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.8, 0.8, 0.05, 32]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[0.4, 0.2, 0.3, 16]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      {/* Vending machine */}
      <group position={[5.5, 0, -2]}>
        <RoundedBox args={[1, 2.2, 0.8]} position={[0, 1.1, 0]} radius={0.05} castShadow>
          <meshStandardMaterial color="#1e293b" metalness={0.4} roughness={0.3} />
        </RoundedBox>
        {/* Screen */}
        <mesh position={[0, 1.4, 0.41]}>
          <planeGeometry args={[0.7, 0.5]} />
          <meshBasicMaterial color="#f59e0b" />
        </mesh>
        {/* Product window */}
        <mesh position={[0, 0.8, 0.41]}>
          <planeGeometry args={[0.7, 0.8]} />
          <meshPhysicalMaterial color="#bae6fd" transmission={0.8} opacity={1} roughness={0.1} ior={1.5} thickness={0.05} transparent />
        </mesh>
      </group>
      <PlantMesh3D position={[-5, 0, -2.5]} />
      <PlantMesh3D position={[4, 0, 2.5]} />
    </group>
  );
}
