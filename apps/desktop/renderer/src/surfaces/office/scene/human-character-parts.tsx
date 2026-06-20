import type { ResolvedAppearance } from '@/lib/avatar.js';
import { RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh } from 'three';
import { HUMAN_DIMENSIONS, type HumanAction, type HumanPosture } from './human-character-rig.js';
import {
  alphaMaterial,
  darken,
  lighten,
  limbGeometry,
  sculptGeometry,
} from './human-character-geometry.js';
import { LIGHT_SCENE_3D } from './r3d/scene-colors.js';

export interface HumanBodyShape {
  readonly shoulder: number;
  readonly chest: number;
  readonly waist: number;
  readonly hip: number;
  readonly depth: number;
  readonly limb: number;
  readonly head: number;
}

export const HUMAN_BODY_SHAPES: Record<ResolvedAppearance['bodyType'], HumanBodyShape> = {
  slim: { shoulder: 0.91, chest: 0.88, waist: 0.86, hip: 0.92, depth: 0.91, limb: 0.9, head: 0.98 },
  normal: { shoulder: 1, chest: 1, waist: 1, hip: 1, depth: 1, limb: 1, head: 1 },
  stocky: { shoulder: 1.12, chest: 1.14, waist: 1.16, hip: 1.1, depth: 1.12, limb: 1.12, head: 1.03 },
};

export const HUMAN_PRESENTATION_SHAPES = {
  masculine: { shoulder: 1.08, chest: 1.04, waist: 0.96, hip: 0.96 },
  feminine: { shoulder: 0.94, chest: 1, waist: 0.9, hip: 1.08 },
  neutral: { shoulder: 1, chest: 1, waist: 1, hip: 1 },
} as const satisfies Record<
  ResolvedAppearance['gender'],
  { shoulder: number; chest: number; waist: number; hip: number }
>;

export type HumanPresentationShape = (typeof HUMAN_PRESENTATION_SHAPES)[ResolvedAppearance['gender']];

export function HumanTorso({
  body,
  presentation,
  color,
  opacity,
}: {
  body: HumanBodyShape;
  presentation: HumanPresentationShape;
  color: string;
  opacity: number;
}) {
  const shoulder = 0.285 * body.shoulder * presentation.shoulder;
  const chest = 0.255 * body.chest * presentation.chest;
  const waist = 0.205 * body.waist * presentation.waist;
  const geometry = sculptGeometry(
    `human-v3-torso:${shoulder}:${chest}:${waist}:${body.depth}`,
    [
      { y: 0, rx: waist * 0.98, rz: 0.13 * body.depth, z: -0.008 },
      { y: 0.09, rx: waist, rz: 0.135 * body.depth },
      { y: 0.25, rx: chest, rz: 0.155 * body.depth, z: 0.012 },
      { y: 0.42, rx: shoulder, rz: 0.145 * body.depth, z: 0.004 },
      { y: HUMAN_DIMENSIONS.torso, rx: shoulder * 0.72, rz: 0.12 * body.depth, z: -0.01 },
    ],
    28,
  );
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshPhysicalMaterial
        color={color}
        roughness={0.68}
        clearcoat={0.06}
        clearcoatRoughness={0.72}
        {...alphaMaterial(opacity)}
      />
    </mesh>
  );
}

export function HumanPelvis({
  body,
  presentation,
  color,
  opacity,
}: {
  body: HumanBodyShape;
  presentation: HumanPresentationShape;
  color: string;
  opacity: number;
}) {
  const hip = 0.225 * body.hip * presentation.hip;
  const waist = 0.205 * body.waist * presentation.waist;
  const geometry = sculptGeometry(
    `human-v3-pelvis:${hip}:${waist}`,
    [
      { y: 0, rx: hip * 0.88, rz: 0.14, z: 0.008 },
      { y: 0.06, rx: hip, rz: 0.15, z: 0.005 },
      { y: 0.15, rx: hip * 0.96, rz: 0.145 },
      { y: HUMAN_DIMENSIONS.pelvis, rx: waist, rz: 0.13, z: -0.006 },
    ],
    26,
  );
  return (
    <mesh geometry={geometry} castShadow>
      <meshStandardMaterial color={color} roughness={0.78} {...alphaMaterial(opacity)} />
    </mesh>
  );
}

export function HumanLimb({
  cacheKey,
  length,
  top,
  middle,
  bottom,
  color,
  opacity,
  skin = false,
}: {
  cacheKey: string;
  length: number;
  top: readonly [number, number];
  middle: readonly [number, number];
  bottom: readonly [number, number];
  color: string;
  opacity: number;
  skin?: boolean;
}) {
  return (
    <mesh geometry={limbGeometry(cacheKey, length, top, middle, bottom)} castShadow>
      <meshStandardMaterial color={color} roughness={skin ? 0.46 : 0.72} {...alphaMaterial(opacity)} />
    </mesh>
  );
}

