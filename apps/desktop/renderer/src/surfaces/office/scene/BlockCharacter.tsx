import type { ResolvedAppearance } from '@/lib/avatar.js';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Bone, DoubleSide, Skeleton } from 'three';
import { type FaceExpression, getFaceTexture } from './character-face-texture.js';
import { LIGHT_SCENE_3D } from './r3d/scene-colors.js';

/**
 * Chibi "block person", ported from the legacy `character-mesh-builder` — body
 * type / gender / hair style / accent variant all shape the silhouette, with a
 * canvas-texture face that reflects run state. Materials use plain three
 * standard materials (the legacy SceneMaterial wrapper lived in the old package).
 */

const SHOE_COLOR = LIGHT_SCENE_3D.characterShoe;

// Chibi proportions: head ~28% of total height.
const LEG_LENGTH = 0.42;
const LOWER_TORSO_HEIGHT = 0.22;
const UPPER_TORSO_HEIGHT = 0.32;
const HEAD_SIZE = 0.42;
const HIP_Y = LEG_LENGTH;
const SPINE_Y = LOWER_TORSO_HEIGHT;
const SHOULDER_Y = UPPER_TORSO_HEIGHT * 0.72;
const HEAD_LOCAL_Y = UPPER_TORSO_HEIGHT + HEAD_SIZE / 2 + 0.04;
const ARM_LENGTH = 0.38;
const FACE_SPRITE_SIZE = HEAD_SIZE * 0.78;
const FACE_SPRITE_Z = HEAD_SIZE / 2 + 0.002;

function materialAlpha(opacity: number) {
  return opacity < 1 ? { transparent: true, opacity, depthWrite: false } : {};
}

const BODY_TYPE_FACTORS = {
  slim: { torso: 0.75, arm: 0.78, leg: 0.95, head: 1.0, bellyExtra: 0 },
  normal: { torso: 1.0, arm: 1.0, leg: 1.0, head: 1.0, bellyExtra: 0 },
  stocky: { torso: 1.4, arm: 1.22, leg: 1.04, head: 1.06, bellyExtra: 0.12 },
} as const;

const GENDER_FACTORS = {
  masculine: { shoulder: 1.12, hip: 0.92, aspect: 1.0, showSkirt: false, shoulderChamfer: true },
  feminine: { shoulder: 0.82, hip: 1.18, aspect: 0.95, showSkirt: true, shoulderChamfer: false },
  neutral: { shoulder: 1.0, hip: 1.0, aspect: 1.0, showSkirt: false, shoulderChamfer: false },
} as const;

export type BlockCharacterAction = 'idle' | 'working' | 'active' | 'dragging';

interface CharacterRig {
  skeleton: Skeleton;
  root: Bone;
  hips: Bone;
  spine: Bone;
  head: Bone;
  leftArm: Bone;
  rightArm: Bone;
  leftLeg: Bone;
  rightLeg: Bone;
}

function namedBone(name: string): Bone {
  const bone = new Bone();
  bone.name = name;
  return bone;
}

function createCharacterRig(): CharacterRig {
  const rig = {
    root: namedBone('offisim-character-root'),
    hips: namedBone('hips'),
    spine: namedBone('spine'),
    head: namedBone('head'),
    leftArm: namedBone('left-arm'),
    rightArm: namedBone('right-arm'),
    leftLeg: namedBone('left-leg'),
    rightLeg: namedBone('right-leg'),
  };
  const skeleton = new Skeleton([
    rig.root,
    rig.hips,
    rig.spine,
    rig.head,
    rig.leftArm,
    rig.rightArm,
    rig.leftLeg,
    rig.rightLeg,
  ]);
  skeleton.calculateInverses();
  return { ...rig, skeleton };
}

