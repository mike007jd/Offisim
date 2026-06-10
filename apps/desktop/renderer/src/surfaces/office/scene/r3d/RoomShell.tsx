import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import {
  FLOOR_BANDS,
  OFFICE_ROOM,
  ROOM_GRID,
  SCENE_LAYER_Y,
  WALL_PANELS,
  createTileLineColor,
} from './scene-art-direction.js';
import { EmissiveMaterial, SceneMaterial } from './scene-materials.js';
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

export function FloorLineGrid() {
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

function GlassRun({
  x,
  z,
  width,
  depth,
}: {
  x: number;
  z: number;
  width?: number;
  depth?: number;
}) {
  const sc = useSceneColors();
  const isHorizontal = width !== undefined;
  const posts: [number, number][] = isHorizontal
    ? [
        [-(width ?? 1) / 2, 0],
        [(width ?? 1) / 2, 0],
      ]
    : [
        [0, -(depth ?? 1) / 2],
        [0, (depth ?? 1) / 2],
      ];
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1.12, 0]} castShadow receiveShadow>
        <boxGeometry args={isHorizontal ? [width ?? 1, 2.18, 0.06] : [0.06, 2.18, depth ?? 1]} />
        <SceneMaterial
          materialClass="glass"
          color={sc.partition}
          overrides={{ transparent: true, opacity: 0.42, roughness: 0.08, thickness: 0.08 }}
        />
      </mesh>
      {posts.map(([px, pz]) => (
        <mesh key={`glass-post-${px}-${pz}`} position={[px, 1.12, pz]} castShadow>
          <boxGeometry args={[0.09, 2.24, 0.09]} />
          <SceneMaterial materialClass="metal-brushed" color={sc.deskEdge} />
        </mesh>
      ))}
      <mesh position={[0, 0.07, 0]} receiveShadow>
        <boxGeometry args={isHorizontal ? [width ?? 1, 0.08, 0.12] : [0.12, 0.08, depth ?? 1]} />
        <SceneMaterial materialClass="metal" color={sc.deskEdge} overrides={{ roughness: 0.55 }} />
      </mesh>
    </group>
  );
}

function InteriorPartitions() {
  const sc = useSceneColors();
  return (
    <>
      <GlassRun x={-13.0} z={-5.02} width={7.7} />
      <GlassRun x={-5.0} z={-5.02} width={5.0} />
      <GlassRun x={6.0} z={-5.02} width={6.8} />
      <GlassRun x={13.6} z={-5.02} width={4.9} />
      <GlassRun x={0} z={-8.8} depth={6.8} />
      {[-5.8, 4.8].map((x) => (
        <mesh key={`middle-low-divider-${x}`} position={[x, 0.42, 4.85]} castShadow receiveShadow>
          <boxGeometry args={[7.2, 0.74, 0.1]} />
          <SceneMaterial
            materialClass="glass"
            color={sc.partition}
            overrides={{ transparent: true, opacity: 0.22, roughness: 0.16 }}
          />
        </mesh>
      ))}
    </>
  );
}

type WallPanelKind = 'framed-art' | 'corkboard' | 'season-screen' | 'framed-art-alt';

const WALL_PANEL_KINDS: ReadonlyArray<WallPanelKind> = [
  'framed-art',
  'corkboard',
  'season-screen',
  'framed-art-alt',
];

const STICKY_NOTE_LAYOUT: ReadonlyArray<{
  dx: number;
  dy: number;
  rot: number;
  colorKey: 'noteAmber' | 'noteCyan' | 'notePink';
}> = [
  { dx: -1.6, dy: 0.45, rot: 0.06, colorKey: 'noteAmber' },
  { dx: -0.8, dy: 0.65, rot: -0.04, colorKey: 'noteCyan' },
  { dx: 0.1, dy: 0.3, rot: 0.08, colorKey: 'notePink' },
  { dx: 1.2, dy: 0.6, rot: -0.02, colorKey: 'noteAmber' },
  { dx: -1.4, dy: -0.4, rot: 0.05, colorKey: 'notePink' },
  { dx: 0.4, dy: -0.55, rot: -0.07, colorKey: 'noteCyan' },
  { dx: 1.6, dy: -0.3, rot: 0.03, colorKey: 'noteAmber' },
] as const;

// Sticky note tints: warm office decoration, intentionally not in semantic tokens.
const NOTE_COLORS = {
  noteAmber: '#f5c161', // raw-hex-allowed
  noteCyan: '#9bd4d0', // raw-hex-allowed
  notePink: '#e89db4', // raw-hex-allowed
} as const;

import type { MaterialClass } from './scene-materials.js';

function WallPanelFrame({
  width,
  height,
  z,
  frameClass,
  frameColor,
  insetMargin = 0.3,
  renderInsetBackground = true,
  children,
}: {
  width: number;
  height: number;
  z: number;
  frameClass: MaterialClass;
  frameColor: string;
  insetMargin?: number;
  renderInsetBackground?: boolean;
  children: (innerWidth: number, innerHeight: number) => React.ReactNode;
}) {
  const sc = useSceneColors();
  const innerWidth = width - insetMargin;
  const innerHeight = height - insetMargin;
  return (
    <group position={[0, 0, z]}>
      <mesh receiveShadow>
        <boxGeometry args={[width, height, 0.06]} />
        <SceneMaterial materialClass={frameClass} color={frameColor} />
      </mesh>
      {renderInsetBackground && (
        <mesh position={[0, 0, 0.04]}>
          <planeGeometry args={[innerWidth, innerHeight]} />
          <SceneMaterial materialClass="plastic" color={sc.wallPanel} />
        </mesh>
      )}
      {children(innerWidth, innerHeight)}
    </group>
  );
}

