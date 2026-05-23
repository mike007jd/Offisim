import { useEffect, useMemo, useState } from 'react';
import { LIGHTING_TIER_PRESETS } from './scene-performance-tier.js';
import type { PostProcessingPreset, SceneLightingTier } from './scene-performance-tier.js';

type PostprocessingModule = typeof import('@react-three/postprocessing');

let cachedModule: PostprocessingModule | null = null;
let pendingImport: Promise<PostprocessingModule> | null = null;

function loadPostprocessingModule(): Promise<PostprocessingModule> {
  if (cachedModule) return Promise.resolve(cachedModule);
  pendingImport ??= import('@react-three/postprocessing').then((m) => {
    cachedModule = m;
    return m;
  });
  return pendingImport;
}

function isPostActive(preset: PostProcessingPreset): boolean {
  return (
    preset.ssao ||
    preset.bloom ||
    preset.vignette ||
    preset.cinematicDof ||
    preset.smaa ||
    preset.grade ||
    preset.filmGrain ||
    preset.chromaticAberration
  );
}

export function ScenePostprocessing({
  tier,
  enabled = true,
}: {
  tier: SceneLightingTier;
  enabled?: boolean;
}) {
  const preset = enabled ? LIGHTING_TIER_PRESETS[tier].postProcessing : null;
  const active = preset !== null && isPostActive(preset);
  const [module, setModule] = useState<PostprocessingModule | null>(cachedModule);

  useEffect(() => {
    if (!active || cachedModule) return;
    let mounted = true;
    loadPostprocessingModule().then((nextModule) => {
      if (mounted) setModule(nextModule);
    });
    return () => {
      mounted = false;
    };
  }, [active]);

  return useMemo(() => {
    if (!active || !preset || !module) return null;
    const {
      Bloom,
      BrightnessContrast,
      ChromaticAberration,
      DepthOfField,
      EffectComposer,
      HueSaturation,
      N8AO,
      Noise,
      SMAA,
      Vignette,
    } = module;
    const aoQuality = tier === 'off' ? 'low' : tier;
    const empty = <></>;
    return (
      <EffectComposer multisampling={preset.multisampling}>
        {preset.ssao ? (
          <N8AO
            quality={aoQuality}
            aoRadius={1.2}
            intensity={1.45}
            distanceFalloff={0.72}
            color="#273242"
          />
        ) : (
          empty
        )}
        {preset.bloom ? (
          <Bloom
            mipmapBlur
            intensity={0.16}
            luminanceThreshold={1.15}
            luminanceSmoothing={0.08}
            radius={0.34}
          />
        ) : (
          empty
        )}
        {preset.cinematicDof ? (
          <DepthOfField focusDistance={0.02} focalLength={0.05} bokehScale={2} />
        ) : (
          empty
        )}
        {preset.grade ? <HueSaturation hue={0} saturation={0.08} /> : empty}
        {preset.grade ? <BrightnessContrast brightness={0.0} contrast={0.06} /> : empty}
        {preset.chromaticAberration ? <ChromaticAberration offset={[0.0006, 0.0006]} /> : empty}
        {preset.vignette ? <Vignette offset={0.32} darkness={0.42} eskil={false} /> : empty}
        {preset.filmGrain ? <Noise opacity={0.03} premultiply /> : empty}
        {preset.smaa ? <SMAA /> : empty}
      </EffectComposer>
    );
  }, [active, preset, module, tier]);
}