function Eye({ side, action, opacity }: { side: -1 | 1; action: HumanAction; opacity: number }) {
  const focusX = action === 'working' ? side * -0.004 : action === 'active' ? side * 0.004 : 0;
  return (
    <group position={[side * 0.066, 0.025, 0.145]}>
      <mesh scale={[1.15, 0.72, 0.45]} castShadow>
        <sphereGeometry args={[0.04, 18, 12]} />
        <meshPhysicalMaterial
          color={LIGHT_SCENE_3D.whiteboardSurface}
          roughness={0.18}
          clearcoat={0.5}
          clearcoatRoughness={0.12}
          {...alphaMaterial(opacity)}
        />
      </mesh>
      <mesh position={[focusX, -0.001, 0.037]}>
        <circleGeometry args={[0.019, 20]} />
        <meshStandardMaterial color={LIGHT_SCENE_3D.selectionRing} roughness={0.28} {...alphaMaterial(opacity)} />
      </mesh>
      <mesh position={[focusX, -0.001, 0.039]}>
        <circleGeometry args={[0.009, 18]} />
        <meshBasicMaterial color={LIGHT_SCENE_3D.text} {...alphaMaterial(opacity)} />
      </mesh>
      <mesh position={[focusX - 0.005, 0.006, 0.041]}>
        <circleGeometry args={[0.0032, 12]} />
        <meshBasicMaterial color={LIGHT_SCENE_3D.whiteboardSurface} {...alphaMaterial(opacity)} />
      </mesh>
    </group>
  );
}

function Face({
  appearance,
  action,
  opacity,
}: {
  appearance: ResolvedAppearance;
  action: HumanAction;
  opacity: number;
}) {
  const active = action === 'active';
  const worried = action === 'dragging';
  return (
    <group>
      <Eye side={-1} action={action} opacity={opacity} />
      <Eye side={1} action={action} opacity={opacity} />
      {([-1, 1] as const).map((side) => (
        <RoundedBox
          key={`brow-${side}`}
          args={[0.073, 0.012, 0.012]}
          radius={0.005}
          smoothness={3}
          position={[side * 0.065, 0.087 + (active ? 0.012 : worried ? -0.004 : 0), 0.148]}
          rotation={[0, 0, side * (worried ? 0.16 : -0.08)]}
        >
          <meshStandardMaterial color={appearance.hair} roughness={0.78} {...alphaMaterial(opacity)} />
        </RoundedBox>
      ))}
      <mesh position={[0, -0.025, 0.156]} scale={[0.55, 1.1, 0.75]} castShadow>
        <sphereGeometry args={[0.024, 18, 12]} />
        <meshStandardMaterial color={appearance.skin} roughness={0.48} {...alphaMaterial(opacity)} />
      </mesh>
      <mesh position={[0, 0.018, 0.137]} scale={[0.42, 1.4, 0.45]} castShadow>
        <sphereGeometry args={[0.025, 16, 12]} />
        <meshStandardMaterial color={appearance.skin} roughness={0.48} {...alphaMaterial(opacity)} />
      </mesh>
      <mesh position={[0, -0.102, 0.143]} rotation={[0, 0, active ? Math.PI : 0]}>
        <torusGeometry args={[0.037, 0.006, 8, 24, active || worried ? Math.PI : Math.PI * 1.65]} />
        <meshStandardMaterial color={darken(appearance.skin, 0.2)} roughness={0.5} {...alphaMaterial(opacity)} />
      </mesh>
    </group>
  );
}

function Ear({ side, appearance, opacity }: { side: -1 | 1; appearance: ResolvedAppearance; opacity: number }) {
  return (
    <group position={[side * 0.176, -0.025, 0.002]}>
      <mesh scale={[0.48, 0.78, 0.3]} castShadow>
        <sphereGeometry args={[0.07, 18, 14]} />
        <meshStandardMaterial color={appearance.skin} roughness={0.48} {...alphaMaterial(opacity)} />
      </mesh>
      <mesh position={[0, 0, 0.019]} rotation={[0, 0, side * Math.PI / 2]}>
        <torusGeometry args={[0.025, 0.006, 7, 16, Math.PI * 1.45]} />
        <meshStandardMaterial color={darken(appearance.skin, 0.1)} roughness={0.55} {...alphaMaterial(opacity)} />
      </mesh>
    </group>
  );
}

