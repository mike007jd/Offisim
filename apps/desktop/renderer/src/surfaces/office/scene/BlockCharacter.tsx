import type { ResolvedAppearance } from '@/lib/avatar.js';
import type { CharacterPerformanceState } from '@offisim/shared-types';
import { RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Bone, DoubleSide, type Mesh, type MeshBasicMaterial, Skeleton } from 'three';
import { type FaceExpression, getFaceTexture } from './character-face-texture.js';
import { LIGHT_SCENE_3D } from './r3d/scene-colors.js';

/**
 * Chibi "block person" v2 — rounded silhouette (RoundedBox limbs/torso/head),
 * neck + hands, fitted hair with a forehead fringe, and a readable pose system:
 * standing/sitting postures, typing at a desk, a swivel-and-wave "active" state,
 * periodic blinking, and an animated typing indicator. Body type / gender /
 * hair style / accent variant still shape the silhouette from ResolvedAppearance.
 */

const SHOE_COLOR = LIGHT_SCENE_3D.characterShoe;

// Chibi proportions: head ~30% of total height.
const LEG_LENGTH = 0.42;
const LOWER_TORSO_HEIGHT = 0.24;
const UPPER_TORSO_HEIGHT = 0.34;
const HEAD_SIZE = 0.44;
const HIP_Y = LEG_LENGTH;
const SPINE_Y = LOWER_TORSO_HEIGHT;
const SHOULDER_Y = UPPER_TORSO_HEIGHT * 0.74;
const NECK_HEIGHT = 0.05;
const HEAD_LOCAL_Y = UPPER_TORSO_HEIGHT + NECK_HEIGHT + HEAD_SIZE / 2;
const ARM_LENGTH = 0.36;
const FACE_SPRITE_SIZE = HEAD_SIZE * 0.8;
const FACE_SPRITE_Z = HEAD_SIZE / 2 + 0.004;
/** Root lift that parks the hips on a workstation chair seat (~0.60 local). */
const SIT_LIFT = 0.21;

function materialAlpha(opacity: number) {
  return opacity < 1 ? { transparent: true, opacity, depthWrite: false } : {};
}

const BODY_TYPE_FACTORS = {
  slim: { torso: 0.78, arm: 0.8, leg: 0.95, head: 0.98, bellyExtra: 0 },
  normal: { torso: 1.0, arm: 1.0, leg: 1.0, head: 1.0, bellyExtra: 0 },
  stocky: { torso: 1.34, arm: 1.2, leg: 1.05, head: 1.05, bellyExtra: 0.1 },
} as const;

const GENDER_FACTORS = {
  masculine: { shoulder: 1.12, hip: 0.92, aspect: 1.0, showSkirt: false },
  feminine: { shoulder: 0.84, hip: 1.16, aspect: 0.95, showSkirt: true },
  neutral: { shoulder: 1.0, hip: 1.0, aspect: 1.0, showSkirt: false },
} as const;

export type BlockCharacterAction = 'idle' | 'working' | 'active' | 'dragging';
export type BlockCharacterPosture = 'standing' | 'sitting';

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

function applySittingLegs(rig: CharacterRig, t: number): void {
  // Thighs forward (toward the model's +z facing), feet swinging gently.
  rig.leftLeg.rotation.set(-1.42 + Math.sin(t * 1.3) * 0.05, 0.08, 0.06);
  rig.rightLeg.rotation.set(-1.42 - Math.sin(t * 1.3 + 1.1) * 0.05, -0.08, -0.06);
}

