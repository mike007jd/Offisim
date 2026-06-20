import type { ResolvedAppearance } from '@/lib/avatar.js';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh } from 'three';
import { alphaMaterial, darken } from './human-character-geometry.js';
import { HumanHead } from './human-character-parts.js';
import type { HumanAction } from './human-character-rig.js';

const HEAD_PROPORTION_SCALE = 0.76;

function AnimatedEyelids({
  appearance,
  action,
  opacity,
  phase,
}: {
  appearance: ResolvedAppearance;
  action: HumanAction;
  opacity: number;
  phase: number;
}) {
  const left = useRef<Mesh>(null);
  const right = useRef<Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime + phase * 1.7;
    const canBlink = action === 'idle' || action === 'working';
    const blinkWindow = canBlink ? Math.max(0, 1 - Math.abs((t % 4.6) - 0.12) / 0.12) : 0;
    const lidScale = 0.08 + blinkWindow * 0.92;
    const lidY = 0.056 - blinkWindow * 0.03;
    for (const mesh of [left.current, right.current]) {
      if (!mesh) continue;
      mesh.scale.y = lidScale;
      mesh.position.y = lidY;
    }
  });

  return (
    <group>
      {([-1, 1] as const).map((side) => (
        <mesh
          key={`eyelid-${side}`}
          ref={side === -1 ? left : right}
          position={[side * 0.066, 0.056, 0.181]}
          scale={[1.15, 0.08, 0.42]}
          castShadow
        >
          <sphereGeometry args={[0.041, 18, 12]} />
          <meshStandardMaterial
            color={appearance.skin}
            roughness={0.47}
            {...alphaMaterial(opacity)}
          />
        </mesh>
      ))}
      {([-1, 1] as const).map((side) => (
        <mesh key={`lash-${side}`} position={[side * 0.066, 0.071, 0.185]} scale={[1.08, 0.18, 0.3]}>
          <sphereGeometry args={[0.042, 16, 10]} />
          <meshStandardMaterial
            color={darken(appearance.hair, 0.04)}
            roughness={0.72}
            {...alphaMaterial(opacity)}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Final head wrapper: six-head body proportion plus physical eyelid animation.
 * The internal head owns the sculpted cranium, jaw, ears, eyes, nose, mouth and
 * hairstyle; this wrapper keeps those details while correcting the old chibi
 * scale and adding a real blink instead of a face-texture swap.
 */
export function HumanHeadModel({
  appearance,
  action,
  opacity,
  phase,
}: {
  appearance: ResolvedAppearance;
  action: HumanAction;
  opacity: number;
  phase: number;
}) {
  return (
    <group scale={HEAD_PROPORTION_SCALE}>
      <HumanHead appearance={appearance} action={action} opacity={opacity} />
      <AnimatedEyelids appearance={appearance} action={action} opacity={opacity} phase={phase} />
    </group>
  );
}
