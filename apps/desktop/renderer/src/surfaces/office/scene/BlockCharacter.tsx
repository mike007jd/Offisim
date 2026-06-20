import type { ResolvedAppearance } from '@/lib/avatar.js';
import { RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { Group } from 'three';
import { alphaMaterial, darken, lighten } from './human-character-geometry.js';
import { HumanHeadModel } from './human-character-head.js';
import {
  ActionHalo,
  HumanClothingDetails,
  HUMAN_BODY_SHAPES,
  HUMAN_PRESENTATION_SHAPES,
  HumanHand,
  HumanLimb,
  HumanPelvis,
  HumanShoe,
  HumanTorso,
  TypingDots,
} from './human-character-parts.js';
import {
  applyHumanPose,
  HUMAN_DIMENSIONS,
  type HumanAction,
  type HumanPosture,
  type HumanRigRefs,
} from './human-character-rig.js';
import { LIGHT_SCENE_3D } from './r3d/scene-colors.js';

export type BlockCharacterAction = HumanAction;
export type BlockCharacterPosture = HumanPosture;

interface BlockCharacterProps {
  appearance: ResolvedAppearance;
  action?: BlockCharacterAction;
  posture?: BlockCharacterPosture;
  running?: boolean;
  phase?: number;
  opacity?: number;
}

/**
 * Human-proportioned Offisim employee.
 *
 * The model preserves the existing placement, appearance and run-state
 * contracts while replacing the disconnected chibi rig. Torso, pelvis, jaw
 * and limbs are sculpted surfaces; elbows and knees articulate independently;
 * eyes, eyelids, nose, mouth, ears, five-finger hands, hair and clothing layers
 * are physical geometry.
 */
export function BlockCharacter({
  appearance,
  action,
  posture = 'standing',
  running = false,
  phase = 0,
  opacity = 1,
}: BlockCharacterProps) {
  const actionState: HumanAction = action ?? (running ? 'working' : 'idle');
  const body = HUMAN_BODY_SHAPES[appearance.bodyType];
  const presentation = HUMAN_PRESENTATION_SHAPES[appearance.gender];
  const pantsColor = useMemo(() => darken(appearance.clothing, 0.24), [appearance.clothing]);
  const seamColor = useMemo(() => lighten(appearance.clothing, 0.1), [appearance.clothing]);
  const cuffColor =
    appearance.accent.toLowerCase() === appearance.clothing.toLowerCase()
      ? lighten(appearance.clothing, 0.08)
      : appearance.accent;

  const root = useRef<Group>(null);
  const pelvis = useRef<Group>(null);
  const torso = useRef<Group>(null);
  const head = useRef<Group>(null);
  const leftUpperArm = useRef<Group>(null);
  const rightUpperArm = useRef<Group>(null);
  const leftForearm = useRef<Group>(null);
  const rightForearm = useRef<Group>(null);
  const leftHand = useRef<Group>(null);
  const rightHand = useRef<Group>(null);
  const leftThigh = useRef<Group>(null);
  const rightThigh = useRef<Group>(null);
  const leftShin = useRef<Group>(null);
  const rightShin = useRef<Group>(null);

  const rig = useMemo<HumanRigRefs>(
    () => ({
      root,
      pelvis,
      torso,
      head,
      leftUpperArm,
      rightUpperArm,
      leftForearm,
      rightForearm,
      leftHand,
      rightHand,
      leftThigh,
      rightThigh,
      leftShin,
      rightShin,
    }),
    [],
  );

  useFrame((state) => {
    applyHumanPose(rig, actionState, posture, state.clock.elapsedTime + phase);
  });

  const shoulderX = 0.275 * body.shoulder * presentation.shoulder;
  const hipX = 0.13 * body.hip * presentation.hip;
  const upperArmWidth = 0.065 * body.limb;
  const forearmWidth = 0.055 * body.limb;
  const thighWidth = 0.09 * body.limb;
  const shinWidth = 0.072 * body.limb;

  return (
    <group>
      <ActionHalo action={actionState} opacity={opacity} />
      {actionState === 'working' ? (
        <TypingDots phase={phase} opacity={opacity} posture={posture} />
      ) : null}

      <group scale={HUMAN_DIMENSIONS.modelScale}>
        <group ref={root}>
          {([-1, 1] as const).map((side) => {
            const thighRef = side === -1 ? leftThigh : rightThigh;
            const shinRef = side === -1 ? leftShin : rightShin;
            return (
              <group
                key={`leg-${side}`}
                ref={thighRef}
                position={[side * hipX, HUMAN_DIMENSIONS.hipY, 0]}
              >
                <HumanLimb
                  cacheKey={`human-v3-thigh:${body.limb}`}
                  length={HUMAN_DIMENSIONS.thigh}
                  top={[thighWidth * 1.08, thighWidth * 1.12]}
                  middle={[thighWidth, thighWidth * 1.04]}
                  bottom={[thighWidth * 0.74, thighWidth * 0.78]}
                  color={pantsColor}
                  opacity={opacity}
                />
                <group ref={shinRef} position={[0, -HUMAN_DIMENSIONS.thigh, 0]}>
                  <mesh position={[0, -0.015, 0.035]} scale={[1, 0.82, 0.7]} castShadow>
                    <sphereGeometry args={[thighWidth * 0.7, 16, 12]} />
                    <meshStandardMaterial
                      color={pantsColor}
                      roughness={0.75}
                      {...alphaMaterial(opacity)}
                    />
                  </mesh>
                  <HumanLimb
                    cacheKey={`human-v3-shin:${body.limb}`}
                    length={HUMAN_DIMENSIONS.shin}
                    top={[shinWidth * 0.95, shinWidth]}
                    middle={[shinWidth * 0.82, shinWidth * 0.88]}
                    bottom={[shinWidth * 0.68, shinWidth * 0.72]}
                    color={pantsColor}
                    opacity={opacity}
                  />
                  <HumanShoe side={side} opacity={opacity} />
                </group>
              </group>
            );
          })}

          <group ref={pelvis} position={[0, HUMAN_DIMENSIONS.hipY, 0]}>
            <HumanPelvis
              body={body}
              presentation={presentation}
              color={pantsColor}
              opacity={opacity}
            />
            <mesh position={[0, HUMAN_DIMENSIONS.pelvis - 0.018, 0]} castShadow>
              <cylinderGeometry
                args={[
                  0.218 * body.hip * presentation.hip,
                  0.21 * body.waist * presentation.waist,
                  0.035,
                  28,
                ]}
              />
              <meshStandardMaterial
                color={darken(pantsColor, 0.12)}
                roughness={0.62}
                {...alphaMaterial(opacity)}
              />
            </mesh>
            <RoundedBox
              args={[0.055, 0.04, 0.018]}
              radius={0.006}
              smoothness={3}
              position={[0, HUMAN_DIMENSIONS.pelvis - 0.017, 0.145]}
            >
              <meshPhysicalMaterial
                color={LIGHT_SCENE_3D.metal}
                roughness={0.32}
                metalness={0.66}
                {...alphaMaterial(opacity)}
              />
            </RoundedBox>

            <group ref={torso} position={[0, HUMAN_DIMENSIONS.pelvis - 0.01, 0]}>
              <HumanTorso
                body={body}
                presentation={presentation}
                color={appearance.clothing}
                opacity={opacity}
              />
              <HumanClothingDetails appearance={appearance} opacity={opacity} />

              {([-1, 1] as const).map((side) => (
                <mesh
                  key={`seam-${side}`}
                  position={[side * shoulderX * 0.83, 0.28, 0.02]}
                  rotation={[0, 0, side * 0.035]}
                >
                  <boxGeometry args={[0.006, 0.38, 0.008]} />
                  <meshStandardMaterial
                    color={seamColor}
                    roughness={0.8}
                    {...alphaMaterial(opacity)}
                  />
                </mesh>
              ))}

              {([-1, 1] as const).map((side) => {
                const upperArmRef = side === -1 ? leftUpperArm : rightUpperArm;
                const forearmRef = side === -1 ? leftForearm : rightForearm;
                const handRef = side === -1 ? leftHand : rightHand;
                return (
                  <group
                    key={`arm-${side}`}
                    ref={upperArmRef}
                    position={[side * shoulderX, HUMAN_DIMENSIONS.shoulderY, 0]}
                  >
                    <mesh position={[0, -0.035, 0]} scale={[1.08, 0.92, 1]} castShadow>
                      <sphereGeometry args={[upperArmWidth * 1.18, 18, 14]} />
                      <meshStandardMaterial
                        color={appearance.clothing}
                        roughness={0.72}
                        {...alphaMaterial(opacity)}
                      />
                    </mesh>
                    <HumanLimb
                      cacheKey={`human-v3-upper-arm:${body.limb}`}
                      length={HUMAN_DIMENSIONS.upperArm}
                      top={[upperArmWidth * 1.08, upperArmWidth]}
                      middle={[upperArmWidth * 0.9, upperArmWidth * 0.88]}
                      bottom={[upperArmWidth * 0.72, upperArmWidth * 0.72]}
                      color={appearance.clothing}
                      opacity={opacity}
                    />
                    <group ref={forearmRef} position={[0, -HUMAN_DIMENSIONS.upperArm, 0]}>
                      <mesh position={[0, -0.012, 0]} scale={[1, 0.82, 0.9]} castShadow>
                        <sphereGeometry args={[forearmWidth * 0.86, 16, 12]} />
                        <meshStandardMaterial
                          color={appearance.clothing}
                          roughness={0.72}
                          {...alphaMaterial(opacity)}
                        />
                      </mesh>
                      <HumanLimb
                        cacheKey={`human-v3-forearm:${body.limb}`}
                        length={HUMAN_DIMENSIONS.forearm}
                        top={[forearmWidth * 0.92, forearmWidth * 0.9]}
                        middle={[forearmWidth * 0.78, forearmWidth * 0.78]}
                        bottom={[forearmWidth * 0.64, forearmWidth * 0.64]}
                        color={appearance.clothing}
                        opacity={opacity}
                      />
                      <RoundedBox
                        args={[forearmWidth * 1.75, 0.045, forearmWidth * 1.62]}
                        radius={0.012}
                        smoothness={3}
                        position={[0, -HUMAN_DIMENSIONS.forearm + 0.02, 0]}
                      >
                        <meshStandardMaterial
                          color={cuffColor}
                          roughness={0.68}
                          {...alphaMaterial(opacity)}
                        />
                      </RoundedBox>
                      <group ref={handRef} position={[0, -HUMAN_DIMENSIONS.forearm - 0.015, 0]}>
                        <HumanHand side={side} appearance={appearance} opacity={opacity} />
                      </group>
                    </group>
                  </group>
                );
              })}

              <mesh position={[0, HUMAN_DIMENSIONS.torso + 0.055, -0.005]} castShadow>
                <cylinderGeometry args={[0.07, 0.087, 0.145, 22]} />
                <meshStandardMaterial
                  color={appearance.skin}
                  roughness={0.47}
                  {...alphaMaterial(opacity)}
                />
              </mesh>
              <group ref={head} position={[0, HUMAN_DIMENSIONS.headY, 0]}>
                <HumanHeadModel
                  appearance={appearance}
                  action={actionState}
                  opacity={opacity}
                  phase={phase}
                />
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