function applyCharacterPose(
  rig: CharacterRig,
  action: BlockCharacterAction,
  posture: BlockCharacterPosture,
  t: number,
): void {
  const slow = Math.sin(t * 1.5);
  const medium = Math.sin(t * 2.6);
  const fast = Math.sin(t * 8.6);
  const sitting = posture === 'sitting' && action !== 'dragging';
  const baseY = sitting ? SIT_LIFT : 0;

  // Neutral base each frame — only the channels some branch leaves untouched
  // (every branch fully sets spine, head, and both arms itself).
  rig.root.position.set(0, baseY, 0);
  rig.root.rotation.set(0, 0, 0);
  rig.hips.rotation.set(0, 0, 0);
  rig.leftLeg.rotation.set(0, 0, 0.03);
  rig.rightLeg.rotation.set(0, 0, -0.03);

  if (action === 'idle') {
    if (sitting) {
      applySittingLegs(rig, t);
      rig.root.position.y = baseY + Math.sin(t * 1.5) * 0.012;
      rig.spine.rotation.set(-0.06 + medium * 0.02, 0, slow * 0.02);
      rig.head.rotation.set(0.04 + slow * 0.05, Math.sin(t * 0.42) * 0.38, 0);
      rig.leftArm.rotation.set(-0.78, 0.18, -0.1);
      rig.rightArm.rotation.set(-0.78, -0.18, 0.1);
    } else {
      rig.root.position.y = baseY + Math.sin(t * 1.5) * 0.02;
      rig.hips.rotation.set(0, 0, Math.sin(t * 0.55) * 0.06);
      rig.spine.rotation.set(-0.02 + medium * 0.02, 0, -Math.sin(t * 0.55) * 0.05);
      rig.head.rotation.set(0.03 + slow * 0.04, Math.sin(t * 0.38) * 0.42, -slow * 0.02);
      rig.leftArm.rotation.set(-0.12 + slow * 0.04, 0, -0.14);
      rig.rightArm.rotation.set(-0.12 - slow * 0.04, 0, 0.14);
    }
    return;
  }

  if (action === 'working') {
    if (sitting) {
      applySittingLegs(rig, t);
      rig.root.position.y = baseY + Math.sin(t * 3.4) * 0.01;
      rig.spine.rotation.set(-0.2 + medium * 0.015, 0, 0);
      rig.head.rotation.set(0.26 + slow * 0.03, medium * 0.06, 0);
      rig.leftArm.rotation.set(-1.12 + fast * 0.16, 0.16, -0.1 + medium * 0.03);
      rig.rightArm.rotation.set(-1.12 - fast * 0.16, -0.16, 0.1 - medium * 0.03);
    } else {
      rig.root.position.y = baseY + Math.sin(t * 2.4) * 0.022;
      rig.spine.rotation.set(-0.1 + medium * 0.03, Math.sin(t * 0.8) * 0.08, 0);
      rig.head.rotation.set(0.12 + slow * 0.05, Math.sin(t * 0.9) * 0.18, 0);
      rig.leftArm.rotation.set(-0.7 + Math.sin(t * 2.2) * 0.28, 0.2, -0.3);
      rig.rightArm.rotation.set(-1.0 - Math.sin(t * 2.2 + 0.9) * 0.3, -0.2, 0.32);
    }
    return;
  }

  if (action === 'active') {
    const wave = Math.sin(t * 7.2);
    if (sitting) {
      applySittingLegs(rig, t);
      rig.root.rotation.set(0, Math.PI + Math.sin(t * 1.1) * 0.06, 0);
      rig.root.position.y = baseY + Math.sin(t * 2.4) * 0.015;
    } else {
      rig.root.position.y = baseY + 0.02 + Math.abs(Math.sin(t * 3.2)) * 0.045;
      rig.root.rotation.set(0, Math.sin(t * 1.1) * 0.08, 0);
    }
    rig.spine.rotation.set(-0.04, 0, -0.04);
    rig.head.rotation.set(-0.06 + slow * 0.03, Math.sin(t * 0.9) * 0.1, 0.05);
    rig.leftArm.rotation.set(-0.32, 0, -0.2);
    rig.rightArm.rotation.set(-2.5, 0, 0.5 + wave * 0.3);
    return;
  }

  // dragging — picked up and flailing.
  rig.root.position.y = 0.05 + Math.abs(Math.sin(t * 7)) * 0.07;
  rig.root.rotation.set(0, Math.sin(t * 3) * 0.16, 0);
  rig.hips.rotation.set(0, 0, fast * 0.1);
  rig.spine.rotation.set(-0.06 + medium * 0.1, 0, -fast * 0.05);
  rig.head.rotation.set(0.08, medium * 0.1, fast * 0.04);
  rig.leftArm.rotation.set(-1.3 + fast * 0.22, 0.18, -0.7);
  rig.rightArm.rotation.set(-1.3 - fast * 0.22, -0.18, 0.7);
  rig.leftLeg.rotation.set(fast * 0.42, 0, 0.1);
  rig.rightLeg.rotation.set(-fast * 0.42, 0, -0.1);
}

