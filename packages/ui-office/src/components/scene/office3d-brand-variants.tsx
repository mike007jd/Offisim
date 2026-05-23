/**
 * Brand-specific body geometry for `LowPolyCharacter`.
 *
 * Contract for every variant: expose meshes at the four `limbRefs` slots and
 * match the default silhouette's torso/head heights (y≈0.75 / y≈1.25) so
 * limb animation + name pill placement stay variant-agnostic. Brands without
 * literal legs (e.g. OpenClaw lobster) still mount invisible placeholder
 * meshes so `movementHandle.isMoving()` has valid targets.
 */

import type { CharacterLimbRefs } from '../../hooks/useCharacterMovement.js';
import { SceneMaterial } from '../../theme/scene-materials.js';
import { useSceneColors } from '../../theme/use-scene-colors.js';
import { BlockCharacter } from './character-mesh-builder.js';
import type { BlockCharacterParams } from './character-mesh-builder.js';

interface BrandBodyProps {
  limbRefs?: CharacterLimbRefs;
}

interface DefaultBlockBodyProps extends BrandBodyProps {
  params: BlockCharacterParams;
}

export function DefaultBlockBody({ limbRefs, params }: DefaultBlockBodyProps) {
  return <BlockCharacter params={params} variant="default" limbRefs={limbRefs} />;
}

function sharedBrandParams(
  skinColor: string,
  outfitColor: string,
  hairColor: string,
  accentColor: string,
): BlockCharacterParams {
  return {
    skinColor,
    outfitColor,
    hairColor,
    accentColor,
    bodyType: 'normal',
    gender: 'neutral',
    hairStyle: 'short',
    state: 'idle',
    isBlocked: false,
  };
}

export function HermesBody({ limbRefs }: BrandBodyProps) {
  const skin = '#f5d0c5'; // raw-hex-allowed
  const outfit = '#4f46e5'; // raw-hex-allowed
  const hair = '#312e81'; // raw-hex-allowed
  const emblem = '#c7d2fe'; // raw-hex-allowed
  const wingFeather = '#e0e7ff'; // raw-hex-allowed

  return (
    <BlockCharacter
      params={sharedBrandParams(skin, outfit, hair, emblem)}
      variant="shared-rig-only"
      limbRefs={limbRefs}
    >
      <mesh ref={limbRefs?.leftLeg} position={[-0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.1, 0.5, 0.1]} />
        <SceneMaterial materialClass="fabric" color={outfit} />
      </mesh>
      <mesh ref={limbRefs?.rightLeg} position={[0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.1, 0.5, 0.1]} />
        <SceneMaterial materialClass="fabric" color={outfit} />
      </mesh>
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[0.3, 0.5, 0.18]} />
        <SceneMaterial materialClass="fabric" color={outfit} overrides={{ roughness: 0.6 }} />
      </mesh>
      <mesh position={[0, 1.02, 0.11]} castShadow>
        <boxGeometry args={[0.32, 0.05, 0.02]} />
        <SceneMaterial
          materialClass="plastic"
          color={emblem}
          overrides={{ emissive: emblem, emissiveIntensity: 0.3 }}
        />
      </mesh>
      {/* Brand silhouette: messenger satchel on right hip */}
      <mesh position={[0.26, 0.6, 0.04]} rotation={[0, 0, -0.18]} castShadow>
        <boxGeometry args={[0.18, 0.22, 0.09]} />
        <SceneMaterial materialClass="leather" color={hair} overrides={{ roughness: 0.55 }} />
      </mesh>
      <mesh position={[0.18, 0.78, 0.06]} rotation={[0, 0, 0.45]} castShadow>
        <boxGeometry args={[0.02, 0.32, 0.04]} />
        <SceneMaterial materialClass="leather" color={hair} />
      </mesh>
      {/* Brand silhouette: messenger wings extending behind shoulders */}
      {[-1, 1].map((side) => (
        <mesh
          key={`hermes-wing-${side}`}
          position={[side * 0.18, 0.9, -0.18]}
          rotation={[0.12, side * 0.45, side * 0.18]}
          castShadow
        >
          <boxGeometry args={[0.34, 0.22, 0.03]} />
          <SceneMaterial
            materialClass="fabric"
            color={wingFeather}
            overrides={{ roughness: 0.78 }}
          />
        </mesh>
      ))}
      <mesh ref={limbRefs?.leftArm} position={[-0.22, 0.75, 0]} castShadow>
        <boxGeometry args={[0.08, 0.45, 0.08]} />
        <SceneMaterial materialClass="plastic" color={skin} />
      </mesh>
      <mesh ref={limbRefs?.rightArm} position={[0.22, 0.75, 0]} castShadow>
        <boxGeometry args={[0.08, 0.45, 0.08]} />
        <SceneMaterial materialClass="plastic" color={skin} />
      </mesh>
      <mesh position={[0, 1.28, 0]} castShadow>
        <boxGeometry args={[0.26, 0.34, 0.26]} />
        <SceneMaterial materialClass="plastic" color={skin} />
      </mesh>
      <mesh position={[0, 1.4, -0.14]} castShadow>
        <boxGeometry args={[0.28, 0.3, 0.1]} />
        <SceneMaterial materialClass="fabric" color={hair} />
      </mesh>
      <mesh position={[0, 1.58, 0]} castShadow>
        <boxGeometry args={[0.2, 0.05, 0.2]} />
        <SceneMaterial
          materialClass="plastic"
          color={emblem}
          overrides={{ emissive: outfit, emissiveIntensity: 0.35 }}
        />
      </mesh>
    </BlockCharacter>
  );
}

