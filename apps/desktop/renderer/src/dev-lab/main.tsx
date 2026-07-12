/**
 * DEV-ONLY character lab — visual iteration harness for the toy character.
 * Not part of the app build; served only by `vite dev` as /character-lab.html.
 *
 * Views (query param `?view=`):
 *   hair   — all hair styles front-facing close-up grid            (default)
 *   heads  — head shapes × body types matrix
 *   walk   — one walker looping a square track (heading/stride test)
 *   clips  — a single character cycling a chosen clip (?clip=walk)
 */
import type { HairStyle, ResolvedAppearance } from '@/lib/avatar.js';
import toyCharacterContract from '@/lib/toy-character-contract.json';
import type { CharacterMovementPhase } from '@/surfaces/office/scene/character-movement.js';
import { GltfCharacter } from '@/surfaces/office/scene/character/GltfCharacter.js';
import { LIGHT_SCENE_3D, SCENE_LIGHTING_COLORS } from '@/surfaces/office/scene/r3d/scene-colors.js';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { Group } from 'three';

const params = new URLSearchParams(window.location.search);
const view = params.get('view') ?? 'hair';

const HAIR_STYLES: readonly HairStyle[] = [
  'short',
  'long',
  'ponytail',
  'curly',
  'bald',
  'bob',
  'spiky',
  'braids',
  'bun',
  'afro',
  'mohawk',
  'sidepart',
  'undercut',
];

// Production palettes verbatim — the lab must show contract colors, not its own.
const SKINS = toyCharacterContract.skinTones.map((tone) => `#${tone.hex}`);
const HAIRC = toyCharacterContract.hairColors.map((color) => `#${color.hex}`);
const OUTFITS = toyCharacterContract.outfitColors.map((color) => `#${color.hex}`);

function appearanceFor(i: number, hairStyle: HairStyle): ResolvedAppearance {
  return {
    skin: SKINS[i % SKINS.length] ?? LIGHT_SCENE_3D.floorTile,
    hair: HAIRC[i % HAIRC.length] ?? LIGHT_SCENE_3D.furnitureDark,
    clothing: OUTFITS[i % OUTFITS.length] ?? LIGHT_SCENE_3D.furniture,
    accent: OUTFITS[(i + 3) % OUTFITS.length] ?? LIGHT_SCENE_3D.furniture,
    hairStyle,
    bodyType: (['slim', 'normal', 'stocky'] as const)[i % 3] ?? 'normal',
    headShape: (['round', 'soft-square', 'capsule'] as const)[i % 3] ?? 'round',
    gender: 'neutral',
    outfit: (['blazer', 'shirt', 'sweater', 'dress'] as const)[i % 4] ?? 'shirt',
  };
}

function Lights() {
  return (
    <>
      <hemisphereLight
        args={[SCENE_LIGHTING_COLORS.hemisphereSky, SCENE_LIGHTING_COLORS.hemisphereGround, 0.38]}
      />
      <directionalLight
        castShadow
        position={[10, 20, 12]}
        intensity={1.2}
        color={SCENE_LIGHTING_COLORS.key}
      />
      <directionalLight
        position={[-15, 12, -10]}
        intensity={0.24}
        color={SCENE_LIGHTING_COLORS.sideFill}
      />
      <directionalLight position={[5, 9, -18]} intensity={0.2} color={SCENE_LIGHTING_COLORS.rim} />
      <ambientLight intensity={0.12} />
    </>
  );
}

function HairGrid() {
  const columns = Math.ceil(HAIR_STYLES.length / 2);
  const rows = Math.ceil(HAIR_STYLES.length / columns);
  return (
    <>
      {HAIR_STYLES.map((style, i) => {
        const row = Math.floor(i / columns);
        const columnsInRow = Math.min(columns, HAIR_STYLES.length - row * columns);
        const column = i % columns;
        return (
          <group
            key={style}
            position={[(column - (columnsInRow - 1) / 2) * 1.12, (rows - row - 1) * 2.05, 0]}
          >
            <GltfCharacter appearance={appearanceFor(i, style)} status="idle" phase={i * 0.6} />
          </group>
        );
      })}
    </>
  );
}

