/**
 * DecorativeMesh3D — Decorative elements (plants, planters, etc.)
 *
 * Extracted from Office3DView.tsx Plant component.
 * The `template` prop selects which decorative variant to render.
 */

import { SceneMaterial } from '../../../theme/scene-materials.js';
import { useSceneColors } from '../../../theme/use-scene-colors.js';

export interface PlantMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
}

/** Standalone plant mesh — pot + foliage. */
export function PlantMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state: _state,
}: PlantMesh3DProps) {
  const sc = useSceneColors();
  const rotY = (rotation * Math.PI) / 180;

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.15, 0.5, 16]} />
        <SceneMaterial materialClass="plastic" color={sc.desk} overrides={{ roughness: 0.85 }} />
      </mesh>
      <mesh position={[0, 0.6, 0]} castShadow>
        <icosahedronGeometry args={[0.3, 1]} />
        <SceneMaterial
          materialClass="plastic"
          color={sc.leafPrimary}
          overrides={{ roughness: 0.65 }}
        />
      </mesh>
      <mesh position={[-0.15, 0.5, 0.1]} castShadow>
        <icosahedronGeometry args={[0.2, 1]} />
        <SceneMaterial
          materialClass="plastic"
          color={sc.leafSecondary}
          overrides={{ roughness: 0.65 }}
        />
      </mesh>
    </group>
  );
}

// ── Template-driven decorative dispatcher ─────────────────────────

export interface DecorativeMesh3DProps {
  position?: [number, number, number];
  rotation?: number;
  state?: string;
  template?: string;
}

/**
 * Renders a decorative mesh based on the `template` name.
 * Falls back to a plant if the template is unknown.
 */
export function DecorativeMesh3D({
  position = [0, 0, 0],
  rotation = 0,
  state,
  template = 'plant',
}: DecorativeMesh3DProps) {
  switch (template) {
    case 'plant':
    case 'plant-small':
    case 'plant-large':
      return <PlantMesh3D position={position} rotation={rotation} state={state} />;
    default:
      // Unknown decorative template — render as a plant fallback
      return <PlantMesh3D position={position} rotation={rotation} state={state} />;
  }
}