function HairLock({
  position,
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
  color,
  opacity,
}: {
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  color: string;
  opacity: number;
}) {
  const geometry = sculptGeometry(
    'human-v3-hair-lock',
    [
      { y: 0.13, rx: 0.045, rz: 0.038 },
      { y: 0.04, rx: 0.052, rz: 0.043 },
      { y: -0.1, rx: 0.026, rz: 0.025 },
      { y: -0.15, rx: 0.008, rz: 0.008 },
    ],
    14,
  );
  return (
    <mesh geometry={geometry} position={position} rotation={rotation} scale={scale} castShadow>
      <meshStandardMaterial color={color} roughness={0.72} {...alphaMaterial(opacity)} />
    </mesh>
  );
}

function Hair({ appearance, opacity }: { appearance: ResolvedAppearance; opacity: number }) {
  if (appearance.hairStyle === 'bald') return null;
  const common = { color: appearance.hair, opacity };
  const sideLocks = appearance.hairStyle === 'long' || appearance.hairStyle === 'bob';
  return (
    <group>
      <mesh position={[0, 0.075, -0.008]} scale={[1.035, 0.88, 1.02]} castShadow>
        <sphereGeometry args={[0.18, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.64]} />
        <meshStandardMaterial color={appearance.hair} roughness={0.7} {...alphaMaterial(opacity)} />
      </mesh>
      {appearance.hairStyle === 'short' || appearance.hairStyle === 'spiky'
        ? [-0.1, -0.05, 0, 0.05, 0.1].map((x, index) => (
            <HairLock
              key={`fringe-${x}`}
              {...common}
              position={[x, 0.095 + Math.abs(index - 2) * 0.006, 0.118]}
              rotation={[1.45, 0, (index - 2) * 0.08]}
              scale={[0.75, appearance.hairStyle === 'spiky' ? 0.95 : 0.62, 0.72]}
            />
          ))
        : null}
      {sideLocks ? (
        <>
          <HairLock {...common} position={[-0.145, -0.02, -0.015]} rotation={[0.05, 0, -0.05]} scale={[1.12, 1.55, 1.12]} />
          <HairLock {...common} position={[0.145, -0.02, -0.015]} rotation={[0.05, 0, 0.05]} scale={[1.12, 1.55, 1.12]} />
          {appearance.hairStyle === 'long' ? (
            <HairLock {...common} position={[0, -0.03, -0.11]} rotation={[0.04, 0, 0]} scale={[1.65, 1.8, 1.1]} />
          ) : null}
        </>
      ) : null}
      {appearance.hairStyle === 'ponytail' ? (
        <>
          <mesh position={[0, 0.09, -0.155]} castShadow>
            <sphereGeometry args={[0.065, 18, 14]} />
            <meshStandardMaterial color={appearance.hair} roughness={0.7} {...alphaMaterial(opacity)} />
          </mesh>
          <HairLock {...common} position={[0, -0.015, -0.19]} rotation={[-0.12, 0, 0]} scale={[1.15, 1.75, 1.15]} />
        </>
      ) : null}
      {appearance.hairStyle === 'curly'
        ? [[-0.15, 0.1, 0.02], [-0.08, 0.18, 0.05], [0, 0.2, 0.06], [0.09, 0.17, 0.04], [0.15, 0.08, 0]].map(
            ([x, y, z]) => (
              <mesh key={`curl-${x}-${y}`} position={[x, y, z]} castShadow>
                <sphereGeometry args={[0.062, 14, 10]} />
                <meshStandardMaterial color={appearance.hair} roughness={0.75} {...alphaMaterial(opacity)} />
              </mesh>
            ),
          )
        : null}
      {appearance.hairStyle === 'braids'
        ? ([-1, 1] as const).map((side) => (
            <group key={`braid-${side}`} position={[side * 0.145, 0.01, -0.01]}>
              {[0, 1, 2, 3].map((index) => (
                <mesh key={index} position={[0, -0.09 - index * 0.075, -index * 0.008]} castShadow>
                  <sphereGeometry args={[0.043 - index * 0.004, 12, 10]} />
                  <meshStandardMaterial color={appearance.hair} roughness={0.75} {...alphaMaterial(opacity)} />
                </mesh>
              ))}
            </group>
          ))
        : null}
    </group>
  );
}

