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

interface BrandBodyProps {
  limbRefs?: CharacterLimbRefs;
}

export function HermesBody({ limbRefs }: BrandBodyProps) {
  const skin = '#f5d0c5';
  const outfit = '#4f46e5';
  const hair = '#312e81';
  const emblem = '#c7d2fe';

  return (
    <>
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
    </>
  );
}

export function OpenClawBody({ limbRefs }: BrandBodyProps) {
  const red = '#dc2626';
  const darkRed = '#991b1b';
  const antenna = '#7f1d1d';

  return (
    <>
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
    </>
  );
}

export function CodexBody({ limbRefs }: BrandBodyProps) {
  const skin = '#e0f2fe';
  const outfit = '#0369a1';
  const highlight = '#38bdf8';
  const pants = '#0c4a6e';

  return (
    <>
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
    </>
  );
}

export function CustomBody({ limbRefs }: BrandBodyProps) {
  const skin = '#d4d4d8';
  const outfit = '#6b21a8';
  const accent = '#a78bfa';

  return (
    <>
      <mesh ref={limbRefs?.leftLeg} position={[-0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <meshStandardMaterial color="#3f3f46" />
      </mesh>
      <mesh ref={limbRefs?.rightLeg} position={[0.12, 0.25, 0]} castShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <meshStandardMaterial color="#3f3f46" />
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
    </>
  );
}
