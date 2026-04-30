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

  return (
    <BlockCharacter
      params={sharedBrandParams(skin, outfit, hair, emblem)}
      variant="shared-rig-only"
      limbRefs={limbRefs}
    >
      <mesh ref={limbRefs?.leftLeg} position={[-0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.1, 0.5, 0.1]} />
        <meshStandardMaterial color={outfit} />
      </mesh>
      <mesh ref={limbRefs?.rightLeg} position={[0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.1, 0.5, 0.1]} />
        <meshStandardMaterial color={outfit} />
      </mesh>
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[0.3, 0.5, 0.18]} />
        <meshStandardMaterial color={outfit} roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.02, 0.11]} castShadow>
        <boxGeometry args={[0.32, 0.05, 0.02]} />
        <meshStandardMaterial color={emblem} emissive={emblem} emissiveIntensity={0.3} />
      </mesh>
      <mesh ref={limbRefs?.leftArm} position={[-0.22, 0.75, 0]} castShadow>
        <boxGeometry args={[0.08, 0.45, 0.08]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh ref={limbRefs?.rightArm} position={[0.22, 0.75, 0]} castShadow>
        <boxGeometry args={[0.08, 0.45, 0.08]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh position={[0, 1.28, 0]} castShadow>
        <boxGeometry args={[0.26, 0.34, 0.26]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh position={[0, 1.4, -0.14]} castShadow>
        <boxGeometry args={[0.28, 0.3, 0.1]} />
        <meshStandardMaterial color={hair} />
      </mesh>
      <mesh position={[0, 1.58, 0]} castShadow>
        <boxGeometry args={[0.2, 0.05, 0.2]} />
        <meshStandardMaterial color={emblem} emissive={outfit} emissiveIntensity={0.35} />
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
        <meshStandardMaterial color={red} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.4, -0.22]} castShadow>
        <sphereGeometry args={[0.26, 12, 10]} />
        <meshStandardMaterial color={darkRed} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.18, -0.36]} castShadow>
        <sphereGeometry args={[0.16, 10, 8]} />
        <meshStandardMaterial color={darkRed} roughness={0.5} />
      </mesh>
      <mesh ref={limbRefs?.leftArm} position={[-0.42, 0.78, 0.12]} castShadow>
        <boxGeometry args={[0.12, 0.16, 0.12]} />
        <meshStandardMaterial color={red} />
      </mesh>
      <mesh position={[-0.58, 0.82, 0.18]} castShadow>
        <sphereGeometry args={[0.16, 10, 8]} />
        <meshStandardMaterial color={darkRed} roughness={0.4} />
      </mesh>
      <mesh ref={limbRefs?.rightArm} position={[0.42, 0.78, 0.12]} castShadow>
        <boxGeometry args={[0.12, 0.16, 0.12]} />
        <meshStandardMaterial color={red} />
      </mesh>
      <mesh position={[0.58, 0.82, 0.18]} castShadow>
        <sphereGeometry args={[0.16, 10, 8]} />
        <meshStandardMaterial color={darkRed} roughness={0.4} />
      </mesh>
      <mesh position={[-0.1, 1.15, 0.25]} rotation={[0.5, 0, 0]} castShadow>
        <cylinderGeometry args={[0.012, 0.012, 0.36, 6]} />
        <meshStandardMaterial color={antenna} />
      </mesh>
      <mesh position={[0.1, 1.15, 0.25]} rotation={[0.5, 0, 0]} castShadow>
        <cylinderGeometry args={[0.012, 0.012, 0.36, 6]} />
        <meshStandardMaterial color={antenna} />
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
        <meshStandardMaterial color={pants} />
      </mesh>
      <mesh ref={limbRefs?.rightLeg} position={[0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <meshStandardMaterial color={pants} />
      </mesh>
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[0.36, 0.5, 0.2]} />
        <meshStandardMaterial color={outfit} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.02, 0.12]} castShadow>
        <boxGeometry args={[0.35, 0.05, 0.02]} />
        <meshStandardMaterial color={highlight} emissive={highlight} emissiveIntensity={0.4} />
      </mesh>
      <mesh ref={limbRefs?.leftArm} position={[-0.25, 0.75, 0]} castShadow>
        <boxGeometry args={[0.1, 0.45, 0.1]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh ref={limbRefs?.rightArm} position={[0.25, 0.75, 0]} castShadow>
        <boxGeometry args={[0.1, 0.45, 0.1]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh position={[-0.14, 1.55, 0]} rotation={[0, 0, 0.4]} castShadow>
        <boxGeometry args={[0.06, 0.26, 0.06]} />
        <meshStandardMaterial color={highlight} emissive={highlight} emissiveIntensity={0.5} />
      </mesh>
      <mesh position={[0.14, 1.55, 0]} rotation={[0, 0, -0.4]} castShadow>
        <boxGeometry args={[0.06, 0.26, 0.06]} />
        <meshStandardMaterial color={highlight} emissive={highlight} emissiveIntensity={0.5} />
      </mesh>
    </BlockCharacter>
  );
}

export function CustomBody({ limbRefs }: BrandBodyProps) {
  const skin = '#d4d4d8'; // raw-hex-allowed
  const outfit = '#6b21a8'; // raw-hex-allowed
  const accent = '#a78bfa'; // raw-hex-allowed
  const leg = '#3f3f46'; // raw-hex-allowed

  return (
    <BlockCharacter
      params={sharedBrandParams(skin, outfit, accent, accent)}
      variant="shared-rig-only"
      limbRefs={limbRefs}
    >
      <mesh ref={limbRefs?.leftLeg} position={[-0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <meshStandardMaterial color={leg} />
      </mesh>
      <mesh ref={limbRefs?.rightLeg} position={[0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <meshStandardMaterial color={leg} />
      </mesh>
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[0.36, 0.5, 0.2]} />
        <meshStandardMaterial color={outfit} roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.02, 0.12]} castShadow>
        <boxGeometry args={[0.35, 0.04, 0.02]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.2} />
      </mesh>
      <mesh ref={limbRefs?.leftArm} position={[-0.25, 0.75, 0]} castShadow>
        <boxGeometry args={[0.1, 0.45, 0.1]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh ref={limbRefs?.rightArm} position={[0.25, 0.75, 0]} castShadow>
        <boxGeometry args={[0.1, 0.45, 0.1]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <meshStandardMaterial color={skin} />
      </mesh>
    </BlockCharacter>
  );
}
