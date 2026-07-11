/**
 * DEV-ONLY character lab — visual iteration harness for the toy character.
 * Not part of the app build; served only by `vite dev` as /character-lab.html.
 *
 * Views (query param `?view=`):
 *   hair   — all 8 hair styles front-facing close-up grid          (default)
 *   heads  — head shapes × body types matrix
 *   walk   — one walker looping a square track (heading/stride test)
 *   clips  — a single character cycling a chosen clip (?clip=walk)
 */
import type { HairStyle, ResolvedAppearance } from '@/lib/avatar.js';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Suspense, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { Group } from 'three';
import type { CharacterMovementPhase } from '@/surfaces/office/scene/character-movement.js';
import { GltfCharacter } from '@/surfaces/office/scene/character/GltfCharacter.js';

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
];

const SKINS = ['#f2d2bd', '#e5b48a', '#c9875a', '#a95f38', '#68483c', '#4a3029'];
const HAIRC = ['#2c1b18', '#4a312c', '#724133', '#a55728', '#b58143', '#d6b370', '#e8e1e1', '#724133'];

function appearanceFor(i: number, hairStyle: HairStyle): ResolvedAppearance {
  return {
    skin: SKINS[i % SKINS.length] ?? '#e5b48a',
    hair: HAIRC[i % HAIRC.length] ?? '#2c1b18',
    clothing: ['#2f6bff', '#7c4ddb', '#1aa46a', '#c98410', '#d6453d', '#3c4a60'][i % 6] ?? '#2f6bff',
    accent: ['#d6453d', '#1aa46a', '#2f6bff', '#5b2fb0', '#c98410', '#0f7a4d'][i % 6] ?? '#d6453d',
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
      <hemisphereLight args={['#dfe8f2', '#b9a98f', 0.38]} />
      <directionalLight castShadow position={[10, 20, 12]} intensity={1.2} color="#fff2df" />
      <directionalLight position={[-15, 12, -10]} intensity={0.24} color="#cfe0f4" />
      <directionalLight position={[5, 9, -18]} intensity={0.2} color="#ffe7c4" />
      <ambientLight intensity={0.12} />
    </>
  );
}

function HairGrid() {
  return (
    <>
      {HAIR_STYLES.map((style, i) => (
        <group key={style} position={[(i - 3.5) * 1.12, 0, 0]}>
          <GltfCharacter appearance={appearanceFor(i, style)} status="idle" phase={i * 0.6} />
        </group>
      ))}
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
      <GltfCharacter appearance={appearanceFor(2, 'curly')} status="working" walkingRef={walkingRef} />
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
  hair: { pos: [0, 1.9, 7.4], target: [0, 1.45, 0] },
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
    <color attach="background" args={['#e8e6e1']} />
    <Lights />
    <Suspense fallback={null}>
      {view === 'hair' ? <HairGrid /> : null}
      {view === 'heads' ? <HeadsGrid /> : null}
      {view === 'walk' ? <Walker /> : null}
      {view === 'clips' ? <Clip /> : null}
    </Suspense>
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial color="#d9d4cb" />
    </mesh>
    <OrbitControls target={cam?.target} />
  </Canvas>,
);
