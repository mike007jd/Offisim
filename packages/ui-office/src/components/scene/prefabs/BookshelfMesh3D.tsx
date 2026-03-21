/**
 * BookshelfMesh3D — Library zone bookshelves + reading tables.
 *
 * Extracted from Office3DView.tsx LibraryFurniture component.
 * Renders bookshelves with book spines, reading tables with chairs, and a plant.
 */

import { RoundedBox } from '@react-three/drei';
import { OfficeChair } from './WorkstationMesh3D.js';
import { PlantMesh3D } from './DecorativeMesh3D.js';
import { useSceneColors } from '../../../theme/use-scene-colors.js';

export interface BookshelfMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
}

export function BookshelfMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
}: BookshelfMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {/* Bookshelves along the back */}
      {[-4, -1.5, 1, 3.5].map((x, i) => (
        <group key={`shelf-${i}`} position={[x, 0, -2.5]}>
          {/* Shelf frame */}
          <RoundedBox args={[2, 2.5, 0.6]} position={[0, 1.25, 0]} radius={0.03} smoothness={4} castShadow>
            <meshStandardMaterial color={sc.furniture} />
          </RoundedBox>
          {/* Shelf levels with books */}
          {[0.5, 1.1, 1.7, 2.3].map((y, j) => (
            <group key={`books-${j}`}>
              <mesh position={[0, y, 0]} castShadow>
                <boxGeometry args={[1.8, 0.04, 0.5]} />
                <meshStandardMaterial color={sc.furnitureLight} />
              </mesh>
              {/* Book spines */}
              {[-0.6, -0.3, 0, 0.3, 0.6].map((bx, k) => (
                <mesh key={`book-${k}`} position={[bx, y + 0.15, 0]} castShadow>
                  <boxGeometry args={[0.18, 0.25, 0.35]} />
                  <meshStandardMaterial
                    color={['#10b981', '#059669', '#047857', '#34d399', '#6ee7b7'][(j + k) % 5]}
                    roughness={0.8}
                  />
                </mesh>
              ))}
            </group>
          ))}
        </group>
      ))}
      {/* Reading tables */}
      {[-3, 1.5].map((x, i) => (
        <group key={`table-${i}`} position={[x, 0, 1.5]}>
          <RoundedBox args={[2.5, 0.05, 1.2]} position={[0, 0.72, 0]} radius={0.02} smoothness={4} castShadow receiveShadow>
            <meshStandardMaterial color="#064e3b" roughness={0.3} />
          </RoundedBox>
          {([[-1, -0.5], [1, -0.5], [-1, 0.5], [1, 0.5]] as [number, number][]).map(([lx, lz], j) => (
            <mesh key={`tleg-${j}`} position={[lx, 0.36, lz]} castShadow>
              <cylinderGeometry args={[0.04, 0.04, 0.72, 8]} />
              <meshStandardMaterial color={sc.furnitureLight} metalness={0.5} />
            </mesh>
          ))}
          <OfficeChair position={[-0.6, 0, -1]} />
          <OfficeChair position={[0.6, 0, -1]} />
          <OfficeChair position={[-0.6, 0, 1]} rotation={[0, Math.PI, 0]} />
          <OfficeChair position={[0.6, 0, 1]} rotation={[0, Math.PI, 0]} />
        </group>
      ))}
      <PlantMesh3D position={[5.5, 0, -2.5]} />
    </group>
  );
}
