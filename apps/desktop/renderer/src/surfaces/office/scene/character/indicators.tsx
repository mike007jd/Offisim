import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh } from 'three';
import { LIGHT_SCENE_3D } from '../r3d/scene-colors.js';

/**
 * Character status indicators — the one indicator language for the office
 * character renderer (GltfCharacter): the ground action halo and the
 * working typing dots. Kept separate from the rig/animation code so the
 * indicator grammar stays renderer-agnostic (halo on the floor at the
 * character anchor, dots at a caller-supplied head clearance).
 */

/** UI action states driving the indicators (and the legacy pose fallback). */
export type CharacterAction = 'idle' | 'working' | 'active' | 'dragging';

/** Ground halo for the non-idle action states. */
export function ActionHalo({ action, opacity }: { action: CharacterAction; opacity: number }) {
  if (action === 'idle') return null;
  const color =
    action === 'working'
      ? LIGHT_SCENE_3D.ledGreen
      : action === 'active'
        ? LIGHT_SCENE_3D.selectionRing
        : LIGHT_SCENE_3D.ledAmber;
  return (
    <group position={[0, 0.028, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.42, action === 'dragging' ? 0.74 : 0.58, 52]} />
        <meshBasicMaterial transparent opacity={opacity * 0.38} depthWrite={false} color={color} />
      </mesh>
      {action === 'active' ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
          <circleGeometry args={[0.46, 52]} />
          <meshBasicMaterial
            transparent
            opacity={opacity * 0.08}
            depthWrite={false}
            color={color}
          />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * Three bouncing dots above the head — the unmistakable "I'm working" tell.
 * `y` is the head-clearance height (scene units): the character renderer
 * passes its own silhouette's value.
 */
export function TypingDots({
  phase,
  opacity,
  y,
  reducedMotion = false,
}: { phase: number; opacity: number; y: number; reducedMotion?: boolean }) {
  const dotRefs = [useRef<Mesh>(null), useRef<Mesh>(null), useRef<Mesh>(null)];
  useFrame((state) => {
    const t = state.clock.elapsedTime + phase;
    // Plain loop: this runs every frame for every working character.
    for (let index = 0; index < dotRefs.length; index += 1) {
      const mesh = dotRefs[index]?.current;
      if (!mesh) continue;
      if (reducedMotion) {
        // Static dots — the typing indicator stays as status, without the bounce.
        mesh.position.y = 0;
        mesh.scale.setScalar(1);
        continue;
      }
      const bounce = Math.max(0, Math.sin(t * 5.4 - index * 0.85));
      mesh.position.y = bounce * 0.07;
      mesh.scale.setScalar(0.85 + bounce * 0.45);
    }
  });
  return (
    <group position={[0, y, 0]}>
      {[-0.09, 0, 0.09].map((x, index) => (
        <mesh key={x} position={[x, 0, 0]} ref={dotRefs[index]}>
          <sphereGeometry args={[0.032, 10, 8]} />
          <meshBasicMaterial
            color={LIGHT_SCENE_3D.ledGreen}
            transparent
            opacity={opacity * 0.9}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
