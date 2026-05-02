import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { SceneMaterial } from '../../theme/scene-materials.js';
import { useSceneColors } from '../../theme/use-scene-colors.js';
import {
  FLOOR_BANDS,
  OFFICE_ROOM,
  ROOM_GRID,
  SCENE_LAYER_Y,
  WALL_PANELS,
  createTileLineColor,
} from './scene-art-direction.js';

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
  return (
    <>
      {FLOOR_BANDS.map((band) => (
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
      ))}
    </>
  );
}

function BackWallPanels() {
  const sc = useSceneColors();
  return (
    <>
      {WALL_PANELS.map((panel) => (
        <mesh
          key={panel.id}
          position={[panel.x, panel.y, -OFFICE_ROOM.depth / 2 + 0.17]}
          receiveShadow
        >
          <boxGeometry args={[panel.width, panel.height, panel.depth]} />
          <SceneMaterial materialClass="plastic" color={sc.wallPanel} />
        </mesh>
      ))}
      <mesh position={[0, OFFICE_ROOM.trimHeight / 2, -OFFICE_ROOM.depth / 2 + 0.34]} receiveShadow>
        <boxGeometry args={[OFFICE_ROOM.width, OFFICE_ROOM.trimHeight, 0.26]} />
        <SceneMaterial materialClass="plastic" color={sc.wallTrim} />
      </mesh>
      <mesh position={[-OFFICE_ROOM.width / 2 + 0.34, OFFICE_ROOM.trimHeight / 2, 0]} receiveShadow>
        <boxGeometry args={[0.26, OFFICE_ROOM.trimHeight, OFFICE_ROOM.depth]} />
        <SceneMaterial materialClass="plastic" color={sc.wallTrim} />
      </mesh>
      <mesh position={[OFFICE_ROOM.width / 2 - 0.34, OFFICE_ROOM.trimHeight / 2, 0]} receiveShadow>
        <boxGeometry args={[0.26, OFFICE_ROOM.trimHeight, OFFICE_ROOM.depth]} />
        <SceneMaterial materialClass="plastic" color={sc.wallTrim} />
      </mesh>
    </>
  );
}

export function RoomShell({ onFloorClick }: { onFloorClick?: () => void }) {
  const sc = useSceneColors();

  return (
    <group>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: react-three-fiber meshes are not keyboard-focusable DOM nodes. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow onClick={() => onFloorClick?.()}>
        <planeGeometry args={[OFFICE_ROOM.width, OFFICE_ROOM.depth]} />
        <SceneMaterial
          materialClass="plastic"
          color={sc.floorTile}
          overrides={{ roughness: 0.86 }}
        />
      </mesh>
      <FloorBands />
      <FloorLineGrid />
      <mesh position={[0, OFFICE_ROOM.wallHeight / 2, -OFFICE_ROOM.depth / 2]} receiveShadow>
        <boxGeometry args={[OFFICE_ROOM.width, OFFICE_ROOM.wallHeight, 0.3]} />
        <SceneMaterial materialClass="plastic" color={sc.wallShell} />
      </mesh>
      <mesh position={[-OFFICE_ROOM.width / 2, OFFICE_ROOM.wallHeight / 2, 0]} receiveShadow>
        <boxGeometry args={[0.3, OFFICE_ROOM.wallHeight, OFFICE_ROOM.depth]} />
        <SceneMaterial materialClass="plastic" color={sc.wallShadow} />
      </mesh>
      <mesh position={[OFFICE_ROOM.width / 2, OFFICE_ROOM.wallHeight / 2, 0]} receiveShadow>
        <boxGeometry args={[0.3, OFFICE_ROOM.wallHeight, OFFICE_ROOM.depth]} />
        <SceneMaterial materialClass="plastic" color={sc.wallShadow} />
      </mesh>
      <BackWallPanels />
    </group>
  );
}
