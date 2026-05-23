import { DARK_SCENE_3D, DARK_SEMANTIC_COLORS } from '@offisim/ui-core/tokens';
import * as THREE from 'three';
import type { CharacterLimbRefs } from '../../hooks/useCharacterMovement.js';
import { SceneMaterial } from '../../theme/scene-materials.js';
import { useSceneColors } from '../../theme/use-scene-colors.js';
import { type FaceExpression, getFaceTexture } from './character-face-texture.js';

export interface BlockCharacterParams {
  skinColor: string;
  hairColor: string;
  outfitColor: string;
  accentColor: string;
  bodyType: 'slim' | 'normal' | 'stocky';
  gender: 'masculine' | 'feminine' | 'neutral';
  hairStyle: 'short' | 'long' | 'ponytail' | 'curly' | 'bald' | 'bob' | 'spiky' | 'braids';
  accentVariant?: 'vest' | 'jacket' | 'scarf';
  state: string;
  isBlocked: boolean;
}

export type BlockBodyType = BlockCharacterParams['bodyType'];
export type BlockGender = BlockCharacterParams['gender'];
export type BlockHairStyle = BlockCharacterParams['hairStyle'];

const BODY_TYPE_VALUES = new Set<BlockBodyType>(['slim', 'normal', 'stocky']);
const GENDER_VALUES = new Set<BlockGender>(['masculine', 'feminine', 'neutral']);
const HAIR_STYLE_VALUES = new Set<BlockHairStyle>([
  'short',
  'long',
  'ponytail',
  'curly',
  'bald',
  'bob',
  'spiky',
  'braids',
]);

export function resolveBlockBodyType(value: string | undefined | null): BlockBodyType {
  return BODY_TYPE_VALUES.has(value as BlockBodyType) ? (value as BlockBodyType) : 'normal';
}

export function resolveBlockGender(value: string | undefined | null): BlockGender {
  return GENDER_VALUES.has(value as BlockGender) ? (value as BlockGender) : 'neutral';
}

export function resolveBlockHairStyle(value: string | undefined | null): BlockHairStyle {
  return HAIR_STYLE_VALUES.has(value as BlockHairStyle) ? (value as BlockHairStyle) : 'short';
}

// Chibi proportions: head ~28% of total height; bodyType spread tuned so
// silhouettes diverge at ~1m camera distance.
export const BODY_TYPE_FACTORS = {
  slim: { torso: 0.75, arm: 0.78, leg: 0.95, head: 1.0, bellyExtra: 0 },
  normal: { torso: 1.0, arm: 1.0, leg: 1.0, head: 1.0, bellyExtra: 0 },
  stocky: { torso: 1.4, arm: 1.22, leg: 1.04, head: 1.06, bellyExtra: 0.12 },
} as const;

export const GENDER_FACTORS = {
  masculine: { shoulder: 1.12, hip: 0.92, aspect: 1.0, showSkirt: false, shoulderChamfer: true },
  feminine: { shoulder: 0.82, hip: 1.18, aspect: 0.95, showSkirt: true, shoulderChamfer: false },
  neutral: { shoulder: 1.0, hip: 1.0, aspect: 1.0, showSkirt: false, shoulderChamfer: false },
} as const;

/**
 * Per-agent-state affect map: face expression + eye emissive in one SSOT so
 * adding a new state can't drift between the two surfaces. Eye intensities
 * are tuned for ACES (0.15-0.25 reads as "alive" without blowing out).
 */
interface StateAffect {
  expression: FaceExpression;
  eye: { color: string; intensity: number };
}

