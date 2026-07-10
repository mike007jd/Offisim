import type { CharacterStatus } from '@offisim/shared-types';
import { RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { type RefObject, useRef } from 'react';
import type { Mesh } from 'three';
import {
  CHARACTER_INDICATOR_GEOMETRY as G,
  characterIndicatorPresentation,
} from '../office-visual-language.js';
import {
  LIGHT_SCENE_3D,
  OFFICE_TOY_SIGNAL_COLORS,
  OFFICE_TOY_STATE_COLORS,
} from '../r3d/scene-colors.js';

interface CharacterIndicatorsProps {
  readonly status: CharacterStatus;
  readonly selected: boolean;
  readonly dragging: boolean;
  readonly opacity: number;
  readonly phase: number;
  readonly headY: number;
  readonly reducedMotion: boolean;
  readonly hasTypedResourceMarker: boolean;
}

type DotRefs = readonly [RefObject<Mesh | null>, RefObject<Mesh | null>, RefObject<Mesh | null>];

function WorkingDotMeshes({
  headY,
  opacity,
  refs,
}: {
  readonly headY: number;
  readonly opacity: number;
  readonly refs?: DotRefs;
}) {
  return (
    <group position={[0, headY, 0]}>
      {[-0.09, 0, 0.09].map((x, index) => (
        <mesh key={x} position={[x, 0, 0]} ref={refs?.[index]}>
          <sphereGeometry args={[G.dotRadius, 10, 8]} />
          <meshBasicMaterial
            color={OFFICE_TOY_STATE_COLORS.working}
            transparent
            opacity={opacity * 0.78}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function AnimatedWorkingDots({
  phase,
  headY,
  opacity,
}: {
  readonly phase: number;
  readonly headY: number;
  readonly opacity: number;
}) {
  const dotA = useRef<Mesh>(null);
  const dotB = useRef<Mesh>(null);
  const dotC = useRef<Mesh>(null);
  const dotRefs = [dotA, dotB, dotC] as const;

  useFrame((state) => {
    const t = state.clock.elapsedTime + phase;
    for (let index = 0; index < dotRefs.length; index += 1) {
      const dot = dotRefs[index]?.current;
      if (!dot) continue;
      // Restrained 1.6s cadence with a small vertical lift; state remains
      // readable when frozen because all three dots stay visible.
      const wave = Math.max(0, Math.sin(t * ((Math.PI * 2) / 1.6) - index * 0.76));
      dot.position.y = wave * G.dotAmplitude;
      dot.scale.setScalar(0.9 + wave * 0.2);
    }
  });

  return <WorkingDotMeshes headY={headY} opacity={opacity} refs={dotRefs} />;
}

/**
 * The office's single indicator renderer. Business state owns at most one
 * ground treatment plus one head confirmation; selection is one orthogonal
 * outer ring. Drag feedback stays outside this component on the drag ghost.
 */
export function CharacterIndicators({
  status,
  selected,
  dragging,
  opacity,
  phase,
  headY,
  reducedMotion,
  hasTypedResourceMarker,
}: CharacterIndicatorsProps) {
  const presentation = characterIndicatorPresentation(
    status,
    selected,
    reducedMotion,
    dragging,
    hasTypedResourceMarker,
  );

  if (presentation.layers.length === 0) return null;
  const has = (id: (typeof presentation.layers)[number]) => presentation.layers.includes(id);

  return (
    <group>
      {has('base-disc') ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.016, 0]}>
          <circleGeometry args={[G.baseDiscRadius, 48]} />
          <meshBasicMaterial
            color={OFFICE_TOY_SIGNAL_COLORS.neutral}
            transparent
            opacity={opacity * 0.06}
            depthWrite={false}
          />
        </mesh>
      ) : null}
      {has('working-disc') ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 0]}>
          <circleGeometry args={[G.workingDiscRadius, 52]} />
          <meshBasicMaterial
            color={OFFICE_TOY_STATE_COLORS.working}
            transparent
            opacity={opacity * 0.1}
            depthWrite={false}
          />
        </mesh>
      ) : null}
      {has('approval-ring') ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
          <ringGeometry args={[G.stateRingInner, G.stateRingOuter, 52]} />
          <meshBasicMaterial
            color={OFFICE_TOY_STATE_COLORS.approval}
            transparent
            opacity={opacity * 0.48}
            depthWrite={false}
          />
        </mesh>
      ) : null}
      {has('blocked-segments')
        ? [0, 1, 2].map((index) => (
            <mesh key={index} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
              <ringGeometry
                args={[
                  G.stateRingInner,
                  G.stateRingOuter,
                  18,
                  1,
                  index * ((Math.PI * 2) / 3),
                  Math.PI * 0.4,
                ]}
              />
              <meshBasicMaterial
                color={OFFICE_TOY_STATE_COLORS.blocked}
                transparent
                opacity={opacity * 0.62}
                depthWrite={false}
              />
            </mesh>
          ))
        : null}
      {has('selected-ring') ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.032, 0]}>
          <ringGeometry args={[G.selectedRingInner, G.selectedRingOuter, 56]} />
          <meshBasicMaterial
            color={OFFICE_TOY_STATE_COLORS.selected}
            transparent
            opacity={opacity * 0.9}
            depthWrite={false}
          />
        </mesh>
      ) : null}
      {has('working-dots') ? (
        presentation.dotsAnimated ? (
          <AnimatedWorkingDots phase={phase} headY={headY} opacity={opacity} />
        ) : (
          <WorkingDotMeshes headY={headY} opacity={opacity} />
        )
      ) : null}
      {has('approval-marker') || has('blocked-marker') ? (
        <group position={[0.29, headY + 0.02, 0]}>
          <RoundedBox
            args={[G.headMarkerSize, G.headMarkerSize, 0.052]}
            radius={0.035}
            smoothness={3}
          >
            <meshStandardMaterial
              color={
                has('approval-marker')
                  ? OFFICE_TOY_STATE_COLORS.approval
                  : OFFICE_TOY_STATE_COLORS.blocked
              }
              roughness={0.76}
              metalness={0}
              emissive={LIGHT_SCENE_3D.emissiveBase}
            />
          </RoundedBox>
        </group>
      ) : null}
    </group>
  );
}
