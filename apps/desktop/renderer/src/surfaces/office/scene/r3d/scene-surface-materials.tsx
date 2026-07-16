import type { ComponentProps } from 'react';
import { type EmissiveMaterial, type EmissiveTier, SceneMaterial } from './scene-materials.js';
import { useSceneColors } from './use-scene-colors.js';

type SceneDecalMaterialProps = ComponentProps<typeof SceneMaterial>;
type EmissiveDecalMaterialProps = ComponentProps<typeof EmissiveMaterial>;
type SceneGlassMaterialProps = Omit<SceneDecalMaterialProps, 'materialClass'>;

export const SCENE_TRANSPARENT_RENDER_ORDER = {
  glass: 10,
} as const;

const DECAL_DEPTH_CONTRACT = {
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
} as const;

/**
 * Opt-in material for artwork, labels, and other intentionally coplanar detail.
 * Callers can still tune the parent SceneMaterial, but cannot weaken the depth
 * contract that keeps distant decals stable.
 */
export function SceneDecalMaterial({ overrides, ...materialProps }: SceneDecalMaterialProps) {
  return (
    <SceneMaterial
      {...materialProps}
      overrides={{
        ...overrides,
        ...DECAL_DEPTH_CONTRACT,
      }}
    />
  );
}

/** Physical glass keeps transmission but never becomes an invisible depth occluder. */
export function SceneGlassMaterial({ overrides, ...materialProps }: SceneGlassMaterialProps) {
  return (
    <SceneMaterial
      {...materialProps}
      materialClass="glass"
      overrides={{
        ...overrides,
        transparent: true,
        depthWrite: false,
      }}
    />
  );
}

const EMISSIVE_INTENSITY: Record<EmissiveTier, number> = {
  led: 1.35,
  screen: 0.75,
  signage: 0.9,
  accent: 0.6,
};

/** Bloom-safe emissive decal with the same public API and tiers as EmissiveMaterial. */
export function EmissiveDecalMaterial({
  color,
  intensity,
  tier = 'screen',
}: EmissiveDecalMaterialProps) {
  const sc = useSceneColors();
  return (
    <meshStandardMaterial
      color={sc.emissiveBase}
      emissive={color}
      emissiveIntensity={intensity ?? EMISSIVE_INTENSITY[tier]}
      roughness={tier === 'screen' ? 0.6 : 1}
      metalness={0}
      depthWrite={false}
      polygonOffset
      polygonOffsetFactor={-2}
      polygonOffsetUnits={-2}
      toneMapped={false}
    />
  );
}
