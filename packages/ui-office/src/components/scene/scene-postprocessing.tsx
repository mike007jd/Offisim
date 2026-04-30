import { useEffect, useMemo, useState } from 'react';
import { LIGHTING_TIER_PRESETS } from './scene-performance-tier.js';
import type { SceneLightingTier } from './scene-performance-tier.js';

type PostprocessingModule = typeof import('@react-three/postprocessing');

// Module-singleton cache: subsequent ScenePostprocessing instances avoid both
// the dynamic-import round-trip and the extra setState that comes with it.
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

export function ScenePostprocessing({
  tier,
  enabled = true,
  cameraTarget: _cameraTarget = [0, 0, 2],
}: {
  tier: SceneLightingTier;
  enabled?: boolean;
  cameraTarget?: [number, number, number];
}) {
  const mode = enabled ? LIGHTING_TIER_PRESETS[tier].postProcessing : null;
  const [module, setModule] = useState<PostprocessingModule | null>(cachedModule);

  useEffect(() => {
    if (!mode || cachedModule) return;
    let mounted = true;
    loadPostprocessingModule().then((nextModule) => {
      if (mounted) setModule(nextModule);
    });
    return () => {
      mounted = false;
    };
  }, [mode]);

  const post = useMemo(() => {
    if (!mode || !module) return null;
    const { DepthOfField, EffectComposer, Vignette } = module;
    return (
      <EffectComposer multisampling={0}>
        {mode === 'dof+vignette' ? (
          <DepthOfField focusDistance={0.02} focalLength={0.05} bokehScale={2} />
        ) : (
          <></>
        )}
        <Vignette offset={0.4} darkness={0.35} eskil={false} />
      </EffectComposer>
    );
  }, [mode, module]);

  return post;
}
