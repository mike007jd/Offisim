export type SceneLightingTier = 'high' | 'medium' | 'low' | 'off';

export interface LightingTierPreset {
  shadowMapSize: number;
  envMapPreset: 'apartment' | null;
  hemisphereIntensity: number;
  bounceSpotlightCount: 0 | 1 | 2;
  postProcessing: 'dof+vignette' | 'vignette' | null;
}

export const LIGHTING_TIER_PRESETS: Record<SceneLightingTier, LightingTierPreset> = {
  high: {
    shadowMapSize: 2048,
    envMapPreset: 'apartment',
    hemisphereIntensity: 0.65,
    bounceSpotlightCount: 2,
    postProcessing: 'dof+vignette',
  },
  medium: {
    shadowMapSize: 1024,
    envMapPreset: 'apartment',
    hemisphereIntensity: 0.55,
    bounceSpotlightCount: 1,
    postProcessing: 'vignette',
  },
  low: {
    shadowMapSize: 512,
    envMapPreset: null,
    hemisphereIntensity: 0.35,
    bounceSpotlightCount: 0,
    postProcessing: null,
  },
  off: {
    shadowMapSize: 0,
    envMapPreset: null,
    hemisphereIntensity: 0.25,
    bounceSpotlightCount: 0,
    postProcessing: null,
  },
};

export const DEV_LIGHTING_OVERRIDE_KEYS = {
  tier: 'offisim.scene.devOverride.tier',
  env: 'offisim.scene.devOverride.env',
  shadows: 'offisim.scene.devOverride.shadows',
  hemi: 'offisim.scene.devOverride.hemi',
  post: 'offisim.scene.devOverride.post',
} as const;

function readBooleanOverride(key: string): boolean | null {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(key);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

export function getDevTierOverride(): SceneLightingTier | null {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(DEV_LIGHTING_OVERRIDE_KEYS.tier);
  return raw === 'high' || raw === 'medium' || raw === 'low' || raw === 'off' ? raw : null;
}

export function getDevLightingOverrides(): {
  env: boolean | null;
  shadows: boolean | null;
  hemi: number | null;
  post: boolean | null;
} {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') {
    return { env: null, shadows: null, hemi: null, post: null };
  }
  const hemiRaw = Number(localStorage.getItem(DEV_LIGHTING_OVERRIDE_KEYS.hemi));
  return {
    env: readBooleanOverride(DEV_LIGHTING_OVERRIDE_KEYS.env),
    shadows: readBooleanOverride(DEV_LIGHTING_OVERRIDE_KEYS.shadows),
    hemi: Number.isFinite(hemiRaw) && hemiRaw > 0 ? hemiRaw : null,
    post: readBooleanOverride(DEV_LIGHTING_OVERRIDE_KEYS.post),
  };
}

export function clearDevLightingOverrides(): void {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return;
  for (const key of Object.values(DEV_LIGHTING_OVERRIDE_KEYS)) {
    localStorage.removeItem(key);
  }
  window.dispatchEvent(new CustomEvent('offisim.scene.devOverride.reset'));
}

export function emitDevLightingOverrideChange(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('offisim.scene.devOverride.change'));
}

export function getRendererConfig(tier: SceneLightingTier): { dpr: [number, number] } {
  switch (tier) {
    case 'high':
      return { dpr: [1, 1.5] };
    case 'medium':
      return { dpr: [1, 1.25] };
    case 'low':
    case 'off':
      return { dpr: [1, 1] };
  }
}
