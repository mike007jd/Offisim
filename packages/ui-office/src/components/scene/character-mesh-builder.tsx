import { DARK_SCENE_3D, DARK_SEMANTIC_COLORS } from '@offisim/ui-core/tokens';
import type { CharacterLimbRefs } from '../../hooks/useCharacterMovement.js';
import { SceneMaterial } from '../../theme/scene-materials.js';
import { useSceneColors } from '../../theme/use-scene-colors.js';

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

export const BODY_TYPE_FACTORS = {
  slim: { torso: 0.85, arm: 0.85, leg: 0.92, head: 1 },
  normal: { torso: 1, arm: 1, leg: 1, head: 1 },
  stocky: { torso: 1.15, arm: 1.18, leg: 1.1, head: 1 },
} as const;

export const GENDER_FACTORS = {
  masculine: { shoulder: 1.05, hip: 0.95, aspect: 1 },
  feminine: { shoulder: 0.85, hip: 1.1, aspect: 0.95 },
  neutral: { shoulder: 1, hip: 1, aspect: 1 },
} as const;

export const STATE_TO_EYE_EMISSIVE: Record<string, { color: string; intensity: number }> = {
  idle: { color: DARK_SEMANTIC_COLORS.textInverse, intensity: 0.05 },
  executing: { color: DARK_SCENE_3D.ledBlue, intensity: 0.4 },
  reporting: { color: DARK_SCENE_3D.ledCyan, intensity: 0.5 },
  searching: { color: DARK_SEMANTIC_COLORS.success, intensity: 0.35 },
  assigned: { color: DARK_SEMANTIC_COLORS.success, intensity: 0.35 },
  gathering: { color: DARK_SEMANTIC_COLORS.success, intensity: 0.35 },
  analyzing: { color: DARK_SEMANTIC_COLORS.success, intensity: 0.35 },
  planning: { color: DARK_SEMANTIC_COLORS.success, intensity: 0.35 },
  dispatching: { color: DARK_SEMANTIC_COLORS.success, intensity: 0.35 },
  success: { color: DARK_SEMANTIC_COLORS.success, intensity: 0.35 },
  blocked: { color: DARK_SEMANTIC_COLORS.error, intensity: 0.5 },
};

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
  const upperTorsoWidth = 0.36 * body.torso * gender.shoulder;
  const lowerTorsoWidth = 0.36 * body.torso * gender.hip;
  const armWidth = 0.1 * body.arm;
  const legWidth = 0.12 * body.leg;
  const armX = 0.25 * body.torso * gender.shoulder;
  const eye = params.isBlocked
    ? STATE_TO_EYE_EMISSIVE.blocked
    : (STATE_TO_EYE_EMISSIVE[params.state] ?? STATE_TO_EYE_EMISSIVE.idle);
  if (!eye) return null;
  const showAccent =
    params.accentColor.toLowerCase() !== params.outfitColor.toLowerCase() &&
    (params.accentVariant ?? 'vest') === 'vest';

  return (
    <>
      <mesh ref={limbRefs?.leftLeg} position={[-0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[legWidth, 0.5, 0.12]} />
        <SceneMaterial
          materialClass="fabric"
          color={params.outfitColor}
          overrides={{ roughness: 0.75 }}
        />
      </mesh>
      <mesh ref={limbRefs?.rightLeg} position={[0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[legWidth, 0.5, 0.12]} />
        <SceneMaterial
          materialClass="fabric"
          color={params.outfitColor}
          overrides={{ roughness: 0.75 }}
        />
      </mesh>
      <mesh position={[-0.12, 0.04, 0.04]} castShadow>
        <boxGeometry args={[legWidth * 1.18, 0.08, 0.18]} />
        <SceneMaterial materialClass="leather" color={sc.characterShoe} />
      </mesh>
      <mesh position={[0.12, 0.04, 0.04]} castShadow>
        <boxGeometry args={[legWidth * 1.18, 0.08, 0.18]} />
        <SceneMaterial materialClass="leather" color={sc.characterShoe} />
      </mesh>
      <mesh position={[0, 0.82, 0]} castShadow>
        <boxGeometry args={[upperTorsoWidth, 0.25 * gender.aspect, 0.2]} />
        <SceneMaterial
          materialClass="fabric"
          color={params.outfitColor}
          overrides={{ roughness: 0.7 }}
        />
      </mesh>
      <mesh position={[0, 1.02, 0.02]} castShadow>
        <boxGeometry args={[0.16 * body.torso, 0.16, 0.14]} />
        <SceneMaterial
          materialClass="plastic"
          color={params.skinColor}
          overrides={{ roughness: 0.42 }}
        />
      </mesh>
      <mesh position={[0, 0.58, 0]} castShadow>
        <boxGeometry args={[lowerTorsoWidth, 0.25, 0.2]} />
        <SceneMaterial
          materialClass="fabric"
          color={params.outfitColor}
          overrides={{ roughness: 0.72 }}
        />
      </mesh>
      {showAccent && (
        <mesh position={[0, 0.78, 0.105]} castShadow>
          <boxGeometry args={[upperTorsoWidth * 0.62, 0.32, 0.018]} />
          <SceneMaterial
            materialClass="fabric"
            color={params.accentColor}
            overrides={{ roughness: 0.65 }}
          />
        </mesh>
      )}
      <mesh ref={limbRefs?.leftArm} position={[-armX, 0.75, 0]} castShadow>
        <boxGeometry args={[armWidth, 0.45, 0.1]} />
        <SceneMaterial
          materialClass="plastic"
          color={params.skinColor}
          overrides={{ roughness: 0.4 }}
        />
      </mesh>
      <mesh ref={limbRefs?.rightArm} position={[armX, 0.75, 0]} castShadow>
        <boxGeometry args={[armWidth, 0.45, 0.1]} />
        <SceneMaterial
          materialClass="plastic"
          color={params.skinColor}
          overrides={{ roughness: 0.4 }}
        />
      </mesh>
      <mesh position={[-armX, 0.49, 0.01]} castShadow>
        <boxGeometry args={[armWidth * 1.1, 0.08, 0.1]} />
        <SceneMaterial
          materialClass="plastic"
          color={params.skinColor}
          overrides={{ roughness: 0.42 }}
        />
      </mesh>
      <mesh position={[armX, 0.49, 0.01]} castShadow>
        <boxGeometry args={[armWidth * 1.1, 0.08, 0.1]} />
        <SceneMaterial
          materialClass="plastic"
          color={params.skinColor}
          overrides={{ roughness: 0.42 }}
        />
      </mesh>
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[0.3 * body.head, 0.3, 0.3]} />
        <SceneMaterial
          materialClass="plastic"
          color={params.skinColor}
          overrides={{ roughness: 0.4 }}
        />
      </mesh>
      <HairMesh style={params.hairStyle} color={params.hairColor} />
      <mesh position={[-0.07, 1.3, 0.16]} castShadow>
        <sphereGeometry args={[0.025, 8, 6]} />
        <SceneMaterial
          materialClass="plastic"
          color={DARK_SEMANTIC_COLORS.textInverse}
          overrides={{ emissive: eye.color, emissiveIntensity: eye.intensity }}
        />
      </mesh>
      <mesh position={[0.07, 1.3, 0.16]} castShadow>
        <sphereGeometry args={[0.025, 8, 6]} />
        <SceneMaterial
          materialClass="plastic"
          color={DARK_SEMANTIC_COLORS.textInverse}
          overrides={{ emissive: eye.color, emissiveIntensity: eye.intensity }}
        />
      </mesh>
      <mesh position={[0, 1.21, 0.155]} castShadow>
        <boxGeometry args={[0.06, 0.012, 0.005]} />
        <SceneMaterial
          materialClass="plastic"
          color={DARK_SEMANTIC_COLORS.error}
          overrides={{ roughness: 0.5 }}
        />
      </mesh>
      <mesh position={[0, 1.255, 0.178]} castShadow>
        <boxGeometry args={[0.035, 0.045, 0.03]} />
        <SceneMaterial
          materialClass="plastic"
          color={params.skinColor}
          overrides={{ roughness: 0.45 }}
        />
      </mesh>
      {children}
    </>
  );
}

