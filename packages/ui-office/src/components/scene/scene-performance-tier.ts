export type SceneLightingTier = 'high' | 'medium' | 'low' | 'off';

export interface PostProcessingPreset {
  multisampling: 0 | 2 | 4 | 8;
  ssao: boolean;
  bloom: boolean;
  vignette: boolean;
  smaa: boolean;
  cinematicDof: boolean;
  grade: boolean;
  filmGrain: boolean;
  chromaticAberration: boolean;
}

export interface LightingTierPreset {
  shadowMapSize: number;
  envMapPreset: 'apartment' | null;
  hemisphereIntensity: number;
  bounceSpotlightCount: 0 | 1 | 2;
  postProcessing: PostProcessingPreset;
}

const POST_NONE: PostProcessingPreset = {
  multisampling: 0,
  ssao: false,
  bloom: false,
  vignette: false,
  smaa: false,
  cinematicDof: false,
  grade: false,
  filmGrain: false,
  chromaticAberration: false,
};

export const LIGHTING_TIER_PRESETS: Record<SceneLightingTier, LightingTierPreset> = {
  high: {
    shadowMapSize: 2048,
    envMapPreset: 'apartment',
    hemisphereIntensity: 0.65,
    bounceSpotlightCount: 2,
    postProcessing: {
      multisampling: 0,
      ssao: true,
      bloom: true,
      vignette: true,
      smaa: true,
      cinematicDof: false,
      grade: true,
      filmGrain: true,
      chromaticAberration: true,
    },
  },
  medium: {
    shadowMapSize: 1024,
    envMapPreset: 'apartment',
    hemisphereIntensity: 0.55,
    bounceSpotlightCount: 1,
    postProcessing: {
      multisampling: 0,
      ssao: false,
      bloom: true,
      vignette: true,
      smaa: true,
      cinematicDof: false,
      grade: true,
      filmGrain: false,
      chromaticAberration: false,
    },
  },
  low: {
    shadowMapSize: 512,
    envMapPreset: null,
    hemisphereIntensity: 0.35,
    bounceSpotlightCount: 0,
    postProcessing: {
      multisampling: 0,
      ssao: false,
      bloom: false,
      vignette: true,
      smaa: false,
      cinematicDof: false,
      grade: false,
      filmGrain: false,
      chromaticAberration: false,
    },
  },
  off: {
    shadowMapSize: 0,
    envMapPreset: null,
    hemisphereIntensity: 0.25,
    bounceSpotlightCount: 0,
    postProcessing: POST_NONE,
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
