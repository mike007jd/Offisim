/**
 * BookshelfMesh3D — Library zone bookshelves + reading tables.
 *
 * Extracted from Office3DView.tsx LibraryFurniture component.
 * Renders bookshelves with book spines, reading tables with chairs, and a plant.
 */

import { RoundedBox } from '@react-three/drei';
import { SceneMaterial } from '../../../theme/scene-materials.js';
import { useSceneColors } from '../../../theme/use-scene-colors.js';
import { PlantMesh3D } from './DecorativeMesh3D.js';
import { OfficeChair } from './WorkstationMesh3D.js';

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
  const bookColors = sc.bookSpine;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {/* Bookshelves along the back */}
      {[-4, -1.5, 1, 3.5].map((x) => (
        <group key={`shelf-${x}`} position={[x, 0, -2.5]}>
          {/* Shelf frame */}
          <RoundedBox
            args={[2, 2.5, 0.6]}
            position={[0, 1.25, 0]}
            radius={0.03}
            smoothness={4}
            castShadow
          >
            <SceneMaterial materialClass="wood" color={sc.furniture} />
          </RoundedBox>
          {/* Shelf levels with books */}
          {[0.5, 1.1, 1.7, 2.3].map((y, shelfIndex) => (
            <group key={`books-${x}-${y}`}>
              <mesh position={[0, y, 0]} castShadow>
                <boxGeometry args={[1.8, 0.04, 0.5]} />
                <SceneMaterial materialClass="wood" color={sc.furnitureLight} />
              </mesh>
              {/* Book spines */}
              {[-0.6, -0.3, 0, 0.3, 0.6].map((bx, bookIndex) => (
                <mesh key={`book-${x}-${y}-${bx}`} position={[bx, y + 0.15, 0]} castShadow>
                  <boxGeometry args={[0.18, 0.25, 0.35]} />
                  <SceneMaterial
                    materialClass="plastic"
                    color={
                      bookColors[(shelfIndex + bookIndex) % bookColors.length] ?? sc.leafPrimary
                    }
                    overrides={{ roughness: 0.85 }}
                  />
                </mesh>
              ))}
            </group>
          ))}
        </group>
      ))}
      {/* Reading tables */}
      {[-3, 1.5].map((x) => (
        <group key={`table-${x}`} position={[x, 0, 1.5]}>
          <RoundedBox
            args={[2.5, 0.05, 1.2]}
            position={[0, 0.72, 0]}
            radius={0.02}
            smoothness={4}
            castShadow
            receiveShadow
          >
            <SceneMaterial materialClass="wood" color={sc.tableReading} />
          </RoundedBox>
          <mesh position={[0, 0.755, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.9, 0.78]} />
            <SceneMaterial
              materialClass="fabric"
              color={sc.workMat}
              overrides={{ transparent: true, opacity: 0.58 }}
            />
          </mesh>
          <mesh position={[0, 0.84, 0]}>
            <cylinderGeometry args={[0.16, 0.16, 0.045, 18]} />
            <SceneMaterial materialClass="metal" color={sc.metal} />
          </mesh>
          <mesh position={[0, 0.89, 0]}>
            <cylinderGeometry args={[0.1, 0.14, 0.08, 18]} />
            <meshBasicMaterial color={sc.ledAmber} transparent opacity={0.7} />
          </mesh>
          {(
            [
              [-1, -0.5],
              [1, -0.5],
              [-1, 0.5],
              [1, 0.5],
            ] as [number, number][]
          ).map(([lx, lz]) => (
            <mesh key={`tleg-${x}-${lx}-${lz}`} position={[lx, 0.36, lz]} castShadow>
              <cylinderGeometry args={[0.04, 0.04, 0.72, 8]} />
              <SceneMaterial
                materialClass="metal"
                color={sc.furnitureLight}
                overrides={{ roughness: 0.3 }}
              />
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
