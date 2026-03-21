/**
 * ServerRackMesh3D — Server room with rack cabinets and LED indicators.
 *
 * Extracted from Office3DView.tsx ServerRoomFurniture component.
 */

import { RoundedBox } from '@react-three/drei';
import { useSceneColors } from '../../../theme/use-scene-colors.js';

export interface ServerRackMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
}

export function ServerRackMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
}: ServerRackMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {/* Server racks */}
      {[-4, -1.5, 1, 3.5].map((x, ri) => (
        <group key={`rack-${ri}`} position={[x, 0, -0.5]}>
          {/* Rack cabinet */}
          <RoundedBox args={[1.6, 2.8, 1]} position={[0, 1.4, 0]} radius={0.03} smoothness={4} castShadow>
            <meshStandardMaterial color={sc.serverBody} metalness={0.6} roughness={0.3} />
          </RoundedBox>
          {/* Front panel */}
          <mesh position={[0, 1.4, 0.51]}>
            <planeGeometry args={[1.4, 2.6]} />
            <meshStandardMaterial color={sc.furniture} metalness={0.4} roughness={0.4} />
          </mesh>
          {/* LED indicator rows */}
          {[0.4, 0.7, 1.0, 1.3, 1.6, 1.9, 2.2, 2.5].map((y, li) => (
            <group key={`led-row-${li}`}>
              {[-0.4, -0.2, 0, 0.2, 0.4].map((lx, lj) => (
                <mesh key={`led-${lj}`} position={[lx, y, 0.52]}>
                  <circleGeometry args={[0.03, 8]} />
                  <meshBasicMaterial
                    color={(li + lj + ri) % 3 === 0 ? sc.ledCyan : (li + lj + ri) % 3 === 1 ? sc.leafPrimary : sc.ledBlue}
                  />
                </mesh>
              ))}
            </group>
          ))}
          {/* Ventilation grilles */}
          {[0.3, 1.2, 2.1].map((y, vi) => (
            <group key={`vent-${vi}`}>
              {[-0.5, -0.3, -0.1, 0.1, 0.3, 0.5].map((vx, vj) => (
                <mesh key={`vline-${vj}`} position={[vx, y, 0.515]}>
                  <planeGeometry args={[0.08, 0.04]} />
                  <meshStandardMaterial color={sc.furnitureLight} />
                </mesh>
              ))}
            </group>
          ))}
        </group>
      ))}
      {/* Floor cable channels */}
      {[-3, 0, 3].map((x, i) => (
        <mesh key={`cable-${i}`} position={[x, 0.02, 1.5]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.3, 2]} />
          <meshStandardMaterial color="#0c4a6e" />
        </mesh>
      ))}
      {/* Server room glow */}
      <pointLight position={[0, 2, 0.5]} intensity={0.8} color="#06b6d4" distance={8} decay={2} />
    </group>
  );
}