const STATE_AFFECT: Record<string, StateAffect> = {
  idle: {
    expression: 'neutral',
    eye: { color: DARK_SEMANTIC_COLORS.textInverse, intensity: 0.04 },
  },
  executing: {
    expression: 'focus',
    eye: { color: DARK_SCENE_3D.ledBlue, intensity: 0.22 },
  },
  reporting: {
    expression: 'happy',
    eye: { color: DARK_SCENE_3D.ledCyan, intensity: 0.25 },
  },
  searching: {
    expression: 'focus',
    eye: { color: DARK_SEMANTIC_COLORS.success, intensity: 0.2 },
  },
  assigned: {
    expression: 'neutral',
    eye: { color: DARK_SEMANTIC_COLORS.success, intensity: 0.18 },
  },
  gathering: {
    expression: 'neutral',
    eye: { color: DARK_SEMANTIC_COLORS.success, intensity: 0.18 },
  },
  analyzing: {
    expression: 'focus',
    eye: { color: DARK_SEMANTIC_COLORS.success, intensity: 0.2 },
  },
  planning: {
    expression: 'focus',
    eye: { color: DARK_SEMANTIC_COLORS.success, intensity: 0.2 },
  },
  dispatching: {
    expression: 'focus',
    eye: { color: DARK_SEMANTIC_COLORS.success, intensity: 0.2 },
  },
  success: {
    expression: 'happy',
    eye: { color: DARK_SEMANTIC_COLORS.success, intensity: 0.22 },
  },
  blocked: {
    expression: 'worried',
    eye: { color: DARK_SCENE_3D.ledAmber, intensity: 0.28 },
  },
};

const DEFAULT_AFFECT: StateAffect = {
  expression: 'neutral',
  eye: { color: DARK_SEMANTIC_COLORS.textInverse, intensity: 0.04 },
};

function resolveStateAffect(state: string, isBlocked: boolean): StateAffect {
  if (isBlocked) return STATE_AFFECT.blocked ?? DEFAULT_AFFECT;
  return STATE_AFFECT[state] ?? DEFAULT_AFFECT;
}

export const STATE_TO_EYE_EMISSIVE: Record<string, { color: string; intensity: number }> =
  Object.fromEntries(Object.entries(STATE_AFFECT).map(([key, a]) => [key, a.eye]));

// ── Layout constants (head-driven chibi proportions) ──────────────────────
export const CHARACTER_LEG_LENGTH = 0.42;
export const CHARACTER_LOWER_TORSO_HEIGHT = 0.22;
export const CHARACTER_UPPER_TORSO_HEIGHT = 0.32;
export const CHARACTER_HEAD_SIZE = 0.42;
export const CHARACTER_HEAD_Y =
  CHARACTER_LEG_LENGTH +
  CHARACTER_LOWER_TORSO_HEIGHT +
  CHARACTER_UPPER_TORSO_HEIGHT +
  CHARACTER_HEAD_SIZE / 2 +
  0.04;
export const CHARACTER_SHOULDER_Y =
  CHARACTER_LEG_LENGTH + CHARACTER_LOWER_TORSO_HEIGHT + CHARACTER_UPPER_TORSO_HEIGHT * 0.72;
export const CHARACTER_ARM_LENGTH = 0.38;

const LEG_LENGTH = CHARACTER_LEG_LENGTH;
const LOWER_TORSO_HEIGHT = CHARACTER_LOWER_TORSO_HEIGHT;
const UPPER_TORSO_HEIGHT = CHARACTER_UPPER_TORSO_HEIGHT;
const HEAD_SIZE = CHARACTER_HEAD_SIZE;
const HEAD_Y = CHARACTER_HEAD_Y;
const SHOULDER_Y = CHARACTER_SHOULDER_Y;
const ARM_LENGTH = CHARACTER_ARM_LENGTH;
const FACE_SPRITE_SIZE = HEAD_SIZE * 0.78;
const FACE_SPRITE_Z = HEAD_SIZE / 2 + 0.002;

function FaceBillboard({ expression }: { expression: FaceExpression }) {
  const texture = getFaceTexture(expression);
  if (!texture) return null;
  return (
    <mesh position={[0, HEAD_Y, FACE_SPRITE_Z]}>
      <planeGeometry args={[FACE_SPRITE_SIZE, FACE_SPRITE_SIZE]} />
      <meshBasicMaterial map={texture} transparent alphaTest={0.04} side={THREE.DoubleSide} />
    </mesh>
  );
}