function applyCharacterPose(rig: CharacterRig, action: BlockCharacterAction, t: number): void {
  const slow = Math.sin(t * 1.6);
  const medium = Math.sin(t * 2.7);
  const fast = Math.sin(t * 7.4);

  rig.root.position.y = Math.sin(t * (action === 'working' ? 4.2 : 1.6)) * 0.018;
  rig.root.rotation.set(0, Math.sin(t * 0.8) * 0.025, 0);
  rig.hips.rotation.set(0, 0, slow * 0.035);
  rig.spine.rotation.set(-0.03 + medium * 0.018, 0, -slow * 0.025);
  rig.head.rotation.set(0.04 + slow * 0.04, medium * 0.035, -slow * 0.025);
  rig.leftArm.rotation.set(-0.08, 0, -0.08);
  rig.rightArm.rotation.set(-0.08, 0, 0.08);
  rig.leftLeg.rotation.set(0, 0, 0.02);
  rig.rightLeg.rotation.set(0, 0, -0.02);

  if (action === 'working') {
    rig.root.position.y = Math.sin(t * 4.8) * 0.028;
    rig.spine.rotation.set(-0.14 + medium * 0.018, 0, slow * 0.018);
    rig.head.rotation.set(0.18 + slow * 0.025, medium * 0.02, 0);
    rig.leftArm.rotation.set(-0.92 + fast * 0.12, 0.1, -0.34 + medium * 0.08);
    rig.rightArm.rotation.set(-0.92 - fast * 0.1, -0.1, 0.34 - medium * 0.08);
    rig.leftLeg.rotation.set(0.04, 0, 0.035);
    rig.rightLeg.rotation.set(-0.04, 0, -0.035);
  } else if (action === 'active') {
    rig.root.position.y = 0.018 + Math.sin(t * 2.2) * 0.035;
    rig.hips.rotation.set(0, 0, medium * 0.045);
    rig.spine.rotation.set(-0.04, 0, -slow * 0.04);
    rig.head.rotation.set(-0.02 + slow * 0.035, 0.12 + medium * 0.05, 0.02);
    rig.leftArm.rotation.set(-0.62 + slow * 0.08, 0, -0.48);
    rig.rightArm.rotation.set(-1.12 + medium * 0.12, 0, 0.42);
    rig.leftLeg.rotation.set(-0.03, 0, 0.03);
    rig.rightLeg.rotation.set(0.03, 0, -0.03);
  } else if (action === 'dragging') {
    rig.root.position.y = 0.04 + Math.abs(Math.sin(t * 7)) * 0.055;
    rig.root.rotation.set(0, Math.sin(t * 3) * 0.12, 0);
    rig.hips.rotation.set(0, 0, fast * 0.08);
    rig.spine.rotation.set(-0.05 + medium * 0.08, 0, -fast * 0.035);
    rig.head.rotation.set(0.06, medium * 0.08, fast * 0.025);
    rig.leftArm.rotation.set(-1.1 + fast * 0.16, 0.15, -0.58);
    rig.rightArm.rotation.set(-1.1 - fast * 0.16, -0.15, 0.58);
    rig.leftLeg.rotation.set(fast * 0.32, 0, 0.08);
    rig.rightLeg.rotation.set(-fast * 0.32, 0, -0.08);
  }

  rig.skeleton.update();
}

function expressionForAction(action: BlockCharacterAction): FaceExpression {
  if (action === 'working') return 'focus';
  if (action === 'active') return 'happy';
  if (action === 'dragging') return 'worried';
  return 'neutral';
}

