/**
 * RestAreaMesh3D — Rest area with sofas, coffee table, and vending machine.
 *
 * Extracted from Office3DView.tsx RestAreaFurniture component.
 */

import { RoundedBox } from '@react-three/drei';
import { SceneMaterial } from '../scene-materials.js';
import { useSceneColors } from '../use-scene-colors.js';

export interface RestAreaMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
}

function SofaFabricMaterial({ color, opacity = 0.96 }: { color: string; opacity?: number }) {
  return <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />;
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
      {/* Carpet */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[10, 6]} />
        <SceneMaterial materialClass="fabric" color={sc.furnitureLight} />
      </mesh>
      {/* Sofa set 1 - L shape */}
      <RoundedBox args={[4, 0.4, 1.2]} position={[-1, 0.2, -2.2]} radius={0.1}>
        <SofaFabricMaterial color={sc.ledAmber} />
      </RoundedBox>
      <RoundedBox args={[4, 0.6, 0.3]} position={[-1, 0.5, -2.75]} radius={0.1}>
        <SofaFabricMaterial color={sc.ledAmber} opacity={0.9} />
      </RoundedBox>
      {[-2.2, -1, 0.2].map((x) => (
        <RoundedBox
          key={`cushion-a-${x}`}
          args={[0.75, 0.12, 0.55]}
          position={[x, 0.45, -2.18]}
          radius={0.08}
        >
          <SofaFabricMaterial color={sc.accentWarm} />
        </RoundedBox>
      ))}
      {/* Sofa set 2 */}
      <RoundedBox args={[3, 0.4, 1]} position={[1, 0.2, 2]} radius={0.1}>
        <SofaFabricMaterial color={sc.accentWarm} />
      </RoundedBox>
      <RoundedBox args={[3, 0.6, 0.3]} position={[1, 0.5, 2.45]} radius={0.1}>
        <SofaFabricMaterial color={sc.accentWarm} opacity={0.9} />
      </RoundedBox>
      {[-0.1, 0.95, 2].map((x) => (
        <RoundedBox
          key={`cushion-b-${x}`}
          args={[0.68, 0.12, 0.46]}
          position={[x, 0.45, 2]}
          radius={0.08}
        >
          <SofaFabricMaterial color={sc.ledAmber} />
        </RoundedBox>
      ))}
      <RoundedBox args={[1.05, 0.22, 0.72]} position={[-3.2, 0.22, -0.15]} radius={0.08} castShadow>
        <SceneMaterial materialClass="fabric" color={sc.furnitureLight} />
      </RoundedBox>
      <RoundedBox args={[0.72, 0.18, 0.72]} position={[3.1, 0.2, 0.1]} radius={0.08} castShadow>
        <SceneMaterial materialClass="fabric" color={sc.furnitureLight} />
      </RoundedBox>
    </group>
  );
}