function HairMesh({ style, color }: { style: BlockCharacterParams['hairStyle']; color: string }) {
  if (style === 'bald') return null;

  const cap =
    style === 'long' ? (
      <mesh position={[0, 1.4, 0]} castShadow>
        <boxGeometry args={[0.32, 0.4, 0.32]} />
        <SceneMaterial materialClass="fabric" color={color} overrides={{ roughness: 0.9 }} />
      </mesh>
    ) : style === 'bob' ? (
      <mesh position={[0, 1.45, 0]} castShadow>
        <boxGeometry args={[0.36, 0.22, 0.34]} />
        <SceneMaterial materialClass="fabric" color={color} overrides={{ roughness: 0.9 }} />
      </mesh>
    ) : (
      <mesh position={[0, 1.48, 0]} castShadow>
        <boxGeometry args={[0.32, 0.16, 0.32]} />
        <SceneMaterial materialClass="fabric" color={color} overrides={{ roughness: 0.9 }} />
      </mesh>
    );

  if (style === 'ponytail') {
    return (
      <>
        {cap}
        <mesh position={[0, 1.2, -0.2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 0.3, 8]} />
          <SceneMaterial materialClass="fabric" color={color} overrides={{ roughness: 0.9 }} />
        </mesh>
      </>
    );
  }
  if (style === 'curly') {
    return (
      <>
        {cap}
        {[
          [-0.1, 1.55, -0.1],
          [0.1, 1.55, -0.1],
          [-0.1, 1.55, 0.1],
          [0.1, 1.55, 0.1],
        ].map((position) => (
          <mesh key={position.join(':')} position={position as [number, number, number]} castShadow>
            <sphereGeometry args={[0.07, 8, 6]} />
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
        {[
          [0, 1.58, 0],
          [-0.1, 1.56, -0.06],
          [0.1, 1.56, -0.06],
          [-0.1, 1.56, 0.06],
          [0.1, 1.56, 0.06],
        ].map((position) => (
          <mesh key={position.join(':')} position={position as [number, number, number]} castShadow>
            <coneGeometry args={[0.04, 0.1, 6]} />
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
        {[-0.18, 0.18].map((x) => (
          <mesh key={x} position={[x, 1.2, 0]} castShadow>
            <cylinderGeometry args={[0.035, 0.035, 0.32, 8]} />
            <SceneMaterial materialClass="fabric" color={color} overrides={{ roughness: 0.9 }} />
          </mesh>
        ))}
      </>
    );
  }

  return <>{cap}</>;
}