function FramedArtPanel({
  width,
  height,
  z,
  variant,
}: {
  width: number;
  height: number;
  z: number;
  variant: 'a' | 'b';
}) {
  const sc = useSceneColors();
  const bandTop = variant === 'a' ? sc.accentCool : sc.accentWarm;
  const bandMid = variant === 'a' ? sc.accentWarm : sc.accentCool;
  return (
    <WallPanelFrame
      width={width}
      height={height}
      z={z}
      insetMargin={0.5}
      frameClass="wood"
      frameColor={sc.deskEdge}
    >
      {(innerWidth, innerHeight) => (
        <>
          <mesh position={[0, innerHeight * 0.18, 0.045]}>
            <planeGeometry args={[innerWidth * 0.7, innerHeight * 0.18]} />
            <SceneMaterial materialClass="fabric" color={bandTop} overrides={{ roughness: 0.85 }} />
          </mesh>
          <mesh position={[0, -innerHeight * 0.08, 0.045]}>
            <planeGeometry args={[innerWidth * 0.92, innerHeight * 0.12]} />
            <SceneMaterial materialClass="fabric" color={bandMid} overrides={{ roughness: 0.85 }} />
          </mesh>
        </>
      )}
    </WallPanelFrame>
  );
}

function CorkboardPanel({ width, height, z }: { width: number; height: number; z: number }) {
  const sc = useSceneColors();
  return (
    <WallPanelFrame
      width={width}
      height={height}
      z={z}
      frameClass="wood"
      frameColor={sc.deskEdge}
      renderInsetBackground={false}
    >
      {(innerWidth, innerHeight) => (
        <>
          <mesh position={[0, 0, 0.04]}>
            <planeGeometry args={[innerWidth, innerHeight]} />
            <SceneMaterial
              materialClass="fabric"
              color={sc.furnitureDark}
              overrides={{ roughness: 0.96 }}
            />
          </mesh>
          {STICKY_NOTE_LAYOUT.map((note) => (
            <mesh
              key={`note-${note.dx}-${note.dy}`}
              position={[note.dx, note.dy, 0.05]}
              rotation={[0, 0, note.rot]}
              castShadow
            >
              <planeGeometry args={[0.55, 0.55]} />
              <SceneMaterial
                materialClass="plastic"
                color={NOTE_COLORS[note.colorKey]}
                overrides={{ roughness: 0.7 }}
              />
            </mesh>
          ))}
        </>
      )}
    </WallPanelFrame>
  );
}

function SeasonScreenPanel({
  width,
  height,
  z,
}: {
  width: number;
  height: number;
  z: number;
}) {
  const sc = useSceneColors();
  const bars = [0.32, 0.48, 0.62, 0.41, 0.78, 0.55, 0.68];
  return (
    <WallPanelFrame
      width={width}
      height={height}
      z={z}
      frameClass="metal-brushed"
      frameColor={sc.furnitureDark}
      renderInsetBackground={false}
    >
      {(innerWidth, innerHeight) => (
        <>
          <mesh position={[0, 0, 0.04]}>
            <planeGeometry args={[innerWidth, innerHeight]} />
            <EmissiveMaterial color={sc.screen} tier="screen" />
          </mesh>
          {bars.map((bar, i) => {
            const usable = innerWidth - 0.3;
            const bw = usable / bars.length - 0.05;
            const x = -usable / 2 + bw / 2 + i * (bw + 0.05);
            const bh = bar * (innerHeight - 0.3);
            return (
              <mesh
                key={`bar-${bar}-${x.toFixed(2)}`}
                position={[x, -innerHeight / 2 + 0.2 + bh / 2, 0.05]}
              >
                <planeGeometry args={[bw, bh]} />
                <EmissiveMaterial color={sc.ledCyan} tier="accent" />
              </mesh>
            );
          })}
        </>
      )}
    </WallPanelFrame>
  );
}

function BackWallPanels() {
  const sc = useSceneColors();
  const wallZ = -OFFICE_ROOM.depth / 2 + 0.17;
  return (
    <>
      {WALL_PANELS.map((panel, i) => {
        const kind = WALL_PANEL_KINDS[i % WALL_PANEL_KINDS.length] ?? 'framed-art';
        return (
          <group key={panel.id} position={[panel.x, panel.y, 0]}>
            {kind === 'framed-art' && (
              <FramedArtPanel width={panel.width} height={panel.height} z={wallZ} variant="a" />
            )}
            {kind === 'framed-art-alt' && (
              <FramedArtPanel width={panel.width} height={panel.height} z={wallZ} variant="b" />
            )}
            {kind === 'corkboard' && (
              <CorkboardPanel width={panel.width} height={panel.height} z={wallZ} />
            )}
            {kind === 'season-screen' && (
              <SeasonScreenPanel width={panel.width} height={panel.height} z={wallZ} />
            )}
          </group>
        );
      })}
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
      <InteriorPartitions />
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