function JacketTrim({
  upperTorsoWidth,
  accentColor,
}: {
  upperTorsoWidth: number;
  accentColor: string;
}) {
  return (
    <>
      {/* Lapel V (two angled triangles approximated with thin planes) */}
      {[-1, 1].map((side) => (
        <mesh
          key={`lapel-${side}`}
          position={[side * upperTorsoWidth * 0.18, SHOULDER_Y + 0.04, 0.105]}
          rotation={[0, 0, side * 0.45]}
        >
          <planeGeometry args={[upperTorsoWidth * 0.32, 0.18]} />
          <SceneMaterial
            materialClass="fabric"
            color={accentColor}
            overrides={{ roughness: 0.7 }}
          />
        </mesh>
      ))}
      {/* Sleeve cuffs */}
      {[-1, 1].map((side) => (
        <mesh
          key={`cuff-${side}`}
          position={[side * (upperTorsoWidth * 0.55), SHOULDER_Y - ARM_LENGTH + 0.06, 0]}
          castShadow
        >
          <boxGeometry args={[0.12, 0.05, 0.13]} />
          <SceneMaterial
            materialClass="fabric"
            color={accentColor}
            overrides={{ roughness: 0.68 }}
          />
        </mesh>
      ))}
    </>
  );
}

function ScarfWrap({
  upperTorsoWidth,
  accentColor,
}: {
  upperTorsoWidth: number;
  accentColor: string;
}) {
  return (
    <>
      <mesh position={[0, HEAD_Y - HEAD_SIZE / 2 - 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[upperTorsoWidth * 0.36, 0.04, 8, 18]} />
        <SceneMaterial materialClass="fabric" color={accentColor} overrides={{ roughness: 0.78 }} />
      </mesh>
      <mesh
        position={[upperTorsoWidth * 0.18, HEAD_Y - HEAD_SIZE / 2 - 0.22, 0.07]}
        rotation={[0, 0, -0.08]}
        castShadow
      >
        <planeGeometry args={[0.18, 0.36]} />
        <SceneMaterial materialClass="fabric" color={accentColor} overrides={{ roughness: 0.78 }} />
      </mesh>
    </>
  );
}

function VestPanel({
  upperTorsoWidth,
  accentColor,
}: {
  upperTorsoWidth: number;
  accentColor: string;
}) {
  return (
    <mesh position={[0, SHOULDER_Y - UPPER_TORSO_HEIGHT * 0.1, 0.105]} castShadow>
      <boxGeometry args={[upperTorsoWidth * 0.7, UPPER_TORSO_HEIGHT + 0.04, 0.022]} />
      <SceneMaterial materialClass="fabric" color={accentColor} overrides={{ roughness: 0.65 }} />
    </mesh>
  );
}

function ShoulderChamfers({
  upperTorsoWidth,
  outfitColor,
}: {
  upperTorsoWidth: number;
  outfitColor: string;
}) {
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
          <SceneMaterial
            materialClass="fabric"
            color={outfitColor}
            overrides={{ roughness: 0.72 }}
          />
        </mesh>
      ))}
    </>
  );
}

function SkirtFlare({ outfitColor }: { outfitColor: string }) {
  return (
    <mesh position={[0, LEG_LENGTH + LOWER_TORSO_HEIGHT * 0.45, 0]} castShadow>
      <cylinderGeometry args={[0.16, 0.32, LOWER_TORSO_HEIGHT + 0.06, 12, 1, true]} />
      <SceneMaterial
        materialClass="fabric"
        color={outfitColor}
        overrides={{ roughness: 0.78, side: THREE.DoubleSide }}
      />
    </mesh>
  );
}