function FaceBillboard({ expression, opacity }: { expression: FaceExpression; opacity: number }) {
  const texture = getFaceTexture(expression);
  if (!texture) return null;
  return (
    <mesh position={[0, 0, FACE_SPRITE_Z]}>
      <planeGeometry args={[FACE_SPRITE_SIZE, FACE_SPRITE_SIZE]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={opacity}
        alphaTest={0.04}
        side={DoubleSide}
        depthWrite={opacity >= 1}
      />
    </mesh>
  );
}

function JacketTrim({
  upperTorsoWidth,
  accentColor,
  opacity,
}: { upperTorsoWidth: number; accentColor: string; opacity: number }) {
  return (
    <>
      {[-1, 1].map((side) => (
        <mesh
          key={`lapel-${side}`}
          position={[side * upperTorsoWidth * 0.18, SHOULDER_Y + 0.04, 0.105]}
          rotation={[0, 0, side * 0.45]}
        >
          <planeGeometry args={[upperTorsoWidth * 0.32, 0.18]} />
          <meshStandardMaterial
            color={accentColor}
            roughness={0.7}
            side={DoubleSide}
            {...materialAlpha(opacity)}
          />
        </mesh>
      ))}
      {[-1, 1].map((side) => (
        <mesh
          key={`cuff-${side}`}
          position={[side * (upperTorsoWidth * 0.55), SHOULDER_Y - ARM_LENGTH + 0.06, 0]}
          castShadow
        >
          <boxGeometry args={[0.12, 0.05, 0.13]} />
          <meshStandardMaterial color={accentColor} roughness={0.68} {...materialAlpha(opacity)} />
        </mesh>
      ))}
    </>
  );
}

function ScarfWrap({
  upperTorsoWidth,
  accentColor,
  opacity,
}: { upperTorsoWidth: number; accentColor: string; opacity: number }) {
  return (
    <>
      <mesh position={[0, HEAD_LOCAL_Y - HEAD_SIZE / 2 - 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[upperTorsoWidth * 0.36, 0.04, 8, 18]} />
        <meshStandardMaterial color={accentColor} roughness={0.78} {...materialAlpha(opacity)} />
      </mesh>
      <mesh
        position={[upperTorsoWidth * 0.18, HEAD_LOCAL_Y - HEAD_SIZE / 2 - 0.22, 0.07]}
        rotation={[0, 0, -0.08]}
        castShadow
      >
        <planeGeometry args={[0.18, 0.36]} />
        <meshStandardMaterial
          color={accentColor}
          roughness={0.78}
          side={DoubleSide}
          {...materialAlpha(opacity)}
        />
      </mesh>
    </>
  );
}

function VestPanel({
  upperTorsoWidth,
  accentColor,
  opacity,
}: { upperTorsoWidth: number; accentColor: string; opacity: number }) {
  return (
    <mesh position={[0, SHOULDER_Y - UPPER_TORSO_HEIGHT * 0.1, 0.105]} castShadow>
      <boxGeometry args={[upperTorsoWidth * 0.7, UPPER_TORSO_HEIGHT + 0.04, 0.022]} />
      <meshStandardMaterial color={accentColor} roughness={0.65} {...materialAlpha(opacity)} />
    </mesh>
  );
}

function ShoulderChamfers({
  upperTorsoWidth,
  outfitColor,
  opacity,
}: { upperTorsoWidth: number; outfitColor: string; opacity: number }) {
  return (
    <>
      {[-1, 1].map((side) => (
        <mesh
          key={`shoulder-chamfer-${side}`}
          position={[side * upperTorsoWidth * 0.55, SHOULDER_Y + 0.04, 0]}
          rotation={[0, 0, side * 0.35]}
          castShadow
        >
          <boxGeometry args={[0.16, 0.1, 0.18]} />
          <meshStandardMaterial color={outfitColor} roughness={0.72} {...materialAlpha(opacity)} />
        </mesh>
      ))}
    </>
  );
}

function SkirtFlare({ outfitColor, opacity }: { outfitColor: string; opacity: number }) {
  return (
    <mesh position={[0, LOWER_TORSO_HEIGHT * 0.45, 0]} castShadow>
      <cylinderGeometry args={[0.16, 0.32, LOWER_TORSO_HEIGHT + 0.06, 12, 1, true]} />
      <meshStandardMaterial
        color={outfitColor}
        roughness={0.78}
        side={DoubleSide}
        {...materialAlpha(opacity)}
      />
    </mesh>
  );
}

function HairMesh({
  style,
  color,
  opacity,
}: { style: ResolvedAppearance['hairStyle']; color: string; opacity: number }) {
  if (style === 'bald') return null;
  const capY = HEAD_SIZE * 0.35;
  const cap =
    style === 'long' ? (
      <mesh position={[0, capY - 0.04, -0.02]} castShadow>
        <boxGeometry args={[HEAD_SIZE + 0.04, HEAD_SIZE * 1.1, HEAD_SIZE + 0.02]} />
        <meshStandardMaterial color={color} roughness={0.9} {...materialAlpha(opacity)} />
      </mesh>
    ) : style === 'bob' ? (
      <mesh position={[0, capY - 0.06, -0.01]} castShadow>
        <boxGeometry args={[HEAD_SIZE + 0.06, HEAD_SIZE * 0.6, HEAD_SIZE + 0.04]} />
        <meshStandardMaterial color={color} roughness={0.9} {...materialAlpha(opacity)} />
      </mesh>
    ) : (
      <mesh position={[0, capY, 0]} castShadow>
        <boxGeometry args={[HEAD_SIZE + 0.02, HEAD_SIZE * 0.42, HEAD_SIZE + 0.02]} />
        <meshStandardMaterial color={color} roughness={0.9} {...materialAlpha(opacity)} />
      </mesh>
    );

  if (style === 'ponytail') {
    return (
      <>
        {cap}
        <mesh
          position={[0, -HEAD_SIZE * 0.1, -HEAD_SIZE / 2 - 0.05]}
          rotation={[Math.PI / 2, 0, 0]}
          castShadow
        >
          <cylinderGeometry args={[0.045, 0.045, 0.34, 8]} />
          <meshStandardMaterial color={color} roughness={0.9} {...materialAlpha(opacity)} />
        </mesh>
      </>
    );
  }
  if (style === 'curly') {
    return (
      <>
        {cap}
        {(
          [
            [-0.12, capY + 0.06, -0.1],
            [0.12, capY + 0.06, -0.1],
            [-0.12, capY + 0.06, 0.1],
            [0.12, capY + 0.06, 0.1],
          ] as const
        ).map((position) => (
          <mesh
            key={position.join(':')}
            position={position as unknown as [number, number, number]}
            castShadow
          >
            <sphereGeometry args={[0.09, 8, 6]} />
            <meshStandardMaterial color={color} roughness={0.9} {...materialAlpha(opacity)} />
          </mesh>
        ))}
      </>
    );
  }
  if (style === 'spiky') {
    return (
      <>
        {cap}
        {(
          [
            [0, capY + 0.08, 0],
            [-0.12, capY + 0.06, -0.07],
            [0.12, capY + 0.06, -0.07],
            [-0.12, capY + 0.06, 0.07],
            [0.12, capY + 0.06, 0.07],
          ] as const
        ).map((position) => (
          <mesh
            key={position.join(':')}
            position={position as unknown as [number, number, number]}
            castShadow
          >
            <coneGeometry args={[0.05, 0.13, 6]} />
            <meshStandardMaterial color={color} roughness={0.9} {...materialAlpha(opacity)} />
          </mesh>
        ))}
      </>
    );
  }
  if (style === 'braids') {
    return (
      <>
        {cap}
        {[-0.22, 0.22].map((x) => (
          <mesh key={x} position={[x, -HEAD_SIZE * 0.1, 0]} castShadow>
            <cylinderGeometry args={[0.04, 0.04, 0.36, 8]} />
            <meshStandardMaterial color={color} roughness={0.9} {...materialAlpha(opacity)} />
          </mesh>
        ))}
      </>
    );
  }
  return <>{cap}</>;
}

interface BlockCharacterProps {
  appearance: ResolvedAppearance;
  action?: BlockCharacterAction;
  running?: boolean;
  /** Deterministic phase offset so idle bobs don't sync across the room. */
  phase?: number;
  opacity?: number;
}

function ActionHalo({ action, opacity }: { action: BlockCharacterAction; opacity: number }) {
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
        <meshBasicMaterial transparent opacity={opacity * 0.32} depthWrite={false} color={color} />
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

function WorkBeats({ action, opacity }: { action: BlockCharacterAction; opacity: number }) {
  if (action !== 'working' && action !== 'active') return null;
  const color = action === 'active' ? LIGHT_SCENE_3D.selectionRing : LIGHT_SCENE_3D.ledGreen;
  return (
    <group position={[0, 0.78, 0.23]}>
      {[-0.18, 0, 0.18].map((x, index) => (
        <mesh key={x} position={[x, index % 2 === 0 ? 0.03 : 0, 0]}>
          <boxGeometry args={[0.075, 0.018, 0.018]} />
          <meshBasicMaterial color={color} transparent opacity={opacity * 0.78} />
        </mesh>
      ))}
    </group>
  );
}

export function BlockCharacter({
  appearance,
  action,
  running = false,
  phase = 0,
  opacity = 1,
}: BlockCharacterProps) {
  const actionState: BlockCharacterAction = action ?? (running ? 'working' : 'idle');
  const rig = useMemo(createCharacterRig, []);
  const body = BODY_TYPE_FACTORS[appearance.bodyType];
  const gender = GENDER_FACTORS[appearance.gender];
  const upperTorsoWidth = 0.4 * body.torso * gender.shoulder;
  const lowerTorsoWidth = 0.38 * body.torso * gender.hip;
  const armWidth = 0.1 * body.arm;
  const legWidth = 0.13 * body.leg;
  const armX = upperTorsoWidth * 0.55;
  const hasAccent = appearance.accent.toLowerCase() !== appearance.clothing.toLowerCase();
  const expression = expressionForAction(actionState);

  useEffect(() => () => rig.skeleton.dispose(), [rig]);

  useFrame((state) => {
    applyCharacterPose(rig, actionState, state.clock.elapsedTime + phase);
  });

  return (
    <group>
      <ActionHalo action={actionState} opacity={opacity} />
      <WorkBeats action={actionState} opacity={opacity} />
      <primitive object={rig.root}>
        <primitive object={rig.leftLeg} position={[-0.11, HIP_Y, 0]}>
          <mesh position={[0, -LEG_LENGTH / 2, 0]} castShadow>
            <boxGeometry args={[legWidth, LEG_LENGTH, 0.13]} />
            <meshStandardMaterial
              color={appearance.clothing}
              roughness={0.75}
              {...materialAlpha(opacity)}
            />
          </mesh>
          <mesh position={[0, -LEG_LENGTH + 0.04, 0.04]} castShadow>
            <boxGeometry args={[legWidth * 1.18, 0.08, 0.2]} />
            <meshStandardMaterial
              color={SHOE_COLOR}
              roughness={0.5}
              metalness={0.1}
              {...materialAlpha(opacity)}
            />
          </mesh>
        </primitive>

        <primitive object={rig.rightLeg} position={[0.11, HIP_Y, 0]}>
          <mesh position={[0, -LEG_LENGTH / 2, 0]} castShadow>
            <boxGeometry args={[legWidth, LEG_LENGTH, 0.13]} />
            <meshStandardMaterial
              color={appearance.clothing}
              roughness={0.75}
              {...materialAlpha(opacity)}
            />
          </mesh>
          <mesh position={[0, -LEG_LENGTH + 0.04, 0.04]} castShadow>
            <boxGeometry args={[legWidth * 1.18, 0.08, 0.2]} />
            <meshStandardMaterial
              color={SHOE_COLOR}
              roughness={0.5}
              metalness={0.1}
              {...materialAlpha(opacity)}
            />
          </mesh>
        </primitive>

        <primitive object={rig.hips} position={[0, HIP_Y, 0]}>
          {gender.showSkirt ? (
            <SkirtFlare outfitColor={appearance.clothing} opacity={opacity} />
          ) : (
            <mesh position={[0, LOWER_TORSO_HEIGHT / 2, 0]} castShadow>
              <boxGeometry args={[lowerTorsoWidth + body.bellyExtra, LOWER_TORSO_HEIGHT, 0.22]} />
              <meshStandardMaterial
                color={appearance.clothing}
                roughness={0.72}
                {...materialAlpha(opacity)}
              />
            </mesh>
          )}

          <primitive object={rig.spine} position={[0, SPINE_Y, 0]}>
            <mesh position={[0, UPPER_TORSO_HEIGHT / 2, 0]} castShadow>
              <boxGeometry
                args={[upperTorsoWidth + body.bellyExtra, UPPER_TORSO_HEIGHT * gender.aspect, 0.22]}
              />
              <meshStandardMaterial
                color={appearance.clothing}
                roughness={0.7}
                {...materialAlpha(opacity)}
              />
            </mesh>

            {gender.shoulderChamfer && (
              <ShoulderChamfers
                upperTorsoWidth={upperTorsoWidth}
                outfitColor={appearance.clothing}
                opacity={opacity}
              />
            )}

            <mesh position={[0, SHOULDER_Y + UPPER_TORSO_HEIGHT * 0.34, 0.01]} castShadow>
              <boxGeometry args={[0.14 * body.torso, 0.1, 0.13]} />
              <meshStandardMaterial
                color={appearance.skin}
                roughness={0.42}
                {...materialAlpha(opacity)}
              />
            </mesh>

            {hasAccent && appearance.accentVariant === 'vest' && (
              <VestPanel
                upperTorsoWidth={upperTorsoWidth}
                accentColor={appearance.accent}
                opacity={opacity}
              />
            )}
            {hasAccent && appearance.accentVariant === 'jacket' && (
              <JacketTrim
                upperTorsoWidth={upperTorsoWidth}
                accentColor={appearance.accent}
                opacity={opacity}
              />
            )}
            {hasAccent && appearance.accentVariant === 'scarf' && (
              <ScarfWrap
                upperTorsoWidth={upperTorsoWidth}
                accentColor={appearance.accent}
                opacity={opacity}
              />
            )}

            <primitive object={rig.leftArm} position={[-armX, SHOULDER_Y, 0]}>
              <mesh position={[0, -ARM_LENGTH / 2, 0]} castShadow>
                <boxGeometry args={[armWidth, ARM_LENGTH, 0.11]} />
                <meshStandardMaterial
                  color={appearance.clothing}
                  roughness={0.74}
                  {...materialAlpha(opacity)}
                />
              </mesh>
              <mesh position={[0, -ARM_LENGTH - 0.04, 0.02]} castShadow>
                <boxGeometry args={[armWidth * 1.15, 0.09, 0.12]} />
                <meshStandardMaterial
                  color={appearance.skin}
                  roughness={0.45}
                  {...materialAlpha(opacity)}
                />
              </mesh>
            </primitive>

            <primitive object={rig.rightArm} position={[armX, SHOULDER_Y, 0]}>
              <mesh position={[0, -ARM_LENGTH / 2, 0]} castShadow>
                <boxGeometry args={[armWidth, ARM_LENGTH, 0.11]} />
                <meshStandardMaterial
                  color={appearance.clothing}
                  roughness={0.74}
                  {...materialAlpha(opacity)}
                />
              </mesh>
              <mesh position={[0, -ARM_LENGTH - 0.04, 0.02]} castShadow>
                <boxGeometry args={[armWidth * 1.15, 0.09, 0.12]} />
                <meshStandardMaterial
                  color={appearance.skin}
                  roughness={0.45}
                  {...materialAlpha(opacity)}
                />
              </mesh>
            </primitive>

            <primitive object={rig.head} position={[0, HEAD_LOCAL_Y, 0]}>
              <mesh castShadow>
                <boxGeometry args={[HEAD_SIZE * body.head, HEAD_SIZE, HEAD_SIZE * 0.9]} />
                <meshStandardMaterial
                  color={appearance.skin}
                  roughness={0.42}
                  {...materialAlpha(opacity)}
                />
              </mesh>
              <HairMesh style={appearance.hairStyle} color={appearance.hair} opacity={opacity} />
              <FaceBillboard expression={expression} opacity={opacity} />
            </primitive>
          </primitive>
        </primitive>
      </primitive>
    </group>
  );
}
