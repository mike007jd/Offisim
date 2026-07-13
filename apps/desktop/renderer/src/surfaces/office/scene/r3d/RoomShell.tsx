import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { RoundedSlab } from './RoundedSlab.js';
import {
  FLOOR_BANDS,
  OFFICE_PLINTH,
  OFFICE_ROOM,
  ROOM_GRID,
  SCENE_LAYER_Y,
  createTileLineColor,
} from './scene-art-direction.js';
import { SceneMaterial } from './scene-materials.js';
import { useSceneColors } from './use-scene-colors.js';

function buildGridGeometry(width: number, depth: number, step: number) {
  const vertices: number[] = [];
  const halfW = width / 2;
  const halfD = depth / 2;

  for (let x = -halfW; x <= halfW + 0.001; x += step) {
    vertices.push(x, -halfD, 0, x, halfD, 0);
  }
  for (let z = -halfD; z <= halfD + 0.001; z += step) {
    vertices.push(-halfW, z, 0, halfW, z, 0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
}

function FloorLineGrid() {
  const sc = useSceneColors();
  const minorGeometry = useMemo(
    () => buildGridGeometry(OFFICE_ROOM.width, OFFICE_ROOM.depth, ROOM_GRID.minorStep),
    [],
  );
  const majorGeometry = useMemo(
    () => buildGridGeometry(OFFICE_ROOM.width, OFFICE_ROOM.depth, ROOM_GRID.majorStep),
    [],
  );

  useEffect(
    () => () => {
      minorGeometry.dispose();
      majorGeometry.dispose();
    },
    [majorGeometry, minorGeometry],
  );

  return (
    <group position={[0, SCENE_LAYER_Y.tile, 0]}>
      <lineSegments geometry={minorGeometry} rotation={[-Math.PI / 2, 0, 0]}>
        <lineBasicMaterial
          color={createTileLineColor(sc, 'minor')}
          transparent
          opacity={ROOM_GRID.minorOpacity}
        />
      </lineSegments>
      <lineSegments geometry={majorGeometry} rotation={[-Math.PI / 2, 0, 0]}>
        <lineBasicMaterial
          color={createTileLineColor(sc, 'major')}
          transparent
          opacity={ROOM_GRID.majorOpacity}
        />
      </lineSegments>
    </group>
  );
}

function FloorBands() {
  const sc = useSceneColors();
  return FLOOR_BANDS.map((band) => (
    <mesh
      key={band.id}
      position={[0, SCENE_LAYER_Y.floor + band.layerOffset, band.z]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[OFFICE_ROOM.width - band.widthOffset, band.depth]} />
      <SceneMaterial
        materialClass="plastic"
        color={sc[band.colorToken]}
        overrides={{ transparent: true, opacity: band.opacity, roughness: band.roughness }}
      />
    </mesh>
  ));
}

/** Open display plinth. Zone rugs and furniture clusters carry all spatial
 * identity; there are deliberately no walls, windows, glass runs or hanging
 * room dividers to betray the model from a free orbit angle. */
export function RoomShell({ onFloorClick }: { onFloorClick?: () => void }) {
  const sc = useSceneColors();

  return (
    <group>
      <RoundedSlab
        width={OFFICE_ROOM.width + 1.35}
        depth={OFFICE_ROOM.depth + 1.35}
        height={OFFICE_PLINTH.baseHeight}
        position={[0, OFFICE_PLINTH.baseCenterY, 0]}
        cornerRadius={0.46}
        bevelSize={0.12}
        receiveShadow
      >
        <SceneMaterial
          materialClass="wood"
          color={sc.deskEdge}
          overrides={{ roughness: 0.7, useProceduralNormal: true, normalScale: 0.08 }}
        />
      </RoundedSlab>
      <RoundedSlab
        width={OFFICE_ROOM.width + 0.42}
        depth={OFFICE_ROOM.depth + 0.42}
        height={OFFICE_PLINTH.lipHeight}
        position={[0, OFFICE_PLINTH.lipCenterY, 0]}
        cornerRadius={0.28}
        bevelSize={0.045}
        receiveShadow
      >
        <SceneMaterial
          materialClass="plastic"
          color={sc.floorBorder}
          overrides={{ roughness: 0.78 }}
        />
      </RoundedSlab>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: react-three-fiber meshes are not keyboard-focusable DOM nodes. */}
      <mesh
        position={[0, OFFICE_PLINTH.floorY, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={() => onFloorClick?.()}
      >
        <planeGeometry args={[OFFICE_ROOM.width, OFFICE_ROOM.depth]} />
        <SceneMaterial
          materialClass="plastic"
          color={sc.floorTile}
          overrides={{ roughness: 0.88 }}
        />
      </mesh>
      <FloorBands />
      <FloorLineGrid />
    </group>
  );
}