function expressionForAction(action: BlockCharacterAction): FaceExpression {
  if (action === 'working') return 'focus';
  if (action === 'active') return 'happy';
  if (action === 'dragging') return 'worried';
  return 'neutral';
}

/** Walking legs — alternating stride, used when locomotion is `walk`. */
function applyWalkingLegs(rig: CharacterRig, t: number): void {
  const stride = Math.sin(t * 6.4);
  rig.leftLeg.rotation.set(stride * 0.5, 0, 0.04);
  rig.rightLeg.rotation.set(-stride * 0.5, 0, -0.04);
}

/**
 * Render a layered {@link CharacterPerformanceState} onto the rig. Locomotion,
 * posture, work gesture and social gesture compose, so the V1 fragment set
 * (idle / walk / sit / stand / type / read / note / inspect-terminal /
 * write-board / point / annotate / handoff / listen / nod / discuss / wait /
 * blocked / celebrate) is reachable from a small number of channels — and the
 * 2D and 3D scenes drive it from the same state.
 */
function applyPerformancePose(rig: CharacterRig, perf: CharacterPerformanceState, t: number): void {
  const slow = Math.sin(t * 1.5);
  const medium = Math.sin(t * 2.6);
  const fast = Math.sin(t * 8.6);
  const sitting = perf.posture === 'sit';
  const baseY = sitting ? SIT_LIFT : 0;
  const tempo = 0.6 + perf.intensity * 0.45;

  rig.root.position.set(0, baseY, 0);
  rig.root.rotation.set(0, 0, 0);
  rig.hips.rotation.set(0, 0, 0);
  rig.leftLeg.rotation.set(0, 0, 0.03);
  rig.rightLeg.rotation.set(0, 0, -0.03);

  if (perf.locomotion === 'walk') {
    applyWalkingLegs(rig, t);
    rig.root.position.y = baseY + Math.abs(Math.sin(t * 6.4)) * 0.03;
    rig.spine.rotation.set(0.04, 0, 0);
    rig.head.rotation.set(0.02 + slow * 0.03, Math.sin(t * 0.6) * 0.12, 0);
    rig.leftArm.rotation.set(Math.sin(t * 6.4) * 0.4, 0, -0.12);
    rig.rightArm.rotation.set(-Math.sin(t * 6.4) * 0.4, 0, 0.12);
    return;
  }

  if (sitting) applySittingLegs(rig, t);

  // Base posture (overridden per work gesture below).
  rig.root.position.y = baseY + slow * (sitting ? 0.012 : 0.02);
  rig.spine.rotation.set(sitting ? -0.06 + medium * 0.02 : -0.02 + medium * 0.02, 0, 0);
  rig.head.rotation.set(0.04 + slow * 0.05, Math.sin(t * 0.42) * 0.3, 0);
  rig.leftArm.rotation.set(sitting ? -0.78 : -0.12, 0.16, -0.12);
  rig.rightArm.rotation.set(sitting ? -0.78 : -0.12, -0.16, 0.12);

  switch (perf.workGesture) {
    case 'type':
      rig.spine.rotation.set(-0.2 + medium * 0.015, 0, 0);
      rig.head.rotation.set(0.26 + slow * 0.03, medium * 0.06, 0);
      rig.leftArm.rotation.set(-1.12 + fast * 0.16 * tempo, 0.16, -0.1 + medium * 0.03);
      rig.rightArm.rotation.set(-1.12 - fast * 0.16 * tempo, -0.16, 0.1 - medium * 0.03);
      break;
    case 'read':
      // Hold a document up, head tilted down to it.
      rig.spine.rotation.set(-0.12, 0, 0);
      rig.head.rotation.set(0.34 + slow * 0.03, 0, 0);
      rig.leftArm.rotation.set(-1.32 + slow * 0.03, 0.34, -0.18);
      rig.rightArm.rotation.set(-1.32 - slow * 0.03, -0.34, 0.18);
      break;
    case 'note':
      // One hand writing on a pad held by the other.
      rig.spine.rotation.set(-0.16, 0.06, 0);
      rig.head.rotation.set(0.3, 0.05, 0);
      rig.leftArm.rotation.set(-1.2, 0.3, -0.1);
      rig.rightArm.rotation.set(-1.05 + fast * 0.12 * tempo, -0.2, 0.18);
      break;
    case 'inspect-terminal':
      // Lean toward a screen/rack, one hand pointing at it.
      rig.spine.rotation.set(-0.12 + medium * 0.02, 0.08, 0);
      rig.head.rotation.set(0.18 + slow * 0.04, 0.12, 0);
      rig.leftArm.rotation.set(-0.4, 0.1, -0.18);
      rig.rightArm.rotation.set(-1.35 + Math.sin(t * 1.8) * 0.1, -0.34, 0.2);
      break;
    case 'write-board':
      // Reach up to a board, hand drawing.
      rig.spine.rotation.set(-0.06, Math.sin(t * 0.8) * 0.06, 0);
      rig.head.rotation.set(0.08 + slow * 0.04, 0.16, 0);
      rig.leftArm.rotation.set(-0.5, 0.18, -0.24);
      rig.rightArm.rotation.set(-2.3 + Math.sin(t * 2.6) * 0.18 * tempo, -0.1, 0.3);
      break;
    case 'point':
      // Present / celebrate — arm extended toward the room.
      rig.spine.rotation.set(-0.04, 0, -0.03);
      rig.head.rotation.set(-0.02 + slow * 0.03, Math.sin(t * 0.9) * 0.12, 0);
      rig.leftArm.rotation.set(-0.3, 0, -0.2);
      rig.rightArm.rotation.set(-1.5 + Math.sin(t * 2.4) * 0.12, -0.2, 0.6);
      break;
    case 'annotate':
      // Standing review — mark/gesture at a shared surface.
      rig.spine.rotation.set(-0.1 + medium * 0.03, Math.sin(t * 0.8) * 0.08, 0);
      rig.head.rotation.set(0.12 + slow * 0.05, Math.sin(t * 0.9) * 0.18, 0);
      rig.leftArm.rotation.set(-0.7 + Math.sin(t * 2.2) * 0.2, 0.2, -0.3);
      rig.rightArm.rotation.set(-1.2 - Math.sin(t * 2.2 + 0.9) * 0.22, -0.2, 0.34);
      break;
    case 'handoff':
      // Offer a deliverable forward with both hands.
      rig.spine.rotation.set(-0.08, 0, 0);
      rig.head.rotation.set(0.06 + slow * 0.03, 0, 0);
      rig.leftArm.rotation.set(-1.1 + slow * 0.03, 0.28, -0.12);
      rig.rightArm.rotation.set(-1.1 - slow * 0.03, -0.28, 0.12);
      break;
    default:
      // 'none' — resting arms set by the base above; add a little life.
      if (!sitting) {
        rig.hips.rotation.set(0, 0, Math.sin(t * 0.55) * 0.06);
        rig.head.rotation.set(0.03 + slow * 0.04, Math.sin(t * 0.38) * 0.42, -slow * 0.02);
        rig.leftArm.rotation.set(-0.12 + slow * 0.04, 0, -0.14);
        rig.rightArm.rotation.set(-0.12 - slow * 0.04, 0, 0.14);
      }
      break;
  }

  // Social overlay (head/torso) layered on top of the work gesture.
  if (perf.socialGesture === 'nod') {
    rig.head.rotation.x += 0.12 + Math.abs(Math.sin(t * 3.2)) * 0.14;
  } else if (perf.socialGesture === 'listen') {
    rig.head.rotation.z += 0.16;
    rig.head.rotation.y += Math.sin(t * 0.5) * 0.06;
  } else if (perf.socialGesture === 'discuss') {
    rig.head.rotation.y += Math.sin(t * 1.4) * 0.18;
    rig.spine.rotation.y += Math.sin(t * 1.1) * 0.05;
  }
}