export function HumanHead({
  appearance,
  action,
  opacity,
}: {
  appearance: ResolvedAppearance;
  action: HumanAction;
  opacity: number;
}) {
  const headScale = HUMAN_BODY_SHAPES[appearance.bodyType].head;
  const geometry = sculptGeometry(
    `human-v3-head:${headScale}`,
    [
      { y: -0.245, rx: 0.055 * headScale, rz: 0.058 * headScale, z: 0.025 },
      { y: -0.205, rx: 0.115 * headScale, rz: 0.09 * headScale, z: 0.03 },
      { y: -0.135, rx: 0.155 * headScale, rz: 0.125 * headScale, z: 0.026 },
      { y: -0.02, rx: 0.177 * headScale, rz: 0.145 * headScale, z: 0.015 },
      { y: 0.105, rx: 0.174 * headScale, rz: 0.15 * headScale, z: -0.002 },
      { y: 0.205, rx: 0.14 * headScale, rz: 0.13 * headScale, z: -0.018 },
      { y: 0.255, rx: 0.055 * headScale, rz: 0.055 * headScale, z: -0.025 },
    ],
    32,
  );
  return (
    <group>
      <mesh geometry={geometry} castShadow>
        <meshPhysicalMaterial
          color={appearance.skin}
          roughness={0.46}
          clearcoat={0.04}
          clearcoatRoughness={0.7}
          {...alphaMaterial(opacity)}
        />
      </mesh>
      <Ear side={-1} appearance={appearance} opacity={opacity} />
      <Ear side={1} appearance={appearance} opacity={opacity} />
      <Hair appearance={appearance} opacity={opacity} />
      <Face appearance={appearance} action={action} opacity={opacity} />
    </group>
  );
}

export function HumanHand({
  side,
  appearance,
  opacity,
}: {
  side: -1 | 1;
  appearance: ResolvedAppearance;
  opacity: number;
}) {
  return (
    <group rotation={[0, side * 0.04, side * -0.02]}>
      <RoundedBox args={[0.085, 0.12, 0.045]} radius={0.025} smoothness={4} position={[0, -0.05, 0]} castShadow>
        <meshStandardMaterial color={appearance.skin} roughness={0.47} {...alphaMaterial(opacity)} />
      </RoundedBox>
      {[-0.028, -0.01, 0.01, 0.029].map((x, index) => (
        <mesh key={`finger-${x}`} position={[x, -0.126 + Math.abs(index - 1.5) * 0.006, 0.005]} castShadow>
          <capsuleGeometry args={[0.009, 0.045 - Math.abs(index - 1.5) * 0.004, 4, 8]} />
          <meshStandardMaterial color={appearance.skin} roughness={0.47} {...alphaMaterial(opacity)} />
        </mesh>
      ))}
      <mesh position={[side * 0.05, -0.065, 0.018]} rotation={[0.2, 0, side * -0.62]} castShadow>
        <capsuleGeometry args={[0.011, 0.05, 4, 8]} />
        <meshStandardMaterial color={appearance.skin} roughness={0.47} {...alphaMaterial(opacity)} />
      </mesh>
    </group>
  );
}

export function HumanShoe({ side, opacity }: { side: -1 | 1; opacity: number }) {
  return (
    <group position={[0, -HUMAN_DIMENSIONS.shin - 0.025, 0.075]}>
      <RoundedBox args={[0.14, 0.085, 0.27]} radius={0.035} smoothness={5} position={[0, 0, 0.035]} castShadow>
        <meshPhysicalMaterial
          color={LIGHT_SCENE_3D.characterShoe}
          roughness={0.36}
          clearcoat={0.28}
          clearcoatRoughness={0.5}
          {...alphaMaterial(opacity)}
        />
      </RoundedBox>
      <RoundedBox args={[0.132, 0.018, 0.278]} radius={0.008} smoothness={3} position={[0, -0.047, 0.04]}>
        <meshStandardMaterial color={darken(LIGHT_SCENE_3D.characterShoe, 0.08)} roughness={0.76} {...alphaMaterial(opacity)} />
      </RoundedBox>
      {[0, 1, 2].map((index) => (
        <mesh key={`lace-${side}-${index}`} position={[0, 0.035, -0.015 + index * 0.035]} rotation={[Math.PI / 2, 0, 0]}>
          <boxGeometry args={[0.075, 0.008, 0.008]} />
          <meshStandardMaterial color={lighten(LIGHT_SCENE_3D.characterShoe, 0.16)} roughness={0.62} {...alphaMaterial(opacity)} />
        </mesh>
      ))}
    </group>
  );
}

