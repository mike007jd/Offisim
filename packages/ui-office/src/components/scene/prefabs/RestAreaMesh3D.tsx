/**
 * RestAreaMesh3D — Rest area with sofas, coffee table, and vending machine.
 *
 * Extracted from Office3DView.tsx RestAreaFurniture component.
 */

import { RoundedBox } from '@react-three/drei';
import { SceneMaterial } from '../../../theme/scene-materials.js';
import { useSceneColors } from '../../../theme/use-scene-colors.js';
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
      <RoundedBox args={[4, 0.4, 1.2]} position={[-1, 0.2, -2.2]} radius={0.1} castShadow>
        <SceneMaterial materialClass="fabric" color={sc.ledAmber} />
      </RoundedBox>
      <RoundedBox args={[4, 0.6, 0.3]} position={[-1, 0.5, -2.75]} radius={0.1} castShadow>
        <SceneMaterial materialClass="fabric" color={sc.ledAmber} />
      </RoundedBox>
      {[-2.2, -1, 0.2].map((x) => (
        <RoundedBox
          key={`cushion-a-${x}`}
          args={[0.75, 0.12, 0.55]}
          position={[x, 0.45, -2.18]}
          radius={0.08}
          castShadow
        >
          <SceneMaterial
            materialClass="fabric"
            color={sc.accentWarm}
            overrides={{ roughness: 0.86 }}
          />
        </RoundedBox>
      ))}
      {/* Sofa set 2 */}
      <RoundedBox args={[3, 0.4, 1]} position={[1, 0.2, 2]} radius={0.1} castShadow>
        <SceneMaterial materialClass="fabric" color={sc.accentWarm} />
      </RoundedBox>
      <RoundedBox args={[3, 0.6, 0.3]} position={[1, 0.5, 2.45]} radius={0.1} castShadow>
        <SceneMaterial materialClass="fabric" color={sc.accentWarm} />
      </RoundedBox>
      {[-0.1, 0.95, 2].map((x) => (
        <RoundedBox
          key={`cushion-b-${x}`}
          args={[0.68, 0.12, 0.46]}
          position={[x, 0.45, 2]}
          radius={0.08}
          castShadow
        >
          <SceneMaterial
            materialClass="fabric"
            color={sc.ledAmber}
            overrides={{ roughness: 0.86 }}
          />
        </RoundedBox>
      ))}
      {/* Coffee table */}
      <mesh position={[0, 0.3, 0]} castShadow>
        <cylinderGeometry args={[0.8, 0.8, 0.05, 32]} />
        <SceneMaterial materialClass="plastic" color={sc.whiteboardSurface} />
      </mesh>
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[0.4, 0.2, 0.3, 16]} />
        <SceneMaterial materialClass="plastic" color={sc.furnitureDark} />
      </mesh>
      {/* Vending machine */}
      <group position={[5.5, 0, -2]}>
        <RoundedBox args={[1, 2.2, 0.8]} position={[0, 1.1, 0]} radius={0.05} castShadow>
          <SceneMaterial
            materialClass="metal"
            color={sc.furniture}
            overrides={{ roughness: 0.32 }}
          />
        </RoundedBox>
        {/* Screen */}
        <mesh position={[0, 1.4, 0.41]}>
          <planeGeometry args={[0.7, 0.5]} />
          <meshBasicMaterial color={sc.vendingScreen} />
        </mesh>
        {/* Product window */}
        <mesh position={[0, 0.8, 0.41]}>
          <planeGeometry args={[0.7, 0.8]} />
          <SceneMaterial
            materialClass="glass"
            color={sc.partition}
            overrides={{ thickness: 0.05 }}
          />
        </mesh>
      </group>
      <PlantMesh3D position={[-5, 0, -2.5]} />
      <PlantMesh3D position={[4, 0, 2.5]} />
    </group>
  );
}
