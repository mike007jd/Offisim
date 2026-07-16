/**
 * BookshelfMesh3D — Library zone bookshelves + reading tables.
 *
 * Extracted from Office3DView.tsx LibraryFurniture component.
 * Renders bookshelves with book spines, reading tables with chairs, and a plant.
 */

import { RoundedBox } from '@react-three/drei';
import { SceneMaterial } from '../scene-materials.js';
import { useSceneColors } from '../use-scene-colors.js';
import { PlantMesh3D } from './DecorativeMesh3D.js';
import { OfficeChair } from './WorkstationMesh3D.js';

const READING_TABLE_SURFACE_Y = 0.75;
const READING_MAT_THICKNESS = 0.016;
const CABINET_FRONT_Z = 0.36;
const DRAWER_FACE_DEPTH = 0.03;
const DRAWER_HANDLE_DEPTH = 0.018;

export interface BookshelfMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
  template?: 'bookshelf-single' | 'bookshelf-double' | 'filing-cabinet' | 'reading-table';
}

export function BookshelfMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
  template,
}: BookshelfMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;
  const shelfWidth = template === 'bookshelf-single' ? 1.4 : 2.4;

  if (template === 'filing-cabinet') {
    return (
      <group position={position} rotation={[0, rotY, 0]}>
        <RoundedBox args={[0.9, 1.15, 0.72]} position={[0, 0.58, 0]} radius={0.035} castShadow>
          <SceneMaterial materialClass="metal" color={sc.furnitureLight} />
        </RoundedBox>
        {[0.28, 0.58, 0.88].map((y) => (
          <group key={`drawer-${y}`}>
            <RoundedBox
              args={[0.72, 0.18, DRAWER_FACE_DEPTH]}
              position={[0, y, CABINET_FRONT_Z + DRAWER_FACE_DEPTH / 2]}
              radius={0.01}
              smoothness={3}
              castShadow
            >
              <SceneMaterial materialClass="metal" color={sc.furniture} />
            </RoundedBox>
            <mesh
              position={[0, y, CABINET_FRONT_Z + DRAWER_FACE_DEPTH + DRAWER_HANDLE_DEPTH / 2]}
              castShadow
            >
              <boxGeometry args={[0.22, 0.025, DRAWER_HANDLE_DEPTH]} />
              <SceneMaterial materialClass="metal" color={sc.metal} />
            </mesh>
          </group>
        ))}
      </group>
    );
  }

  if (template === 'reading-table') {
    return (
      <group position={position} rotation={[0, rotY, 0]}>
        <RoundedBox
          args={[2.35, 0.06, 1.15]}
          position={[0, 0.72, 0]}
          radius={0.025}
          smoothness={4}
          castShadow
          receiveShadow
        >
          <SceneMaterial materialClass="wood" color={sc.tableReading} />
        </RoundedBox>
        <RoundedBox
          args={[1.74, READING_MAT_THICKNESS, 0.68]}
          position={[0, READING_TABLE_SURFACE_Y + READING_MAT_THICKNESS / 2, 0]}
          radius={0.007}
          smoothness={3}
          castShadow
          receiveShadow
        >
          <SceneMaterial materialClass="fabric" color={sc.workMat} overrides={{ roughness: 0.9 }} />
        </RoundedBox>
        {[-0.92, 0.92].map((x) =>
          [-0.42, 0.42].map((z) => (
            <mesh key={`reading-leg-${x}-${z}`} position={[x, 0.36, z]} castShadow>
              <cylinderGeometry args={[0.04, 0.04, 0.72, 8]} />
              <SceneMaterial materialClass="metal" color={sc.furnitureLight} />
            </mesh>
          )),
        )}
        <RoundedBox
          args={[0.36, 0.035, 0.28]}
          position={[-0.42, READING_TABLE_SURFACE_Y + READING_MAT_THICKNESS + 0.0175, 0.06]}
          radius={0.012}
          smoothness={3}
          castShadow
        >
          <SceneMaterial materialClass="plastic" color={sc.whiteboardSurface} />
        </RoundedBox>
        <RoundedBox
          args={[0.34, 0.012, 0.22]}
          position={[-0.38, READING_TABLE_SURFACE_Y + READING_MAT_THICKNESS + 0.041, 0.06]}
          rotation={[0, 0.18, 0]}
          radius={0.005}
          smoothness={3}
          castShadow
        >
          <SceneMaterial materialClass="plastic" color={sc.accentCool} />
        </RoundedBox>
        <mesh
          position={[0.48, READING_TABLE_SURFACE_Y + READING_MAT_THICKNESS + 0.04, -0.02]}
          castShadow
        >
          <cylinderGeometry args={[0.07, 0.07, 0.08, 14]} />
          <SceneMaterial materialClass="metal" color={sc.metal} />
        </mesh>
        <mesh position={[0.48, READING_TABLE_SURFACE_Y + READING_MAT_THICKNESS + 0.17, -0.02]}>
          <coneGeometry args={[0.13, 0.18, 16]} />
          <meshBasicMaterial color={sc.ledAmber} transparent opacity={0.68} depthWrite={false} />
        </mesh>
      </group>
    );
  }

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      {/* Solid carcass: back panel + sides + top/bottom so the shelf reads as a
          real cabinet instead of floating boards. */}
      <mesh position={[0, 1.24, -0.24]} castShadow receiveShadow>
        <boxGeometry args={[shelfWidth + 0.16, 2.45, 0.06]} />
        <SceneMaterial materialClass="wood" color={sc.furniture} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={`shelf-side-${side}`}
          position={[side * (shelfWidth / 2 + 0.05), 1.24, 0]}
          castShadow
        >
          <boxGeometry args={[0.06, 2.45, 0.54]} />
          <SceneMaterial materialClass="wood" color={sc.furniture} />
        </mesh>
      ))}
      <mesh position={[0, 2.48, 0]} castShadow>
        <boxGeometry args={[shelfWidth + 0.16, 0.06, 0.56]} />
        <SceneMaterial materialClass="wood" color={sc.furniture} />
      </mesh>
      <mesh position={[0, 0.08, 0]} castShadow>
        <boxGeometry args={[shelfWidth + 0.16, 0.16, 0.56]} />
        <SceneMaterial materialClass="wood" color={sc.furnitureDark} />
      </mesh>
      {[0.42, 1.02, 1.62, 2.22].map((y, shelfIndex) => (
        <group key={`shelf-layer-${y}`}>
          <mesh position={[0, y, 0]} castShadow>
            <boxGeometry args={[shelfWidth, 0.05, 0.5]} />
            <SceneMaterial materialClass="wood" color={sc.furnitureLight} />
          </mesh>
          {[-0.42, -0.18, 0.08, 0.32, 0.56, 0.8]
            .slice(0, template === 'bookshelf-single' ? 4 : 6)
            .map((bx, bookIndex) => (
              <mesh
                key={`book-${y}-${bx}`}
                position={[bx - shelfWidth * 0.18, y + 0.18, 0.06]}
                castShadow
              >
                <boxGeometry args={[0.14, 0.3, 0.28]} />
                <SceneMaterial
                  materialClass="plastic"
                  color={
                    sc.bookSpine[(shelfIndex + bookIndex) % sc.bookSpine.length] ?? sc.leafPrimary
                  }
                  overrides={{ roughness: 0.85 }}
                />
              </mesh>
            ))}
        </group>
      ))}
      {template === undefined && (
        <>
          <BookshelfMesh3D template="reading-table" position={[-2.4, 0, 2.05]} />
          <OfficeChair position={[-2.4, 0, 3.35]} />
          <BookshelfMesh3D template="reading-table" position={[2.4, 0, 2.05]} />
          <OfficeChair position={[2.4, 0, 3.35]} />
          <PlantMesh3D position={[4.8, 0, -1.8]} />
        </>
      )}
    </group>
  );
}
