import type { ThreeElements } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import {
  getDustNormalTexture,
  getWoodGrainNormalTexture,
} from '../lib/scene-procedural-textures.js';
import { useSceneColors } from './use-scene-colors.js';

export type MaterialClass = 'wood' | 'metal' | 'glass' | 'leather' | 'fabric' | 'plastic';

export interface MaterialPreset {
  component: 'standard' | 'physical';
  roughness: number;
  metalness: number;
  transmission?: number;
  ior?: number;
  opacity?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  envMapIntensity: number;
  useProceduralNormal?: 'dust' | 'wood';
  normalScale?: number;
}

export const MATERIAL_PRESETS: Record<MaterialClass, MaterialPreset> = {
  wood: {
    component: 'standard',
    roughness: 0.42,
    metalness: 0,
    envMapIntensity: 0.35,
    useProceduralNormal: 'wood',
    normalScale: 0.05,
  },
  metal: { component: 'standard', roughness: 0.28, metalness: 0.72, envMapIntensity: 0.9 },
  glass: {
    component: 'physical',
    roughness: 0.08,
    metalness: 0,
    transmission: 0.9,
    ior: 1.5,
    opacity: 1,
    envMapIntensity: 1.15,
    useProceduralNormal: 'dust',
    normalScale: 0.025,
  },
  leather: {
    component: 'standard',
    roughness: 0.34,
    metalness: 0,
    clearcoat: 0.45,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.45,
  },
  fabric: { component: 'standard', roughness: 0.82, metalness: 0, envMapIntensity: 0.18 },
  plastic: { component: 'standard', roughness: 0.58, metalness: 0, envMapIntensity: 0.35 },
};

type MaterialOverrides = Partial<
  ThreeElements['meshStandardMaterial'] & ThreeElements['meshPhysicalMaterial']
> & {
  useProceduralNormal?: boolean;
  normalScale?: number;
};

export function useMaterial(
  materialClass: MaterialClass,
  color: string,
  overrides: MaterialOverrides = {},
) {
  const sc = useSceneColors();
  const preset = MATERIAL_PRESETS[materialClass];
  const normalKind =
    overrides.useProceduralNormal === false
      ? undefined
      : preset.useProceduralNormal === 'wood' || overrides.useProceduralNormal === true
        ? 'wood'
        : preset.useProceduralNormal;
  const normalScale = overrides.normalScale ?? preset.normalScale;
  const normalMap = useMemo(() => {
    if (normalKind === 'wood') return getWoodGrainNormalTexture();
    if (normalKind === 'dust') return getDustNormalTexture();
    return undefined;
  }, [normalKind]);
  const normalScaleVector = useMemo(
    () => (normalScale ? new THREE.Vector2(normalScale, normalScale) : undefined),
    [normalScale],
  );

  const common = {
    color,
    roughness: overrides.roughness ?? preset.roughness,
    metalness: overrides.metalness ?? preset.metalness,
    envMapIntensity: overrides.envMapIntensity ?? preset.envMapIntensity,
    normalMap,
    normalScale: normalScaleVector,
    clearcoat: overrides.clearcoat ?? preset.clearcoat,
    clearcoatRoughness: overrides.clearcoatRoughness ?? preset.clearcoatRoughness,
    ...overrides,
  };

  if (preset.component === 'physical') {
    return (
      <meshPhysicalMaterial
        {...common}
        transmission={overrides.transmission ?? preset.transmission}
        ior={overrides.ior ?? preset.ior}
        opacity={overrides.opacity ?? preset.opacity}
        attenuationColor={overrides.attenuationColor ?? sc.partition}
        attenuationDistance={overrides.attenuationDistance ?? 2}
        transparent={overrides.transparent ?? true}
      />
    );
  }

  return <meshStandardMaterial {...common} />;
}

export function SceneMaterial({
  materialClass,
  color,
  overrides,
}: {
  materialClass: MaterialClass;
  color: string;
  overrides?: MaterialOverrides;
}) {
  return useMaterial(materialClass, color, overrides);
}
