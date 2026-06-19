import type { ThreeElements } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { getDustNormalTexture, getWoodGrainNormalTexture } from './scene-textures.js';
import { useSceneColors } from './use-scene-colors.js';

export type MaterialClass =
  | 'wood'
  | 'metal'
  | 'metal-brushed'
  | 'metal-chrome'
  | 'glass'
  | 'leather'
  | 'fabric'
  | 'plastic'
  | 'carpet'
  | 'rubber'
  | 'ceramic'
  | 'screen';

interface MaterialPreset {
  component: 'standard' | 'physical';
  roughness: number;
  metalness: number;
  transmission?: number;
  ior?: number;
  opacity?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  sheenColor?: string;
  envMapIntensity: number;
  useProceduralNormal?: 'dust' | 'wood';
  normalScale?: number;
}

const MATERIAL_PRESETS: Record<MaterialClass, MaterialPreset> = {
  wood: {
    component: 'physical',
    roughness: 0.45,
    metalness: 0,
    envMapIntensity: 0.55,
    clearcoat: 0.25,
    clearcoatRoughness: 0.45,
    useProceduralNormal: 'wood',
    normalScale: 0.18,
  },
  // 'metal' = anodized (most office furniture metal: server body, chair frame).
  metal: {
    component: 'standard',
    roughness: 0.52,
    metalness: 0.42,
    envMapIntensity: 0.65,
    useProceduralNormal: 'dust',
    normalScale: 0.018,
  },
  'metal-brushed': {
    component: 'physical',
    roughness: 0.48,
    metalness: 0.58,
    envMapIntensity: 0.75,
    clearcoat: 0.35,
    clearcoatRoughness: 0.55,
    useProceduralNormal: 'dust',
    normalScale: 0.022,
  },
  'metal-chrome': {
    component: 'physical',
    roughness: 0.06,
    metalness: 1.0,
    envMapIntensity: 1.2,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
  },
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
    component: 'physical',
    roughness: 0.36,
    metalness: 0,
    envMapIntensity: 0.5,
    clearcoat: 0.14,
    clearcoatRoughness: 0.55,
    useProceduralNormal: 'dust',
    normalScale: 0.014,
  },
  fabric: { component: 'standard', roughness: 0.82, metalness: 0, envMapIntensity: 0.18 },
  plastic: {
    component: 'standard',
    roughness: 0.58,
    metalness: 0,
    envMapIntensity: 0.35,
    useProceduralNormal: 'dust',
    normalScale: 0.015,
  },
  carpet: {
    component: 'physical',
    roughness: 0.95,
    metalness: 0,
    envMapIntensity: 0.05,
    sheen: 0.4,
    sheenColor: '#3a2b1f', // raw-hex-allowed: physical sheen warm tone, intentionally not a token
  },
  rubber: {
    component: 'standard',
    roughness: 0.78,
    metalness: 0,
    envMapIntensity: 0.12,
    useProceduralNormal: 'dust',
    normalScale: 0.018,
  },
  ceramic: {
    component: 'physical',
    roughness: 0.18,
    metalness: 0,
    envMapIntensity: 0.7,
    clearcoat: 0.8,
    clearcoatRoughness: 0.08,
  },
  // Roughness 0.6 so screens still pick up envmap (matte=1 reads as sticker).
  screen: {
    component: 'standard',
    roughness: 0.6,
    metalness: 0,
    envMapIntensity: 0.25,
  },
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

function useMaterial(
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
    sheen,
    sheenColor,
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
        sheen={sheen ?? preset.sheen}
        sheenColor={sheenColor ?? preset.sheenColor}
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

/**
 * Emissive tiers: each tier locks an intensity band so bloom luminance
 * threshold lands consistently regardless of base color hue. Pair with
 * EmissiveMaterial.
 */
export type EmissiveTier = 'led' | 'screen' | 'signage' | 'accent';

const EMISSIVE_INTENSITY: Record<EmissiveTier, number> = {
  led: 1.35,
  screen: 0.75,
  signage: 0.9,
  accent: 0.6,
};

/**
 * Bloom-friendly emissive material. Raw HDR output (toneMapped=false) so the
 * post-processing Bloom pass can pick it up via luminance threshold. Screens
 * keep roughness 0.6 to still receive a hint of envmap reflection (avoids the
 * fully-matte "sticker" look); LEDs/signage stay roughness 1 for pure glow.
 */
export function EmissiveMaterial({
  color,
  intensity,
  tier = 'screen',
}: {
  color: string;
  intensity?: number;
  tier?: EmissiveTier;
}) {
  const sc = useSceneColors();
  const resolvedIntensity = intensity ?? EMISSIVE_INTENSITY[tier];
  const surfaceRoughness = tier === 'screen' ? 0.6 : 1.0;
  return (
    <meshStandardMaterial
      color={sc.emissiveBase}
      emissive={color}
      emissiveIntensity={resolvedIntensity}
      roughness={surfaceRoughness}
      metalness={0}
      toneMapped={false}
    />
  );
}
