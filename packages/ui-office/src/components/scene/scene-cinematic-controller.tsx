import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { CeremonyState } from '../../hooks/useSceneOrchestrator.js';
import { OFFICE_CAMERA_PRESET } from './scene-art-direction.js';
import type { SceneLightingTier } from './scene-performance-tier.js';
import { getSceneRendererConfig } from './scene-renderer-config.js';

const EXPOSURE_BY_PHASE: Record<CeremonyState['phase'], number> = {
  idle: 1.0,
  gathering: 1.02,
  analyzing: 0.96,
  planning: 0.95,
  dispatching: 1.04,
  working: 1.0,
  reporting: 1.08,
  dismissing: 0.98,
};

const FOV_BY_PHASE: Record<CeremonyState['phase'], number> = {
  idle: OFFICE_CAMERA_PRESET.fov,
  gathering: OFFICE_CAMERA_PRESET.fov - 2,
  analyzing: OFFICE_CAMERA_PRESET.fov - 3.5,
  planning: OFFICE_CAMERA_PRESET.fov - 4,
  dispatching: OFFICE_CAMERA_PRESET.fov + 2,
  working: OFFICE_CAMERA_PRESET.fov,
  reporting: OFFICE_CAMERA_PRESET.fov - 4,
  dismissing: OFFICE_CAMERA_PRESET.fov,
};

const EXPOSURE_LERP_PER_SECOND = 1.2;
const FOV_LERP_PER_SECOND = 0.9;

/**
 * Phase-aware cinematic controller: lerps tone-mapping exposure AND camera
 * FOV based on the ceremony phase, without touching position/target so the
 * user's OrbitControls stay authoritative.
 */
export function SceneCinematicController({
  ceremony,
  tier,
}: {
  ceremony: CeremonyState;
  tier: SceneLightingTier;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const baseExposure = getSceneRendererConfig(tier).gl.toneMappingExposure;
  const exposureTarget = baseExposure * EXPOSURE_BY_PHASE[ceremony.phase];
  const fovTarget = FOV_BY_PHASE[ceremony.phase];

  useFrame((_state, dt) => {
    const exposureStep = Math.min(1, dt * EXPOSURE_LERP_PER_SECOND);
    gl.toneMappingExposure += (exposureTarget - gl.toneMappingExposure) * exposureStep;

    if (camera instanceof THREE.PerspectiveCamera) {
      const fovStep = Math.min(1, dt * FOV_LERP_PER_SECOND);
      const next = camera.fov + (fovTarget - camera.fov) * fovStep;
      if (Math.abs(next - camera.fov) > 0.01) {
        camera.fov = next;
        camera.updateProjectionMatrix();
      }
    }
  });

  return null;
}