function faceExpressionForPerformance(perf: CharacterPerformanceState): FaceExpression {
  switch (perf.expression) {
    case 'happy':
      return 'happy';
    case 'worried':
      return 'worried';
    case 'focus':
    case 'thinking':
      return 'focus';
    default:
      return 'neutral';
  }
}

/** Face decal with periodic blinking (texture swap, no React state). */
function FaceBillboard({
  expression,
  opacity,
  phase,
}: { expression: FaceExpression; opacity: number; phase: number }) {
  const materialRef = useRef<MeshBasicMaterial>(null);
  const appliedRef = useRef<FaceExpression | null>(null);
  const texture = getFaceTexture(expression);
  const canBlink = expression === 'neutral' || expression === 'focus';

  useFrame((state) => {
    const material = materialRef.current;
    if (!material) return;
    const t = state.clock.elapsedTime + phase * 1.7;
    const blinking = canBlink && t % 4.4 < 0.14;
    const next: FaceExpression = blinking ? 'blink' : expression;
    if (appliedRef.current === next) return;
    const nextTexture = getFaceTexture(next);
    if (!nextTexture) return;
    material.map = nextTexture;
    appliedRef.current = next;
  });

  if (!texture) return null;
  return (
    <mesh position={[0, 0, FACE_SPRITE_Z]}>
      <planeGeometry args={[FACE_SPRITE_SIZE, FACE_SPRITE_SIZE]} />
      <meshBasicMaterial
        ref={materialRef}
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

function ScarfWrap({
  upperTorsoWidth,
  accentColor,
  opacity,
}: { upperTorsoWidth: number; accentColor: string; opacity: number }) {
  return (
    <>
      <mesh position={[0, UPPER_TORSO_HEIGHT - 0.015, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[upperTorsoWidth * 0.38, 0.05, 8, 18]} />
        <meshStandardMaterial color={accentColor} roughness={0.78} {...materialAlpha(opacity)} />
      </mesh>
      <RoundedBox
        args={[0.16, 0.3, 0.05]}
        radius={0.02}
        smoothness={3}
        position={[upperTorsoWidth * 0.18, UPPER_TORSO_HEIGHT - 0.22, 0.14]}
        rotation={[0, 0, -0.08]}
        castShadow
      >
        <meshStandardMaterial color={accentColor} roughness={0.78} {...materialAlpha(opacity)} />
      </RoundedBox>
    </>
  );
}

function VestPanel({
  upperTorsoWidth,
  accentColor,
  opacity,
}: { upperTorsoWidth: number; accentColor: string; opacity: number }) {
  return (
    <RoundedBox
      args={[upperTorsoWidth * 0.74, UPPER_TORSO_HEIGHT + 0.02, 0.05]}
      radius={0.02}
      smoothness={3}
      position={[0, UPPER_TORSO_HEIGHT * 0.48, 0.125]}
      castShadow
    >
      <meshStandardMaterial color={accentColor} roughness={0.65} {...materialAlpha(opacity)} />
    </RoundedBox>
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
          position={[side * upperTorsoWidth * 0.2, UPPER_TORSO_HEIGHT * 0.78, 0.145]}
          rotation={[0, 0, side * 0.5]}
        >
          <planeGeometry args={[upperTorsoWidth * 0.34, 0.16]} />
          <meshStandardMaterial
            color={accentColor}
            roughness={0.7}
            side={DoubleSide}
            {...materialAlpha(opacity)}
          />
        </mesh>
      ))}
    </>
  );
}

