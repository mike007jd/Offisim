import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ZoneDef } from '../scene-layout.js';
import { LIGHT_SCENE_3D } from './scene-colors.js';
import { SceneMaterial } from './scene-materials.js';

export const DIORAMA_FLOOR_PROP_MIN = 50;
export const DIORAMA_FLOOR_PROP_MAX = 100;

interface DressingPoint {
  readonly x: number;
  readonly z: number;
  readonly rotation: number;
}

const DRESSING_SLOTS = [
  { xSide: -1, zSide: -1, rotationOffset: 0 },
  { xSide: 1, zSide: 1, rotationOffset: Math.PI },
  { xSide: -1, zSide: 1, rotationOffset: Math.PI / 2 },
  { xSide: 1, zSide: -1, rotationOffset: -Math.PI / 2 },
] as const;

export const DIORAMA_DRESSING_PROPS_PER_ZONE = DRESSING_SLOTS.length;

export function dioramaDressingPropBudget(zoneCount: number, prefabCount: number): number {
  return Math.max(
    0,
    Math.min(zoneCount * DIORAMA_DRESSING_PROPS_PER_ZONE, DIORAMA_FLOOR_PROP_MAX - prefabCount),
  );
}

export function buildDioramaDressingPoints(
  zones: readonly ZoneDef[],
  prefabCount: number,
): readonly DressingPoint[] {
  const points = zones.flatMap((zone, zoneIndex) => {
    const inset = 0.5;
    const flip = zoneIndex % 2 === 0 ? 1 : -1;
    return DRESSING_SLOTS.map((slot, slotIndex) => ({
      x: zone.cx + slot.xSide * (zone.w / 2 - inset),
      z: zone.cz + slot.zSide * (zone.d / 2 - inset) * flip,
      rotation: zoneIndex * (slotIndex < 2 ? 0.37 : 0.51) + slot.rotationOffset,
    }));
  });
  return points.slice(0, dioramaDressingPropBudget(zones.length, prefabCount));
}

export function countDioramaFloorProps(zones: readonly ZoneDef[], prefabCount: number): number {
  return prefabCount + buildDioramaDressingPoints(zones, prefabCount).length;
}

function useInstanceMatrices(
  ref: React.RefObject<THREE.InstancedMesh | null>,
  points: readonly DressingPoint[],
  y: number,
  scale: [number, number, number],
) {
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const size = new THREE.Vector3(...scale);
    const euler = new THREE.Euler();
    points.forEach((point, index) => {
      position.set(point.x, y, point.z);
      euler.set(0, point.rotation, 0);
      quaternion.setFromEuler(euler);
      matrix.compose(position, quaternion, size);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [points, ref, scale, y]);
}

/** Up to four low edge props per zone, capped by the global 100-prop budget.
 * Repeated pots, foliage, marker bodies and caps are four instanced draw calls
 * regardless of company size. They enrich the open floor without becoming
 * semantic interaction anchors or tall occluders. */
export const DioramaDressing = memo(function DioramaDressing({
  zones,
  prefabCount,
}: {
  zones: readonly ZoneDef[];
  prefabCount: number;
}) {
  const points = useMemo(
    () => buildDioramaDressingPoints(zones, prefabCount),
    [prefabCount, zones],
  );
  const planterPoints = useMemo(() => points.filter((_, index) => index % 2 === 0), [points]);
  const markerPoints = useMemo(() => points.filter((_, index) => index % 2 === 1), [points]);
  const pots = useRef<THREE.InstancedMesh>(null);
  const foliage = useRef<THREE.InstancedMesh>(null);
  const markers = useRef<THREE.InstancedMesh>(null);
  const markerCaps = useRef<THREE.InstancedMesh>(null);

  useInstanceMatrices(pots, planterPoints, 0.18, [1, 1, 1]);
  useInstanceMatrices(foliage, planterPoints, 0.48, [1, 1, 1]);
  useInstanceMatrices(markers, markerPoints, 0.18, [1, 1, 1]);
  useInstanceMatrices(markerCaps, markerPoints, 0.38, [1, 1, 1]);

  return (
    <group>
      <instancedMesh ref={pots} args={[undefined, undefined, planterPoints.length]} castShadow>
        <cylinderGeometry args={[0.22, 0.27, 0.34, 12]} />
        <SceneMaterial materialClass="ceramic" color={LIGHT_SCENE_3D.accentWarm} />
      </instancedMesh>
      <instancedMesh ref={foliage} args={[undefined, undefined, planterPoints.length]} castShadow>
        <dodecahedronGeometry args={[0.29, 0]} />
        <SceneMaterial materialClass="fabric" color={LIGHT_SCENE_3D.leafPrimary} />
      </instancedMesh>
      <instancedMesh ref={markers} args={[undefined, undefined, markerPoints.length]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 0.36, 10]} />
        <SceneMaterial materialClass="metal-brushed" color={LIGHT_SCENE_3D.furnitureDark} />
      </instancedMesh>
      <instancedMesh ref={markerCaps} args={[undefined, undefined, markerPoints.length]} castShadow>
        <sphereGeometry args={[0.12, 10, 8]} />
        <SceneMaterial materialClass="ceramic" color={LIGHT_SCENE_3D.accentCool} />
      </instancedMesh>
    </group>
  );
});
