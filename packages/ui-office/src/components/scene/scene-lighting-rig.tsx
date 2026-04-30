import { DARK_SEMANTIC_COLORS } from '@offisim/ui-core/tokens';
import { Environment } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { computeShadowBias } from '../../lib/shadow-bias.js';
import type { AgentState } from '../../runtime/use-agent-states.js';
import { AmbientStateLight } from './office3d-scene-primitives.js';
import { LIGHTING_TIER_PRESETS } from './scene-performance-tier.js';
import type { getDevLightingOverrides } from './scene-performance-tier.js';
import type { SceneLightingTier } from './scene-performance-tier.js';

const LIGHT_COLORS = {
  hemisphereSky: '#ffe9c8', // raw-hex-allowed
  hemisphereGround: '#1a2030', // raw-hex-allowed
  key: '#fffaf0', // raw-hex-allowed
  sideFill: '#9bb4d4', // raw-hex-allowed
  rim: '#7e90b8', // raw-hex-allowed
  bounceFront: '#ffe1bf', // raw-hex-allowed
  bounceBack: '#cfd8e8', // raw-hex-allowed
  ambientDefault: '#ffffff', // raw-hex-allowed
} as const; // raw-hex-allowed

function RigAmbientStateLight() {
  const lightRef = useRef<THREE.AmbientLight>(null);
  const fallbackColor = useRef(new THREE.Color(LIGHT_COLORS.ambientDefault));

  useFrame((state) => {
    if (!lightRef.current) return;
    const userData = state.scene.userData as {
      ambientStateColor?: THREE.Color | string;
      ambientStateIntensity?: number;
    };
    const color =
      userData.ambientStateColor instanceof THREE.Color
        ? userData.ambientStateColor
        : userData.ambientStateColor
          ? new THREE.Color(userData.ambientStateColor)
          : fallbackColor.current;
    lightRef.current.color.copy(color);
    lightRef.current.intensity = Math.min(0.25, userData.ambientStateIntensity ?? 0.2);
  });

  return <ambientLight ref={lightRef} color={LIGHT_COLORS.ambientDefault} intensity={0.2} />;
}

export function SceneLightingRig({
  tier,
  agents,
  devOverrides,
}: {
  tier: SceneLightingTier;
  agents: Map<string, AgentState>;
  devOverrides?: ReturnType<typeof getDevLightingOverrides>;
}) {
  const preset = LIGHTING_TIER_PRESETS[tier];
  const shadowsEnabled = (devOverrides?.shadows ?? true) && preset.shadowMapSize > 0;
  const hemisphereIntensity = devOverrides?.hemi ?? preset.hemisphereIntensity;
  const environmentEnabled = devOverrides?.env ?? preset.envMapPreset != null;

  return (
    <>
      <hemisphereLight
        args={[LIGHT_COLORS.hemisphereSky, LIGHT_COLORS.hemisphereGround, hemisphereIntensity]}
        intensity={hemisphereIntensity}
      />
      <directionalLight
        castShadow={shadowsEnabled}
        position={[12, 25, 12]}
        intensity={1.6}
        color={LIGHT_COLORS.key}
        shadow-mapSize={[preset.shadowMapSize, preset.shadowMapSize]}
        shadow-bias={computeShadowBias({ lightDistance: 28, sceneScale: 1 })}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      <directionalLight position={[-15, 12, -10]} intensity={0.45} color={LIGHT_COLORS.sideFill} />
      <directionalLight position={[5, 8, -18]} intensity={0.35} color={LIGHT_COLORS.rim} />
      {preset.bounceSpotlightCount >= 1 && (
        <spotLight
          position={[0, 6, 14]}
          angle={0.45}
          penumbra={0.6}
          intensity={0.4}
          color={LIGHT_COLORS.bounceFront}
          decay={1.5}
        />
      )}
      {preset.bounceSpotlightCount >= 2 && (
        <spotLight
          position={[0, 6, -14]}
          angle={0.4}
          penumbra={0.7}
          intensity={0.3}
          color={LIGHT_COLORS.bounceBack}
          decay={1.5}
        />
      )}
      {environmentEnabled && <Environment preset={preset.envMapPreset ?? 'apartment'} />}
      <AmbientStateLight agents={agents} maxIntensity={0.25} />
      <RigAmbientStateLight />
      <fog attach="fog" args={[DARK_SEMANTIC_COLORS.surface, 20, 120]} />
    </>
  );
}
