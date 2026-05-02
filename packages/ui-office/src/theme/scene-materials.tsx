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

const STANDARD_OVERRIDE_KEYS = [
  'alphaTest',
  'blending',
  'colorWrite',
  'depthTest',
  'depthWrite',
  'emissive',
  'emissiveIntensity',
  'flatShading',
  'fog',
  'name',
  'polygonOffset',
  'polygonOffsetFactor',
  'polygonOffsetUnits',
  'side',
  'toneMapped',
  'transparent',
  'vertexColors',
  'visible',
  'wireframe',
] as const;

function pickStandardOverrides(
  overrides: Omit<MaterialOverrides, 'useProceduralNormal' | 'normalScale'>,
) {
  const picked: Partial<ThreeElements['meshStandardMaterial']> = {};
  for (const key of STANDARD_OVERRIDE_KEYS) {
    if (key in overrides) {
      (picked as Record<string, unknown>)[key] = overrides[key as keyof typeof overrides];
    }
  }
  return picked;
}

export function useMaterial(
  materialClass: MaterialClass,
  color: string,
  overrides: MaterialOverrides = {},
) {
  const sc = useSceneColors();
  const preset = MATERIAL_PRESETS[materialClass];
  const {
    useProceduralNormal,
    normalScale: overrideNormalScale,
    roughness,
    metalness,
    envMapIntensity,
    clearcoat,
    clearcoatRoughness,
    transmission,
    ior,
    opacity,
    attenuationColor,
    attenuationDistance,
    transparent,
    ...materialOverrides
  } = overrides;
  const normalKind =
    useProceduralNormal === false
      ? undefined
      : preset.useProceduralNormal === 'wood' || useProceduralNormal === true
        ? 'wood'
        : preset.useProceduralNormal;
  const normalScale = overrideNormalScale ?? preset.normalScale;
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
    ...pickStandardOverrides(materialOverrides),
    color,
    roughness: roughness ?? preset.roughness,
    metalness: metalness ?? preset.metalness,
    envMapIntensity: envMapIntensity ?? preset.envMapIntensity,
    normalMap,
    normalScale: normalScaleVector,
    opacity,
    transparent,
  };

  if (preset.component === 'physical') {
    const defaultTransparent =
      preset.transmission !== undefined || preset.opacity !== undefined ? true : undefined;
    return (
      <meshPhysicalMaterial
        {...common}
        clearcoat={clearcoat ?? preset.clearcoat}
        clearcoatRoughness={clearcoatRoughness ?? preset.clearcoatRoughness}
        transmission={transmission ?? preset.transmission}
        ior={ior ?? preset.ior}
        opacity={opacity ?? preset.opacity}
        attenuationColor={attenuationColor ?? sc.partition}
        attenuationDistance={attenuationDistance ?? 2}
        transparent={transparent ?? defaultTransparent}
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
