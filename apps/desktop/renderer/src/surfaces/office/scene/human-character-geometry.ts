import { BufferGeometry, Color, Float32BufferAttribute } from 'three';

export interface SculptRing {
  readonly y: number;
  readonly rx: number;
  readonly rz: number;
  readonly z?: number;
}

const geometryCache = new Map<string, BufferGeometry>();

/**
 * Build and cache a closed elliptical ring surface. The independent x/z radii
 * and per-ring forward offset let the character form a real jaw, rib cage,
 * waist, calf and forearm silhouette instead of scaling capsules.
 */
export function sculptGeometry(
  key: string,
  rings: readonly SculptRing[],
  radialSegments = 24,
): BufferGeometry {
  const cached = geometryCache.get(key);
  if (cached) return cached;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    const ring = rings[ringIndex] as SculptRing;
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const t = segment / radialSegments;
      const angle = t * Math.PI * 2;
      positions.push(
        Math.cos(angle) * ring.rx,
        ring.y,
        (ring.z ?? 0) + Math.sin(angle) * ring.rz,
      );
      uvs.push(t, ringIndex / Math.max(1, rings.length - 1));
    }
  }

  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments;
      const a = ringIndex * radialSegments + segment;
      const b = (ringIndex + 1) * radialSegments + segment;
      const c = (ringIndex + 1) * radialSegments + next;
      const d = ringIndex * radialSegments + next;
      indices.push(a, b, d, b, c, d);
    }
  }

  const bottom = rings[0] as SculptRing;
  const top = rings[rings.length - 1] as SculptRing;
  const bottomCenter = positions.length / 3;
  positions.push(0, bottom.y, bottom.z ?? 0);
  uvs.push(0.5, 0);
  const topCenter = positions.length / 3;
  positions.push(0, top.y, top.z ?? 0);
  uvs.push(0.5, 1);
  const topStart = (rings.length - 1) * radialSegments;

  for (let segment = 0; segment < radialSegments; segment += 1) {
    const next = (segment + 1) % radialSegments;
    indices.push(bottomCenter, next, segment);
    indices.push(topCenter, topStart + segment, topStart + next);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.name = key;
  geometryCache.set(key, geometry);
  return geometry;
}

export function limbGeometry(
  key: string,
  length: number,
  top: readonly [number, number],
  middle: readonly [number, number],
  bottom: readonly [number, number],
): BufferGeometry {
  return sculptGeometry(
    key,
    [
      { y: 0, rx: top[0] * 0.74, rz: top[1] * 0.74 },
      { y: -length * 0.1, rx: top[0], rz: top[1] },
      { y: -length * 0.58, rx: middle[0], rz: middle[1], z: 0.004 },
      { y: -length * 0.92, rx: bottom[0], rz: bottom[1] },
      { y: -length, rx: bottom[0] * 0.7, rz: bottom[1] * 0.7 },
    ],
    20,
  );
}

export function darken(color: string, amount: number): string {
  return new Color(color).offsetHSL(0, -0.02, -amount).getStyle();
}

export function lighten(color: string, amount: number): string {
  return new Color(color).offsetHSL(0, -0.01, amount).getStyle();
}

export function alphaMaterial(opacity: number) {
  return opacity < 1 ? { transparent: true, opacity, depthWrite: false } : {};
}