export function BlockCharacter({
  params,
  variant = 'default',
  limbRefs,
  children,
}: {
  params: BlockCharacterParams;
  variant?: 'default' | 'shared-rig-only';
  limbRefs?: CharacterLimbRefs;
  children?: React.ReactNode;
}) {
  const sc = useSceneColors();
  if (variant === 'shared-rig-only') return <>{children}</>;

  const body = BODY_TYPE_FACTORS[params.bodyType];
  const gender = GENDER_FACTORS[params.gender];
  const upperTorsoWidth = 0.4 * body.torso * gender.shoulder;
  const lowerTorsoWidth = 0.38 * body.torso * gender.hip;
  const armWidth = 0.1 * body.arm;
  const legWidth = 0.13 * body.leg;
  const armX = upperTorsoWidth * 0.55;
  const accentVariant = params.accentVariant ?? 'vest';
  const hasAccent = params.accentColor.toLowerCase() !== params.outfitColor.toLowerCase();
  const expression = resolveStateAffect(params.state, params.isBlocked).expression;

  return (
    <>
      <mesh ref={limbRefs?.leftLeg} position={[-0.11, LEG_LENGTH / 2, 0]} castShadow>
        <boxGeometry args={[legWidth, LEG_LENGTH, 0.13]} />
        <SceneMaterial
          materialClass="fabric"
          color={params.outfitColor}
          overrides={{ roughness: 0.75 }}
        />
      </mesh>
      <mesh ref={limbRefs?.rightLeg} position={[0.11, LEG_LENGTH / 2, 0]} castShadow>
        <boxGeometry args={[legWidth, LEG_LENGTH, 0.13]} />
        <SceneMaterial
          materialClass="fabric"
          color={params.outfitColor}
          overrides={{ roughness: 0.75 }}
        />
      </mesh>
      <mesh position={[-0.11, 0.04, 0.04]} castShadow>
        <boxGeometry args={[legWidth * 1.18, 0.08, 0.2]} />
        <SceneMaterial materialClass="leather" color={sc.characterShoe} />
      </mesh>
      <mesh position={[0.11, 0.04, 0.04]} castShadow>
        <boxGeometry args={[legWidth * 1.18, 0.08, 0.2]} />
        <SceneMaterial materialClass="leather" color={sc.characterShoe} />
      </mesh>

      {/* Lower torso / hips */}
      {gender.showSkirt ? (
        <SkirtFlare outfitColor={params.outfitColor} />
      ) : (
        <mesh position={[0, LEG_LENGTH + LOWER_TORSO_HEIGHT / 2, 0]} castShadow>
          <boxGeometry args={[lowerTorsoWidth + body.bellyExtra, LOWER_TORSO_HEIGHT, 0.22]} />
          <SceneMaterial
            materialClass="fabric"
            color={params.outfitColor}
            overrides={{ roughness: 0.72 }}
          />
        </mesh>
      )}

      {/* Upper torso */}
      <mesh position={[0, LEG_LENGTH + LOWER_TORSO_HEIGHT + UPPER_TORSO_HEIGHT / 2, 0]} castShadow>
        <boxGeometry
          args={[upperTorsoWidth + body.bellyExtra, UPPER_TORSO_HEIGHT * gender.aspect, 0.22]}
        />
        <SceneMaterial
          materialClass="fabric"
          color={params.outfitColor}
          overrides={{ roughness: 0.7 }}
        />
      </mesh>

      {gender.shoulderChamfer && (
        <ShoulderChamfers upperTorsoWidth={upperTorsoWidth} outfitColor={params.outfitColor} />
      )}

      {/* Neck */}
      <mesh position={[0, SHOULDER_Y + UPPER_TORSO_HEIGHT * 0.34, 0.01]} castShadow>
        <boxGeometry args={[0.14 * body.torso, 0.1, 0.13]} />
        <SceneMaterial
          materialClass="plastic"
          color={params.skinColor}
          overrides={{ roughness: 0.42 }}
        />
      </mesh>

      {/* Accent variants (D7) */}
      {hasAccent && accentVariant === 'vest' && (
        <VestPanel upperTorsoWidth={upperTorsoWidth} accentColor={params.accentColor} />
      )}
      {hasAccent && accentVariant === 'jacket' && (
        <JacketTrim upperTorsoWidth={upperTorsoWidth} accentColor={params.accentColor} />
      )}
      {hasAccent && accentVariant === 'scarf' && (
        <ScarfWrap upperTorsoWidth={upperTorsoWidth} accentColor={params.accentColor} />
      )}

      {/* Arms */}
      <mesh ref={limbRefs?.leftArm} position={[-armX, SHOULDER_Y - ARM_LENGTH / 2, 0]} castShadow>
        <boxGeometry args={[armWidth, ARM_LENGTH, 0.11]} />
        <SceneMaterial
          materialClass="fabric"
          color={params.outfitColor}
          overrides={{ roughness: 0.74 }}
        />
      </mesh>
      <mesh ref={limbRefs?.rightArm} position={[armX, SHOULDER_Y - ARM_LENGTH / 2, 0]} castShadow>
        <boxGeometry args={[armWidth, ARM_LENGTH, 0.11]} />
        <SceneMaterial
          materialClass="fabric"
          color={params.outfitColor}
          overrides={{ roughness: 0.74 }}
        />
      </mesh>
      {/* Hands */}
      <mesh position={[-armX, SHOULDER_Y - ARM_LENGTH - 0.04, 0.02]} castShadow>
        <boxGeometry args={[armWidth * 1.15, 0.09, 0.12]} />
        <SceneMaterial
          materialClass="plastic"
          color={params.skinColor}
          overrides={{ roughness: 0.45 }}
        />
      </mesh>
      <mesh position={[armX, SHOULDER_Y - ARM_LENGTH - 0.04, 0.02]} castShadow>
        <boxGeometry args={[armWidth * 1.15, 0.09, 0.12]} />
        <SceneMaterial
          materialClass="plastic"
          color={params.skinColor}
          overrides={{ roughness: 0.45 }}
        />
      </mesh>

      {/* Head (chibi-scaled) */}
      <mesh position={[0, HEAD_Y, 0]} castShadow>
        <boxGeometry args={[HEAD_SIZE * body.head, HEAD_SIZE, HEAD_SIZE * 0.9]} />
        <SceneMaterial
          materialClass="plastic"
          color={params.skinColor}
          overrides={{ roughness: 0.42 }}
        />
      </mesh>
      <HairMesh style={params.hairStyle} color={params.hairColor} />
      <FaceBillboard expression={expression} />

      {children}
    </>
  );
}

