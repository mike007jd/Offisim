import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { OFFICE_ROOM } from './scene-art-direction.js';
import type { SceneLightingTier } from './scene-performance-tier.js';

const PARTICLE_COUNT_BY_TIER: Record<SceneLightingTier, number> = {
  high: 320,
  medium: 180,
  low: 0,
  off: 0,
};

const DUST_COLOR = '#fff4d8'; // raw-hex-allowed: warm dust mote tint paired with sunlight slashes
const DUST_SIZE = 0.045;
const DUST_VOLUME_HEIGHT = 4.6;
const DUST_DRIFT_SPEED = 0.06;

function buildPositions(count: number): Float32Array {
  const positions = new Float32Array(count * 3);
  const halfW = OFFICE_ROOM.width / 2 - 1;
  const halfD = OFFICE_ROOM.depth / 2 - 1;
  for (let i = 0; i < count; i += 1) {
    positions[i * 3 + 0] = (Math.random() * 2 - 1) * halfW;
    positions[i * 3 + 1] = 0.5 + Math.random() * DUST_VOLUME_HEIGHT;
    positions[i * 3 + 2] = (Math.random() * 2 - 1) * halfD;
  }
  return positions;
}

function buildSeeds(count: number): Float32Array {
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    seeds[i] = Math.random() * 6.283;
  }
  return seeds;
}

/**
 * Volumetric-hint dust layer: instanced point sprites that drift slowly within
 * the room AABB. Per-particle phase keeps motion organic. Tier-aware count
 * (320 / 180 / 0 / 0) — low/off skip the layer entirely.
 */
export function SceneDustParticles({
  tier,
  animate = true,
}: {
  tier: SceneLightingTier;
  animate?: boolean;
}) {
  const count = PARTICLE_COUNT_BY_TIER[tier];
  const positions = useMemo(() => buildPositions(count), [count]);
  const seeds = useMemo(() => buildSeeds(count), [count]);
  const basePositionsRef = useRef(positions);
  const seedsRef = useRef(seeds);
  const geomRef = useRef<THREE.BufferGeometry>(null);

  useEffect(() => {
    basePositionsRef.current = positions;
    seedsRef.current = seeds;
  }, [positions, seeds]);

  useFrame((state) => {
    if (!animate) return;
    const geom = geomRef.current;
    if (!geom || count === 0) return;
    const attr = geom.attributes.position as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const t = state.clock.elapsedTime;
    const base = basePositionsRef.current;
    const ss = seedsRef.current;
    for (let i = 0; i < count; i += 1) {
      const seed = ss[i] ?? 0;
      const i3 = i * 3;
      attr.array[i3 + 0] = (base[i3 + 0] ?? 0) + Math.sin(t * 0.18 + seed) * 0.42;
      attr.array[i3 + 1] = (base[i3 + 1] ?? 0) + Math.sin(t * DUST_DRIFT_SPEED + seed * 1.3) * 0.34;
      attr.array[i3 + 2] = (base[i3 + 2] ?? 0) + Math.cos(t * 0.16 + seed * 0.7) * 0.42;
    }
    attr.needsUpdate = true;
  });

  if (count === 0) return null;
  return (
    <points frustumCulled={false}>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={DUST_SIZE}
        sizeAttenuation
        color={DUST_COLOR}
        transparent
        opacity={0.42}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}