function SkirtFlare({ outfitColor, opacity }: { outfitColor: string; opacity: number }) {
  return (
    <mesh position={[0, LOWER_TORSO_HEIGHT * 0.45, 0]} castShadow>
      <cylinderGeometry args={[0.17, 0.33, LOWER_TORSO_HEIGHT + 0.08, 14, 1, true]} />
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
  const capY = HEAD_SIZE * 0.3;
  const backZ = -HEAD_SIZE / 2 - 0.03;
  const hairMaterial = (
    <meshStandardMaterial color={color} roughness={0.88} {...materialAlpha(opacity)} />
  );
  // Crown hugs the skull; fringe band keeps hair visible from the front.
  const crown = (
    <mesh position={[0, capY + 0.05, -0.02]} scale={[1.08, 0.52, 1.04]} castShadow>
      <sphereGeometry args={[HEAD_SIZE * 0.52, 16, 12]} />
      {hairMaterial}
    </mesh>
  );
  const fringe = (
    <RoundedBox
      args={[HEAD_SIZE * 0.92, 0.09, 0.08]}
      radius={0.03}
      smoothness={3}
      position={[0, HEAD_SIZE * 0.34, HEAD_SIZE / 2 - 0.015]}
      castShadow
    >
      {hairMaterial}
    </RoundedBox>
  );

  if (style === 'long') {
    return (
      <>
        {crown}
        {fringe}
        <RoundedBox
          args={[HEAD_SIZE * 0.96, HEAD_SIZE * 1.1, 0.14]}
          radius={0.05}
          smoothness={3}
          position={[0, -HEAD_SIZE * 0.12, backZ - 0.04]}
          castShadow
        >
          {hairMaterial}
        </RoundedBox>
      </>
    );
  }
  if (style === 'bob') {
    return (
      <>
        {crown}
        {fringe}
        {[-1, 1].map((side) => (
          <RoundedBox
            key={`bob-side-${side}`}
            args={[0.12, HEAD_SIZE * 0.74, HEAD_SIZE * 0.62]}
            radius={0.045}
            smoothness={3}
            position={[side * HEAD_SIZE * 0.52, capY - HEAD_SIZE * 0.18, -0.05]}
            castShadow
          >
            {hairMaterial}
          </RoundedBox>
        ))}
      </>
    );
  }
  if (style === 'ponytail') {
    return (
      <>
        {crown}
        {fringe}
        <mesh position={[0, capY + 0.02, backZ - 0.05]} rotation={[0.5, 0, 0]} castShadow>
          <cylinderGeometry args={[0.06, 0.04, 0.36, 10]} />
          {hairMaterial}
        </mesh>
        <mesh position={[0, capY - 0.16, backZ - 0.14]} castShadow>
          <sphereGeometry args={[0.08, 10, 8]} />
          {hairMaterial}
        </mesh>
      </>
    );
  }
  if (style === 'curly') {
    return (
      <>
        {crown}
        {(
          [
            [-0.14, capY + 0.1, -0.12],
            [0.14, capY + 0.1, -0.12],
            [-0.15, capY + 0.08, 0.1],
            [0.15, capY + 0.08, 0.1],
            [0, capY + 0.15, 0],
          ] as const
        ).map((position) => (
          <mesh
            key={position.join(':')}
            position={position as unknown as [number, number, number]}
            castShadow
          >
            <sphereGeometry args={[0.1, 10, 8]} />
            {hairMaterial}
          </mesh>
        ))}
      </>
    );
  }
  if (style === 'spiky') {
    return (
      <>
        {crown}
        {(
          [
            [0, capY + 0.15, 0],
            [-0.13, capY + 0.12, -0.08],
            [0.13, capY + 0.12, -0.08],
            [-0.12, capY + 0.11, 0.09],
            [0.12, capY + 0.11, 0.09],
          ] as const
        ).map((position) => (
          <mesh
            key={position.join(':')}
            position={position as unknown as [number, number, number]}
            rotation={[0.12, 0, 0]}
            castShadow
          >
            <coneGeometry args={[0.055, 0.16, 6]} />
            {hairMaterial}
          </mesh>
        ))}
      </>
    );
  }
  if (style === 'braids') {
    return (
      <>
        {crown}
        {fringe}
        {[-1, 1].map((side) => (
          <group
            key={side}
            position={[side * HEAD_SIZE * 0.5, -HEAD_SIZE * 0.1, backZ + 0.06]}
            rotation={[0, 0, side * 0.1]}
          >
            <mesh castShadow>
              <cylinderGeometry args={[0.045, 0.035, 0.34, 8]} />
              {hairMaterial}
            </mesh>
            <mesh position={[0, -0.2, 0]} castShadow>
              <sphereGeometry args={[0.05, 8, 6]} />
              {hairMaterial}
            </mesh>
          </group>
        ))}
      </>
    );
  }
  return (
    <>
      {crown}
      {fringe}
    </>
  );
}

interface BlockCharacterProps {
  appearance: ResolvedAppearance;
  action?: BlockCharacterAction;
  posture?: BlockCharacterPosture;
  running?: boolean;
  /**
   * Accessibility: when true the character holds a STATIC resting pose — no idle
   * bob, typing sway, gesture loop, celebration jump, or walk. Status color,
   * face expression, label, approval, and error info are preserved (they are not
   * vestibular motion). Relocation is separately suppressed upstream (modes.ts).
   */
  reducedMotion?: boolean;
  /**
   * Layered dramaturgy performance (Phase 3+). When provided it drives the body
   * pose / face; when absent the pose is derived from the legacy `action` enum
   * so existing call sites are unchanged. The `action` enum still drives the UI
   * indicators (selection halo, working dots).
   */
  performance?: CharacterPerformanceState;
  /** Per-frame relocation flag (set by the scene's lerp) → walk locomotion while
   *  in transit, then the destination performance once arrived. */
  walkingRef?: { readonly current: boolean };
  /** Performance-profile tempo (employee flavor); scales animation speed only. */
  tempo?: number;
  /** Deterministic phase offset so idle bobs don't sync across the room. */
  phase?: number;
  opacity?: number;
}

/**
 * Ground halo for the non-idle action states — shared by BlockCharacter and
 * GltfCharacter (one indicator language for every character renderer).
 * NOTE: BlockCharacter is scheduled for replacement by GltfCharacter; when it
 * goes, ActionHalo/TypingDots MOVE to the `character/` dir with it.
 */
export function ActionHalo({ action, opacity }: { action: BlockCharacterAction; opacity: number }) {
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
 * `y` is the head-clearance height (scene units): each character renderer
 * passes its own silhouette's value. Shared with GltfCharacter (see the
 * ActionHalo note about the planned move to `character/`).
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

export function BlockCharacter({
  appearance,
  action,
  posture = 'standing',
  running = false,
  reducedMotion = false,
  performance,
  walkingRef,
  tempo = 1,
  phase = 0,
  opacity = 1,
}: BlockCharacterProps) {
  const actionState: BlockCharacterAction = action ?? (running ? 'working' : 'idle');
  // Layered performance drives the body pose + face when supplied (Phase 4
  // beats); otherwise the legacy action enum drives the original poses
  // unchanged. Dragging is always the legacy path (a UI state, not a beat).
  const usePerformance = performance !== undefined && actionState !== 'dragging';
  const rig = useMemo(createCharacterRig, []);
  const body = BODY_TYPE_FACTORS[appearance.bodyType];
  const gender = GENDER_FACTORS[appearance.gender];
  const upperTorsoWidth = 0.42 * body.torso * gender.shoulder;
  const lowerTorsoWidth = 0.38 * body.torso * gender.hip;
  const armWidth = 0.11 * body.arm;
  const legWidth = 0.135 * body.leg;
  const armX = upperTorsoWidth * 0.56 + armWidth * 0.4;
  const hasAccent = appearance.accent.toLowerCase() !== appearance.clothing.toLowerCase();
  const expression =
    usePerformance && performance
      ? faceExpressionForPerformance(performance)
      : expressionForAction(actionState);

  useEffect(() => () => rig.skeleton.dispose(), [rig]);

  useFrame((state) => {
    // Reduced motion: freeze time so every Math.sin(t·…) oscillator collapses to
    // its resting value — a static pose with no bob / typing sway / gesture loop /
    // celebration jump, and no walk. The pose still reflects the current
    // performance/action (status), just without continuous motion.
    const baseT = reducedMotion ? 0 : state.clock.elapsedTime + phase;
    if (usePerformance && performance) {
      // Tempo (employee performance profile) scales animation speed only; baseT is
      // already 0 under reducedMotion, so t collapses to a static pose.
      const t = baseT * tempo;
      const walking = reducedMotion ? false : (walkingRef?.current ?? false);
      applyPerformancePose(rig, walking ? { ...performance, locomotion: 'walk' } : performance, t);
    } else {
      applyCharacterPose(rig, actionState, posture, baseT);
    }
  });

  return (
    <group>
      <ActionHalo action={actionState} opacity={opacity} />
      {actionState === 'working' ? (
        <TypingDots
          phase={phase}
          opacity={opacity}
          y={posture === 'sitting' ? 1.96 : 1.78}
          reducedMotion={reducedMotion}
        />
      ) : null}
      <primitive object={rig.root}>
        {([-1, 1] as const).map((side) => (
          <primitive
            key={`leg-${side}`}
            object={side === -1 ? rig.leftLeg : rig.rightLeg}
            position={[side * 0.115, HIP_Y, 0]}
          >
            <RoundedBox
              args={[legWidth, LEG_LENGTH, 0.16]}
              radius={0.045}
              smoothness={3}
              position={[0, -LEG_LENGTH / 2, 0]}
              castShadow
            >
              <meshStandardMaterial
                color={appearance.clothing}
                roughness={0.75}
                {...materialAlpha(opacity)}
              />
            </RoundedBox>
            <RoundedBox
              args={[legWidth * 1.25, 0.09, 0.25]}
              radius={0.032}
              smoothness={3}
              position={[0, -LEG_LENGTH + 0.035, 0.05]}
              castShadow
            >
              <meshStandardMaterial
                color={SHOE_COLOR}
                roughness={0.5}
                metalness={0.1}
                {...materialAlpha(opacity)}
              />
            </RoundedBox>
          </primitive>
        ))}

        <primitive object={rig.hips} position={[0, HIP_Y, 0]}>
          {gender.showSkirt ? (
            <SkirtFlare outfitColor={appearance.clothing} opacity={opacity} />
          ) : (
            <RoundedBox
              args={[lowerTorsoWidth + body.bellyExtra, LOWER_TORSO_HEIGHT, 0.25]}
              radius={0.06}
              smoothness={3}
              position={[0, LOWER_TORSO_HEIGHT / 2, 0]}
              castShadow
            >
              <meshStandardMaterial
                color={appearance.clothing}
                roughness={0.72}
                {...materialAlpha(opacity)}
              />
            </RoundedBox>
          )}

          <primitive object={rig.spine} position={[0, SPINE_Y, 0]}>
            <RoundedBox
              args={[
                upperTorsoWidth + body.bellyExtra,
                UPPER_TORSO_HEIGHT * gender.aspect + 0.04,
                0.27,
              ]}
              radius={0.08}
              smoothness={4}
              position={[0, UPPER_TORSO_HEIGHT / 2, 0]}
              castShadow
            >
              <meshStandardMaterial
                color={appearance.clothing}
                roughness={0.7}
                {...materialAlpha(opacity)}
              />
            </RoundedBox>

            {/* Neck */}
            <mesh position={[0, UPPER_TORSO_HEIGHT + NECK_HEIGHT / 2 - 0.01, 0]} castShadow>
              <cylinderGeometry args={[0.075, 0.085, NECK_HEIGHT + 0.04, 12]} />
              <meshStandardMaterial
                color={appearance.skin}
                roughness={0.45}
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

            {([-1, 1] as const).map((side) => (
              <primitive
                key={`arm-${side}`}
                object={side === -1 ? rig.leftArm : rig.rightArm}
                position={[side * armX, SHOULDER_Y, 0]}
              >
                <RoundedBox
                  args={[armWidth, ARM_LENGTH, 0.13]}
                  radius={0.045}
                  smoothness={3}
                  position={[0, -ARM_LENGTH / 2, 0]}
                  castShadow
                >
                  <meshStandardMaterial
                    color={appearance.clothing}
                    roughness={0.74}
                    {...materialAlpha(opacity)}
                  />
                </RoundedBox>
                <mesh position={[0, -ARM_LENGTH - 0.035, 0.01]} castShadow>
                  <sphereGeometry args={[0.062, 12, 10]} />
                  <meshStandardMaterial
                    color={appearance.skin}
                    roughness={0.45}
                    {...materialAlpha(opacity)}
                  />
                </mesh>
              </primitive>
            ))}

            <primitive object={rig.head} position={[0, HEAD_LOCAL_Y, 0]}>
              <RoundedBox
                args={[HEAD_SIZE * body.head, HEAD_SIZE, HEAD_SIZE * 0.92]}
                radius={0.13}
                smoothness={4}
                castShadow
              >
                <meshStandardMaterial
                  color={appearance.skin}
                  roughness={0.42}
                  {...materialAlpha(opacity)}
                />
              </RoundedBox>
              {/* Ears */}
              {[-1, 1].map((side) => (
                <mesh
                  key={`ear-${side}`}
                  position={[side * HEAD_SIZE * body.head * 0.5, -0.01, 0]}
                  castShadow
                >
                  <sphereGeometry args={[0.05, 8, 8]} />
                  <meshStandardMaterial
                    color={appearance.skin}
                    roughness={0.45}
                    {...materialAlpha(opacity)}
                  />
                </mesh>
              ))}
              <HairMesh style={appearance.hairStyle} color={appearance.hair} opacity={opacity} />
              <FaceBillboard expression={expression} opacity={opacity} phase={phase} />
            </primitive>
          </primitive>
        </primitive>
      </primitive>
    </group>
  );
}