export function OpenClawBody({ limbRefs }: BrandBodyProps) {
  const red = '#dc2626'; // raw-hex-allowed
  const darkRed = '#991b1b'; // raw-hex-allowed
  const antenna = '#7f1d1d'; // raw-hex-allowed

  return (
    <BlockCharacter
      params={sharedBrandParams(red, red, antenna, darkRed)}
      variant="shared-rig-only"
      limbRefs={limbRefs}
    >
      {/* invisible leg placeholders so limb animation targets still resolve */}
      <mesh ref={limbRefs?.leftLeg} position={[-0.12, 0.25, 0]} visible={false}>
        <boxGeometry args={[0.04, 0.5, 0.04]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <mesh ref={limbRefs?.rightLeg} position={[0.12, 0.25, 0]} visible={false}>
        <boxGeometry args={[0.04, 0.5, 0.04]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <mesh position={[0, 0.7, 0]} castShadow>
        <sphereGeometry args={[0.42, 16, 12]} />
        <SceneMaterial materialClass="plastic" color={red} overrides={{ roughness: 0.5 }} />
      </mesh>
      <mesh position={[0, 0.4, -0.22]} castShadow>
        <sphereGeometry args={[0.26, 12, 10]} />
        <SceneMaterial materialClass="plastic" color={darkRed} overrides={{ roughness: 0.5 }} />
      </mesh>
      <mesh position={[0, 0.18, -0.36]} castShadow>
        <sphereGeometry args={[0.16, 10, 8]} />
        <SceneMaterial materialClass="plastic" color={darkRed} overrides={{ roughness: 0.5 }} />
      </mesh>
      <mesh ref={limbRefs?.leftArm} position={[-0.42, 0.78, 0.12]} castShadow>
        <boxGeometry args={[0.12, 0.16, 0.12]} />
        <SceneMaterial materialClass="plastic" color={red} />
      </mesh>
      <mesh position={[-0.58, 0.82, 0.18]} castShadow>
        <sphereGeometry args={[0.16, 10, 8]} />
        <SceneMaterial materialClass="plastic" color={darkRed} overrides={{ roughness: 0.4 }} />
      </mesh>
      <mesh ref={limbRefs?.rightArm} position={[0.42, 0.78, 0.12]} castShadow>
        <boxGeometry args={[0.12, 0.16, 0.12]} />
        <SceneMaterial materialClass="plastic" color={red} />
      </mesh>
      <mesh position={[0.58, 0.82, 0.18]} castShadow>
        <sphereGeometry args={[0.16, 10, 8]} />
        <SceneMaterial materialClass="plastic" color={darkRed} overrides={{ roughness: 0.4 }} />
      </mesh>
      <mesh position={[-0.1, 1.15, 0.25]} rotation={[0.5, 0, 0]} castShadow>
        <cylinderGeometry args={[0.012, 0.012, 0.36, 6]} />
        <SceneMaterial materialClass="plastic" color={antenna} />
      </mesh>
      <mesh position={[0.1, 1.15, 0.25]} rotation={[0.5, 0, 0]} castShadow>
        <cylinderGeometry args={[0.012, 0.012, 0.36, 6]} />
        <SceneMaterial materialClass="plastic" color={antenna} />
      </mesh>
    </BlockCharacter>
  );
}

export function CodexBody({ limbRefs }: BrandBodyProps) {
  const skin = '#e0f2fe'; // raw-hex-allowed
  const outfit = '#0369a1'; // raw-hex-allowed
  const highlight = '#38bdf8'; // raw-hex-allowed
  const pants = '#0c4a6e'; // raw-hex-allowed

  return (
    <BlockCharacter
      params={sharedBrandParams(skin, outfit, highlight, pants)}
      variant="shared-rig-only"
      limbRefs={limbRefs}
    >
      <mesh ref={limbRefs?.leftLeg} position={[-0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <SceneMaterial materialClass="fabric" color={pants} />
      </mesh>
      <mesh ref={limbRefs?.rightLeg} position={[0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <SceneMaterial materialClass="fabric" color={pants} />
      </mesh>
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[0.36, 0.5, 0.2]} />
        <SceneMaterial materialClass="fabric" color={outfit} overrides={{ roughness: 0.7 }} />
      </mesh>
      <mesh position={[0, 1.02, 0.12]} castShadow>
        <boxGeometry args={[0.35, 0.05, 0.02]} />
        <SceneMaterial
          materialClass="plastic"
          color={highlight}
          overrides={{ emissive: highlight, emissiveIntensity: 0.4 }}
        />
      </mesh>
      <mesh ref={limbRefs?.leftArm} position={[-0.25, 0.75, 0]} castShadow>
        <boxGeometry args={[0.1, 0.45, 0.1]} />
        <SceneMaterial materialClass="plastic" color={skin} />
      </mesh>
      <mesh ref={limbRefs?.rightArm} position={[0.25, 0.75, 0]} castShadow>
        <boxGeometry args={[0.1, 0.45, 0.1]} />
        <SceneMaterial materialClass="plastic" color={skin} />
      </mesh>
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <SceneMaterial materialClass="plastic" color={skin} />
      </mesh>
      <mesh position={[-0.14, 1.55, 0]} rotation={[0, 0, 0.4]} castShadow>
        <boxGeometry args={[0.06, 0.26, 0.06]} />
        <SceneMaterial
          materialClass="plastic"
          color={highlight}
          overrides={{ emissive: highlight, emissiveIntensity: 0.5 }}
        />
      </mesh>
      <mesh position={[0.14, 1.55, 0]} rotation={[0, 0, -0.4]} castShadow>
        <boxGeometry args={[0.06, 0.26, 0.06]} />
        <SceneMaterial
          materialClass="plastic"
          color={highlight}
          overrides={{ emissive: highlight, emissiveIntensity: 0.5 }}
        />
      </mesh>
      {/* Brand silhouette: square-frame glasses */}
      {[-1, 1].map((side) => (
        <mesh key={`codex-glass-${side}`} position={[side * 0.07, 1.3, 0.16]} castShadow>
          <boxGeometry args={[0.075, 0.06, 0.012]} />
          <SceneMaterial
            materialClass="metal-chrome"
            color={highlight}
            overrides={{ emissive: highlight, emissiveIntensity: 0.18 }}
          />
        </mesh>
      ))}
      <mesh position={[0, 1.3, 0.17]} castShadow>
        <boxGeometry args={[0.045, 0.01, 0.012]} />
        <SceneMaterial materialClass="metal-chrome" color={highlight} />
      </mesh>
      {/* Brand silhouette: academic robe lower hem (replaces straight leg silhouette) */}
      <mesh position={[0, 0.32, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.36, 0.46, 14, 1, true]} />
        <SceneMaterial
          materialClass="fabric"
          color={pants}
          overrides={{ roughness: 0.78, side: 2 }}
        />
      </mesh>
    </BlockCharacter>
  );
}

export function CustomBody({ limbRefs }: BrandBodyProps) {
  const sc = useSceneColors();
  const skin = '#d4d4d8'; // raw-hex-allowed
  const outfit = '#6b21a8'; // raw-hex-allowed
  const accent = '#a78bfa'; // raw-hex-allowed
  const leg = sc.brandNeutral;

  return (
    <BlockCharacter
      params={sharedBrandParams(skin, outfit, accent, accent)}
      variant="shared-rig-only"
      limbRefs={limbRefs}
    >
      <mesh ref={limbRefs?.leftLeg} position={[-0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <SceneMaterial materialClass="fabric" color={leg} />
      </mesh>
      <mesh ref={limbRefs?.rightLeg} position={[0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <SceneMaterial materialClass="fabric" color={leg} />
      </mesh>
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[0.36, 0.5, 0.2]} />
        <SceneMaterial materialClass="fabric" color={outfit} overrides={{ roughness: 0.8 }} />
      </mesh>
      <mesh position={[0, 1.02, 0.12]} castShadow>
        <boxGeometry args={[0.35, 0.04, 0.02]} />
        <SceneMaterial
          materialClass="plastic"
          color={accent}
          overrides={{ emissive: accent, emissiveIntensity: 0.2 }}
        />
      </mesh>
      <mesh ref={limbRefs?.leftArm} position={[-0.25, 0.75, 0]} castShadow>
        <boxGeometry args={[0.1, 0.45, 0.1]} />
        <SceneMaterial materialClass="plastic" color={skin} />
      </mesh>
      <mesh ref={limbRefs?.rightArm} position={[0.25, 0.75, 0]} castShadow>
        <boxGeometry args={[0.1, 0.45, 0.1]} />
        <SceneMaterial materialClass="plastic" color={skin} />
      </mesh>
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <SceneMaterial materialClass="plastic" color={skin} />
      </mesh>
      {/* Brand silhouette: neutral hooded silhouette (cowl behind/over head) */}
      <mesh position={[0, 1.42, -0.04]} rotation={[0.18, 0, 0]} castShadow>
        <coneGeometry args={[0.24, 0.4, 12, 1, true]} />
        <SceneMaterial
          materialClass="fabric"
          color={outfit}
          overrides={{ roughness: 0.85, side: 2 }}
        />
      </mesh>
      <mesh position={[0, 1.16, -0.18]} castShadow>
        <boxGeometry args={[0.36, 0.18, 0.18]} />
        <SceneMaterial materialClass="fabric" color={outfit} overrides={{ roughness: 0.85 }} />
      </mesh>
    </BlockCharacter>
  );
}