function HeadsGrid() {
  const shapes = ['round', 'soft-square', 'capsule'] as const;
  const bodies = ['slim', 'normal', 'stocky'] as const;
  return (
    <>
      {shapes.flatMap((shape, r) =>
        bodies.map((body, c) => {
          const a = appearanceFor(r * 3 + c, 'short');
          return (
            <group key={`${shape}-${body}`} position={[(c - 1) * 1.5, 0, (r - 1) * 1.6]}>
              <GltfCharacter
                appearance={{ ...a, headShape: shape, bodyType: body }}
                status="idle"
                phase={(r * 3 + c) * 0.4}
              />
            </group>
          );
        }),
      )}
    </>
  );
}

/** Square-track walker replicating the production movement + heading fix. */
function Walker() {
  const ref = useRef<Group>(null);
  const walkingRef = useRef<CharacterMovementPhase>('walk');
  const wpIndex = useRef(0);
  const SPEED = 1.9;
  const TRACK: [number, number][] = [
    [2.5, 2.5],
    [-2.5, 2.5],
    [-2.5, -2.5],
    [2.5, -2.5],
  ];
  useFrame((_, delta) => {
    const group = ref.current;
    if (!group) return;
    const wp = TRACK[wpIndex.current % TRACK.length] ?? [0, 0];
    const dx = wp[0] - group.position.x;
    const dz = wp[1] - group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.06) {
      wpIndex.current += 1;
      return;
    }
    const step = Math.min(1, (SPEED * delta) / dist);
    group.position.x += dx * step;
    group.position.z += dz * step;
    // Heading: face the movement direction with shortest-arc smoothing.
    const target = Math.atan2(dx, dz);
    let diff = target - group.rotation.y;
    diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    group.rotation.y += diff * Math.min(1, delta * 10);
  });
  return (
    <group ref={ref} position={[2.5, 0, -2.5]}>
      <GltfCharacter
        appearance={appearanceFor(2, 'curly')}
        status="working"
        walkingRef={walkingRef}
      />
    </group>
  );
}

const staticWalkRef: { current: CharacterMovementPhase } = { current: 'walk' };

function Clip() {
  const clip = params.get('hairstyle') as HairStyle | null;
  return (
    <group>
      <GltfCharacter
        appearance={appearanceFor(Number(params.get('seed') ?? 2), clip ?? 'curly')}
        status="working"
        posture={params.get('posture') === 'sitting' ? 'sitting' : 'standing'}
        walkingRef={params.get('locomotion') === 'walk' ? staticWalkRef : undefined}
      />
    </group>
  );
}

const CAMS: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  hair: { pos: [0, 2.75, 9.2], target: [0, 2.05, 0] },
  heads: { pos: [0, 3.4, 6.4], target: [0, 1, 0] },
  walk: { pos: [6.5, 5.2, 6.5], target: [0, 0.8, 0] },
  clips: { pos: [0, 1.7, 2.6], target: [0, 1.15, 0] },
};
const cam = CAMS[view] ?? CAMS.hair;

createRoot(document.getElementById('lab-root') as HTMLElement).render(
  <Canvas
    shadows
    camera={{ position: cam?.pos, fov: 35 }}
    style={{ height: '100vh' }}
    onCreated={(state) => {
      (window as unknown as Record<string, unknown>).__labScene = state.scene;
    }}
  >
    <color attach="background" args={[LIGHT_SCENE_3D.sceneBackground]} />
    <Lights />
    <Suspense fallback={null}>
      {view === 'hair' ? <HairGrid /> : null}
      {view === 'heads' ? <HeadsGrid /> : null}
      {view === 'walk' ? <Walker /> : null}
      {view === 'clips' ? <Clip /> : null}
    </Suspense>
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial color={LIGHT_SCENE_3D.floorTile} />
    </mesh>
    <OrbitControls target={cam?.target} />
  </Canvas>,
);
