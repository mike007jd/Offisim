import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { computeShadowBias } from '../../lib/shadow-bias.js';
import type { AgentState } from '../../runtime/use-agent-states.js';
import { useTheme } from '../../theme/theme-provider.js';
import { useSceneColors } from '../../theme/use-scene-colors.js';
import { AmbientStateLight } from './office3d-scene-primitives.js';
import { LIGHTING_TIER_PRESETS } from './scene-performance-tier.js';
import type { getDevLightingOverrides } from './scene-performance-tier.js';
import type { SceneLightingTier } from './scene-performance-tier.js';
import { SHADOW_NORMAL_BIAS, SHADOW_RADIUS } from './scene-renderer-config.js';
import { useProceduralRoomEnvironment } from './use-procedural-room-environment.js';

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
  const sceneColors = useSceneColors();
  const { resolvedTheme } = useTheme();
  const preset = LIGHTING_TIER_PRESETS[tier];
  const shadowsEnabled = (devOverrides?.shadows ?? true) && preset.shadowMapSize > 0;
  const hemisphereIntensity =
    devOverrides?.hemi ??
    (resolvedTheme === 'light'
      ? Math.max(0.32, preset.hemisphereIntensity * 0.58)
      : preset.hemisphereIntensity * 0.9);
  const keyIntensity = resolvedTheme === 'light' ? 1.35 : 2.2;
  const fillIntensity = resolvedTheme === 'light' ? 0.24 : 0.48;
  const rimIntensity = resolvedTheme === 'light' ? 0.18 : 0.46;
  const fogNear = resolvedTheme === 'light' ? 48 : 24;
  const fogFar = resolvedTheme === 'light' ? 160 : 130;
  const environmentEnabled =
    devOverrides?.env ?? (resolvedTheme === 'dark' && preset.envMapPreset != null);

  useProceduralRoomEnvironment(environmentEnabled);

  return (
    <>
      <hemisphereLight
        args={[LIGHT_COLORS.hemisphereSky, LIGHT_COLORS.hemisphereGround, hemisphereIntensity]}
        intensity={hemisphereIntensity}
      />
      <directionalLight
        castShadow={shadowsEnabled}
        position={[12, 25, 12]}
        intensity={keyIntensity}
        color={LIGHT_COLORS.key}
        shadow-mapSize={[preset.shadowMapSize, preset.shadowMapSize]}
        shadow-bias={computeShadowBias({ lightDistance: 28, sceneScale: 1 })}
        shadow-normalBias={SHADOW_NORMAL_BIAS}
        shadow-radius={SHADOW_RADIUS}
        shadow-camera-near={0.5}
        shadow-camera-far={80}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      <directionalLight
        position={[-15, 12, -10]}
        intensity={fillIntensity}
        color={LIGHT_COLORS.sideFill}
      />
      <directionalLight position={[5, 8, -18]} intensity={rimIntensity} color={LIGHT_COLORS.rim} />
      {preset.bounceSpotlightCount >= 1 && (
        <spotLight
          position={[0, 6, 14]}
          angle={0.45}
          penumbra={0.6}
          intensity={resolvedTheme === 'light' ? 0.18 : 0.32}
          color={LIGHT_COLORS.bounceFront}
          decay={1.5}
        />
      )}
      {preset.bounceSpotlightCount >= 2 && (
        <spotLight
          position={[0, 6, -14]}
          angle={0.4}
          penumbra={0.7}
          intensity={resolvedTheme === 'light' ? 0.12 : 0.24}
          color={LIGHT_COLORS.bounceBack}
          decay={1.5}
        />
      )}
      <AmbientStateLight agents={agents} maxIntensity={0.25} />
      <RigAmbientStateLight />
      <fog attach="fog" args={[sceneColors.sceneBackground, fogNear, fogFar]} />
    </>
  );
}
