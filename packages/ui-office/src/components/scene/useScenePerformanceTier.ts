import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { getDevTierOverride } from './scene-performance-tier.js';
import type { SceneLightingTier } from './scene-performance-tier.js';

const FRAME_WINDOW = 60;
const UPGRADE_FRAMES = 90;
/**
 * Symmetric hysteresis on the downgrade direction. Without this, a single
 * sub-threshold FPS sample (typical during a fast camera-orbit drag) fired
 * `setTier(candidate)` instantly and stripped env map / spotlights /
 * postprocessing for ~1.5 s until the upgrade window recovered — visible
 * mid-rotation as a desaturated floor and dimmer hemisphere. 30 frames ≈
 * 0.5 s @ 60 fps stays well below the 90-frame upgrade so genuine sustained
 * slowdowns still react within a second.
 */
const DOWNGRADE_FRAMES = 30;
const OFF_FALLBACK_MS = 3000;
const FPS_REPORT_INTERVAL_MS = 250;

function candidateTier(fps: number): SceneLightingTier {
  if (fps >= 50) return 'high';
  if (fps >= 30) return 'medium';
  if (fps >= 15) return 'low';
  return 'off';
}

const TIER_RANK: Record<SceneLightingTier, number> = {
  off: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function rank(tier: SceneLightingTier): number {
  return TIER_RANK[tier];
}

export function useScenePerformanceTier({
  enabled = true,
  requestForce2D,
}: {
  enabled?: boolean;
  requestForce2D?: () => void;
} = {}): {
  tier: SceneLightingTier;
  sampledFps: number;
  isOverridden: boolean;
} {
  const scene = useThree((state) => state.scene);
  const [tier, setTier] = useState<SceneLightingTier>(() => getDevTierOverride() ?? 'high');
  const [sampledFps, setSampledFps] = useState(0);
  const [override, setOverride] = useState<SceneLightingTier | null>(() => getDevTierOverride());
  const frameTimesRef = useRef<number[]>([]);
  const upgradeFramesRef = useRef(0);
  const downgradeFramesRef = useRef(0);
  const offSinceRef = useRef<number | null>(null);
  const lastFpsReportRef = useRef({ value: 0, at: 0 });

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onReset = () => setOverride(getDevTierOverride());
    window.addEventListener('offisim.scene.devOverride.reset', onReset);
    window.addEventListener('offisim.scene.devOverride.change', onReset);
    window.addEventListener('storage', onReset);
    return () => {
      window.removeEventListener('offisim.scene.devOverride.reset', onReset);
      window.removeEventListener('offisim.scene.devOverride.change', onReset);
      window.removeEventListener('storage', onReset);
    };
  }, []);

  useEffect(() => {
    if (enabled) return;
    frameTimesRef.current = [];
    upgradeFramesRef.current = 0;
    downgradeFramesRef.current = 0;
    offSinceRef.current = null;
    lastFpsReportRef.current = { value: 0, at: 0 };
    setSampledFps(0);
  }, [enabled]);

  useFrame((_state, delta) => {
    const nextOverride = getDevTierOverride();
    if (nextOverride !== override) setOverride(nextOverride);
    if (nextOverride) {
      if (tier !== nextOverride) setTier(nextOverride);
      return;
    }
    if (!enabled) return;

    const frameTimes = frameTimesRef.current;
    frameTimes.push(delta * 1000);
    if (frameTimes.length > FRAME_WINDOW) frameTimes.shift();
    if (frameTimes.length < FRAME_WINDOW) return;

    const sum = frameTimes.reduce((acc, value) => acc + value, 0);
    const fps = (FRAME_WINDOW * 1000) / sum;
    const now = performance.now();
    const reportedFps = Math.round(fps);
    const lastReport = lastFpsReportRef.current;
    if (lastReport.at === 0 || now - lastReport.at >= FPS_REPORT_INTERVAL_MS) {
      if (lastReport.value !== reportedFps) {
        lastFpsReportRef.current = { value: reportedFps, at: now };
        setSampledFps(reportedFps);
      } else {
        lastReport.at = now;
      }
    }
    const candidate = candidateTier(fps);

    if (candidate === 'off') {
      offSinceRef.current ??= now;
      if (now - offSinceRef.current >= OFF_FALLBACK_MS) {
        requestForce2D?.();
      }
    } else {
      offSinceRef.current = null;
    }

    if (rank(candidate) < rank(tier)) {
      upgradeFramesRef.current = 0;
      downgradeFramesRef.current += 1;
      if (downgradeFramesRef.current >= DOWNGRADE_FRAMES) {
        downgradeFramesRef.current = 0;
        setTier(candidate);
      }
      return;
    }
    if (rank(candidate) > rank(tier)) {
      downgradeFramesRef.current = 0;
      upgradeFramesRef.current += 1;
      if (upgradeFramesRef.current >= UPGRADE_FRAMES) {
        upgradeFramesRef.current = 0;
        setTier(candidate);
      }
      return;
    }
    upgradeFramesRef.current = 0;
    downgradeFramesRef.current = 0;
  });

  // Mirror current tier into scene.userData so DevLightingPanel and external
  // debug overlays can read it without subscribing. Effect (not render-body)
  // keeps render pure and avoids StrictMode double-mutate.
  useEffect(() => {
    if (!scene) return;
    scene.userData.sceneTierDebug = {
      tier: override ?? tier,
      sampledFps,
      isOverridden: override !== null,
    };
  }, [scene, tier, sampledFps, override]);

  return { tier: override ?? tier, sampledFps, isOverridden: override !== null };
}
