import { EmissiveMaterial } from '../../theme/scene-materials.js';
import { useSceneColors } from '../../theme/use-scene-colors.js';
import { OFFICE_ROOM } from './scene-art-direction.js';
import { LIGHTING_TIER_PRESETS } from './scene-performance-tier.js';
import type { SceneLightingTier } from './scene-performance-tier.js';

const CEILING_PANEL_HEIGHT = OFFICE_ROOM.wallHeight - 0.15;
const CEILING_PANEL_WIDTH = 0.9;
const CEILING_PANEL_DEPTH = 2.6;

const CEILING_PANELS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -7, z: -3 },
  { x: 7, z: -3 },
  { x: -7, z: 5 },
  { x: 7, z: 5 },
] as const;

function CeilingLightCard({ x, z, castShadow }: { x: number; z: number; castShadow: boolean }) {
  const sc = useSceneColors();
  return (
    <group position={[x, CEILING_PANEL_HEIGHT, z]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CEILING_PANEL_WIDTH, CEILING_PANEL_DEPTH]} />
        <EmissiveMaterial color={sc.partition} tier="screen" intensity={0.42} />
      </mesh>
      <mesh position={[0, -0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CEILING_PANEL_WIDTH * 1.18, CEILING_PANEL_DEPTH * 1.06]} />
        <meshStandardMaterial color={sc.wallTrim} roughness={0.85} metalness={0} />
      </mesh>
      <spotLight
        position={[0, -0.05, 0]}
        target-position={[0, -CEILING_PANEL_HEIGHT, 0]}
        angle={0.75}
        penumbra={0.85}
        intensity={1.35}
        decay={1.6}
        distance={CEILING_PANEL_HEIGHT * 2.2}
        color={sc.partition}
        castShadow={castShadow}
        shadow-mapSize={[512, 512]}
      />
    </group>
  );
}

const WINDOW_SLASH_Y = 2.7;
const WINDOW_SLASH_WIDTH = 0.4;
const WINDOW_SLASH_HEIGHT = 2.2;
const WINDOW_SLASH_Z = -OFFICE_ROOM.depth / 2 + 0.18;
const WINDOW_SLASH_POSITIONS: ReadonlyArray<number> = [-9, 0, 9] as const;

const SUNLIGHT_COLOR = '#ffe1ad'; // raw-hex-allowed: deliberate warm sunlight tint

function WindowSlash({ x }: { x: number }) {
  return (
    <group position={[x, WINDOW_SLASH_Y, WINDOW_SLASH_Z]}>
      <mesh>
        <planeGeometry args={[WINDOW_SLASH_WIDTH, WINDOW_SLASH_HEIGHT]} />
        <EmissiveMaterial color={SUNLIGHT_COLOR} tier="signage" intensity={0.5} />
      </mesh>
      <spotLight
        position={[0, 0, 0.1]}
        target-position={[0, -WINDOW_SLASH_Y, 6]}
        angle={0.35}
        penumbra={0.7}
        intensity={0.65}
        decay={1.2}
        distance={28}
        color={SUNLIGHT_COLOR}
      />
    </group>
  );
}

/**
 * Hero lighting "where the light comes from" cards: ceiling emissive panels
 * with downward spot, plus back-wall window slashes throwing warm sun-light
 * floor patches. Bloom + N8AO pick them up for free. Tier-aware: low/off
 * skips spot lights to keep draw-call budget honest.
 */
export function SceneEnvironmentLights({ tier }: { tier: SceneLightingTier }) {
  if (tier === 'off') return null;
  const preset = LIGHTING_TIER_PRESETS[tier];
  // Only the highest tier carries shadow maps on the ceiling spot rig — 4 extra
  // shadow buffers crush perf in medium and below.
  const shadowsOnSpots = preset.shadowMapSize >= 2048;
  return (
    <group>
      {CEILING_PANELS.map((panel) => (
        <CeilingLightCard
          key={`ceiling-${panel.x}-${panel.z}`}
          x={panel.x}
          z={panel.z}
          castShadow={shadowsOnSpots}
        />
      ))}
      {WINDOW_SLASH_POSITIONS.map((x) => (
        <WindowSlash key={`window-slash-${x}`} x={x} />
      ))}
    </group>
  );
}