export function HumanClothingDetails({ appearance, opacity }: { appearance: ResolvedAppearance; opacity: number }) {
  const accent = appearance.accent.toLowerCase() !== appearance.clothing.toLowerCase();
  const collarColor = accent ? appearance.accent : lighten(appearance.clothing, 0.08);
  return (
    <group>
      {([-1, 1] as const).map((side) => (
        <RoundedBox
          key={`collar-${side}`}
          args={[0.15, 0.045, 0.018]}
          radius={0.01}
          smoothness={3}
          position={[side * 0.063, HUMAN_DIMENSIONS.torso - 0.015, 0.121]}
          rotation={[0.18, 0, side * 0.5]}
        >
          <meshStandardMaterial color={collarColor} roughness={0.7} {...alphaMaterial(opacity)} />
        </RoundedBox>
      ))}
      {appearance.accentVariant === 'vest' && accent ? (
        <RoundedBox args={[0.37, 0.39, 0.018]} radius={0.035} smoothness={4} position={[0, 0.3, 0.151]}>
          <meshStandardMaterial color={appearance.accent} roughness={0.78} {...alphaMaterial(opacity)} />
        </RoundedBox>
      ) : null}
      {appearance.accentVariant === 'jacket' && accent
        ? ([-1, 1] as const).map((side) => (
            <RoundedBox
              key={`lapel-${side}`}
              args={[0.105, 0.32, 0.018]}
              radius={0.012}
              smoothness={3}
              position={[side * 0.075, 0.34, 0.153]}
              rotation={[0.03, 0, side * 0.18]}
            >
              <meshStandardMaterial color={appearance.accent} roughness={0.72} {...alphaMaterial(opacity)} />
            </RoundedBox>
          ))
        : null}
      {appearance.accentVariant === 'scarf' && accent ? (
        <>
          <mesh position={[0, HUMAN_DIMENSIONS.torso + 0.025, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.115, 0.03, 10, 28]} />
            <meshStandardMaterial color={appearance.accent} roughness={0.86} {...alphaMaterial(opacity)} />
          </mesh>
          <RoundedBox args={[0.085, 0.31, 0.03]} radius={0.016} smoothness={3} position={[0.07, 0.4, 0.158]} rotation={[0, 0, -0.08]}>
            <meshStandardMaterial color={appearance.accent} roughness={0.86} {...alphaMaterial(opacity)} />
          </RoundedBox>
        </>
      ) : null}
      {([-1, 1] as const).map((side) => (
        <mesh key={`lanyard-${side}`} position={[side * 0.055, 0.36, 0.169]} rotation={[0, 0, side * -0.11]}>
          <boxGeometry args={[0.008, 0.28, 0.006]} />
          <meshStandardMaterial color={LIGHT_SCENE_3D.selectionRing} roughness={0.55} {...alphaMaterial(opacity)} />
        </mesh>
      ))}
      <RoundedBox args={[0.11, 0.085, 0.012]} radius={0.012} smoothness={3} position={[0, 0.21, 0.173]}>
        <meshPhysicalMaterial color={LIGHT_SCENE_3D.whiteboardSurface} roughness={0.22} clearcoat={0.45} {...alphaMaterial(opacity)} />
      </RoundedBox>
    </group>
  );
}

export function ActionHalo({ action, opacity }: { action: HumanAction; opacity: number }) {
  if (action === 'idle') return null;
  const color = action === 'working' ? LIGHT_SCENE_3D.ledGreen : action === 'active' ? LIGHT_SCENE_3D.selectionRing : LIGHT_SCENE_3D.ledAmber;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 0]}>
      <ringGeometry args={[0.36, action === 'dragging' ? 0.64 : 0.5, 52]} />
      <meshBasicMaterial transparent opacity={opacity * 0.34} depthWrite={false} color={color} side={2} />
    </mesh>
  );
}

export function TypingDots({ phase, opacity, posture }: { phase: number; opacity: number; posture: HumanPosture }) {
  const dots = [useRef<Mesh>(null), useRef<Mesh>(null), useRef<Mesh>(null)];
  useFrame((state) => {
    const t = state.clock.elapsedTime + phase;
    for (let index = 0; index < dots.length; index += 1) {
      const mesh = dots[index]?.current;
      if (!mesh) continue;
      const bounce = Math.max(0, Math.sin(t * 5.2 - index * 0.85));
      mesh.position.y = bounce * 0.055;
      mesh.scale.setScalar(0.88 + bounce * 0.35);
    }
  });
  return (
    <group position={[0, posture === 'sitting' ? 1.9 : 1.82, 0]}>
      {[-0.075, 0, 0.075].map((x, index) => (
        <mesh key={x} position={[x, 0, 0]} ref={dots[index]}>
          <sphereGeometry args={[0.025, 10, 8]} />
          <meshBasicMaterial color={LIGHT_SCENE_3D.ledGreen} transparent opacity={opacity * 0.9} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
