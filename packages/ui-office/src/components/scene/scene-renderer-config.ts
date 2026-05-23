import * as THREE from 'three';
import { LIGHTING_TIER_PRESETS, type SceneLightingTier } from './scene-performance-tier.js';

export interface SceneRendererConfig {
  dpr: [number, number];
  gl: {
    antialias: boolean;
    toneMapping: THREE.ToneMapping;
    toneMappingExposure: number;
    powerPreference: WebGLPowerPreference;
    stencil: boolean;
  };
  shadowMap: {
    enabled: boolean;
    type: THREE.ShadowMapType;
  };
}

const TONE_MAPPING_EXPOSURE: Record<SceneLightingTier, number> = {
  high: 1.05,
  medium: 1.0,
  low: 0.95,
  off: 0.9,
};

const TIER_DPR: Record<SceneLightingTier, [number, number]> = {
  high: [1, 1.5],
  medium: [1, 1.25],
  low: [1, 1],
  off: [1, 1],
};

export function getSceneRendererConfig(tier: SceneLightingTier): SceneRendererConfig {
  return {
    dpr: TIER_DPR[tier],
    gl: {
      antialias: !LIGHTING_TIER_PRESETS[tier].postProcessing.smaa,
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: TONE_MAPPING_EXPOSURE[tier],
      powerPreference: 'high-performance',
      stencil: false,
    },
    shadowMap: {
      enabled: tier !== 'off',
      type: THREE.PCFSoftShadowMap,
    },
  };
}

export const SHADOW_NORMAL_BIAS = 0.04;
export const SHADOW_RADIUS = 4;
