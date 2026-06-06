import type { ResolvedAppearance } from '@/lib/avatar.js';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { DoubleSide, type Group } from 'three';
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
const HEAD_Y = LEG_LENGTH + LOWER_TORSO_HEIGHT + UPPER_TORSO_HEIGHT + HEAD_SIZE / 2 + 0.04;
const SHOULDER_Y = LEG_LENGTH + LOWER_TORSO_HEIGHT + UPPER_TORSO_HEIGHT * 0.72;
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

function FaceBillboard({ expression, opacity }: { expression: FaceExpression; opacity: number }) {
  const texture = getFaceTexture(expression);
  if (!texture) return null;
  return (
    <mesh position={[0, HEAD_Y, FACE_SPRITE_Z]}>
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
      <mesh position={[0, HEAD_Y - HEAD_SIZE / 2 - 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[upperTorsoWidth * 0.36, 0.04, 8, 18]} />
        <meshStandardMaterial color={accentColor} roughness={0.78} {...materialAlpha(opacity)} />
      </mesh>
      <mesh
        position={[upperTorsoWidth * 0.18, HEAD_Y - HEAD_SIZE / 2 - 0.22, 0.07]}
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
    <mesh position={[0, LEG_LENGTH + LOWER_TORSO_HEIGHT * 0.45, 0]} castShadow>
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
  const capY = HEAD_Y + HEAD_SIZE * 0.35;
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
          position={[0, HEAD_Y - HEAD_SIZE * 0.1, -HEAD_SIZE / 2 - 0.05]}
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
          <mesh key={x} position={[x, HEAD_Y - HEAD_SIZE * 0.1, 0]} castShadow>
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
  running?: boolean;
  /** Deterministic phase offset so idle bobs don't sync across the room. */
  phase?: number;
  opacity?: number;
}

export function BlockCharacter({
  appearance,
  running = false,
  phase = 0,
  opacity = 1,
}: BlockCharacterProps) {
  const group = useRef<Group>(null);
  const body = BODY_TYPE_FACTORS[appearance.bodyType];
  const gender = GENDER_FACTORS[appearance.gender];
  const upperTorsoWidth = 0.4 * body.torso * gender.shoulder;
  const lowerTorsoWidth = 0.38 * body.torso * gender.hip;
  const armWidth = 0.1 * body.arm;
  const legWidth = 0.13 * body.leg;
  const armX = upperTorsoWidth * 0.55;
  const hasAccent = appearance.accent.toLowerCase() !== appearance.clothing.toLowerCase();
  const expression: FaceExpression = running ? 'focus' : 'neutral';

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const speed = running ? 4.2 : 1.6;
    const amp = running ? 0.05 : 0.022;
    if (group.current) group.current.position.y = Math.sin(t * speed + phase) * amp;
  });

  return (
    <group ref={group}>
      {/* legs */}
      <mesh position={[-0.11, LEG_LENGTH / 2, 0]} castShadow>
        <boxGeometry args={[legWidth, LEG_LENGTH, 0.13]} />
        <meshStandardMaterial
          color={appearance.clothing}
          roughness={0.75}
          {...materialAlpha(opacity)}
        />
      </mesh>
      <mesh position={[0.11, LEG_LENGTH / 2, 0]} castShadow>
        <boxGeometry args={[legWidth, LEG_LENGTH, 0.13]} />
        <meshStandardMaterial
          color={appearance.clothing}
          roughness={0.75}
          {...materialAlpha(opacity)}
        />
      </mesh>
      {/* shoes */}
      <mesh position={[-0.11, 0.04, 0.04]} castShadow>
        <boxGeometry args={[legWidth * 1.18, 0.08, 0.2]} />
        <meshStandardMaterial
          color={SHOE_COLOR}
          roughness={0.5}
          metalness={0.1}
          {...materialAlpha(opacity)}
        />
      </mesh>
      <mesh position={[0.11, 0.04, 0.04]} castShadow>
        <boxGeometry args={[legWidth * 1.18, 0.08, 0.2]} />
        <meshStandardMaterial
          color={SHOE_COLOR}
          roughness={0.5}
          metalness={0.1}
          {...materialAlpha(opacity)}
        />
      </mesh>

      {/* lower torso / hips */}
      {gender.showSkirt ? (
        <SkirtFlare outfitColor={appearance.clothing} opacity={opacity} />
      ) : (
        <mesh position={[0, LEG_LENGTH + LOWER_TORSO_HEIGHT / 2, 0]} castShadow>
          <boxGeometry args={[lowerTorsoWidth + body.bellyExtra, LOWER_TORSO_HEIGHT, 0.22]} />
          <meshStandardMaterial
            color={appearance.clothing}
            roughness={0.72}
            {...materialAlpha(opacity)}
          />
        </mesh>
      )}

      {/* upper torso */}
      <mesh position={[0, LEG_LENGTH + LOWER_TORSO_HEIGHT + UPPER_TORSO_HEIGHT / 2, 0]} castShadow>
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

      {/* neck */}
      <mesh position={[0, SHOULDER_Y + UPPER_TORSO_HEIGHT * 0.34, 0.01]} castShadow>
        <boxGeometry args={[0.14 * body.torso, 0.1, 0.13]} />
        <meshStandardMaterial color={appearance.skin} roughness={0.42} {...materialAlpha(opacity)} />
      </mesh>

      {/* accent variant */}
      {hasAccent && appearance.accentVariant === 'vest' && (
        <VestPanel upperTorsoWidth={upperTorsoWidth} accentColor={appearance.accent} opacity={opacity} />
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

      {/* arms */}
      <mesh position={[-armX, SHOULDER_Y - ARM_LENGTH / 2, 0]} castShadow>
        <boxGeometry args={[armWidth, ARM_LENGTH, 0.11]} />
        <meshStandardMaterial
          color={appearance.clothing}
          roughness={0.74}
          {...materialAlpha(opacity)}
        />
      </mesh>
      <mesh position={[armX, SHOULDER_Y - ARM_LENGTH / 2, 0]} castShadow>
        <boxGeometry args={[armWidth, ARM_LENGTH, 0.11]} />
        <meshStandardMaterial
          color={appearance.clothing}
          roughness={0.74}
          {...materialAlpha(opacity)}
        />
      </mesh>
      {/* hands */}
      <mesh position={[-armX, SHOULDER_Y - ARM_LENGTH - 0.04, 0.02]} castShadow>
        <boxGeometry args={[armWidth * 1.15, 0.09, 0.12]} />
        <meshStandardMaterial color={appearance.skin} roughness={0.45} {...materialAlpha(opacity)} />
      </mesh>
      <mesh position={[armX, SHOULDER_Y - ARM_LENGTH - 0.04, 0.02]} castShadow>
        <boxGeometry args={[armWidth * 1.15, 0.09, 0.12]} />
        <meshStandardMaterial color={appearance.skin} roughness={0.45} {...materialAlpha(opacity)} />
      </mesh>

      {/* head */}
      <mesh position={[0, HEAD_Y, 0]} castShadow>
        <boxGeometry args={[HEAD_SIZE * body.head, HEAD_SIZE, HEAD_SIZE * 0.9]} />
        <meshStandardMaterial color={appearance.skin} roughness={0.42} {...materialAlpha(opacity)} />
      </mesh>
      <HairMesh style={appearance.hairStyle} color={appearance.hair} opacity={opacity} />
      <FaceBillboard expression={expression} opacity={opacity} />
    </group>
  );
}