function HairMesh({ style, color }: { style: BlockCharacterParams['hairStyle']; color: string }) {
  if (style === 'bald') return null;

  const capY = HEAD_Y + HEAD_SIZE * 0.35;
  const cap =
    style === 'long' ? (
      <mesh position={[0, capY - 0.04, -0.02]} castShadow>
        <boxGeometry args={[HEAD_SIZE + 0.04, HEAD_SIZE * 1.1, HEAD_SIZE + 0.02]} />
        <SceneMaterial materialClass="fabric" color={color} overrides={{ roughness: 0.9 }} />
      </mesh>
    ) : style === 'bob' ? (
      <mesh position={[0, capY - 0.06, -0.01]} castShadow>
        <boxGeometry args={[HEAD_SIZE + 0.06, HEAD_SIZE * 0.6, HEAD_SIZE + 0.04]} />
        <SceneMaterial materialClass="fabric" color={color} overrides={{ roughness: 0.9 }} />
      </mesh>
    ) : (
      <mesh position={[0, capY, 0]} castShadow>
        <boxGeometry args={[HEAD_SIZE + 0.02, HEAD_SIZE * 0.42, HEAD_SIZE + 0.02]} />
        <SceneMaterial materialClass="fabric" color={color} overrides={{ roughness: 0.9 }} />
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
          <SceneMaterial materialClass="fabric" color={color} overrides={{ roughness: 0.9 }} />
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
            <SceneMaterial materialClass="fabric" color={color} overrides={{ roughness: 0.9 }} />
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
            <SceneMaterial materialClass="fabric" color={color} overrides={{ roughness: 0.9 }} />
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
            <SceneMaterial materialClass="fabric" color={color} overrides={{ roughness: 0.9 }} />
          </mesh>
        ))}
      </>
    );
  }

  return <>{cap}</>;
}
