import { prefabPlacementBounds } from '@offisim/shared-types';
import { type Camera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { ZoneDef } from './scene-layout.js';

/** A ground-plane hit in stored/world coordinates, plus the zone under it. */
export interface ScenePlacementPoint {
  readonly x: number;
  readonly z: number;
  readonly zoneId: string | null;
}

export const GRID_SNAP = 0.5;

export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SNAP) * GRID_SNAP;
}

export function hitTestZone(zones: readonly ZoneDef[], x: number, z: number): ZoneDef | null {
  for (const zone of zones) {
    if (
      x >= zone.cx - zone.w / 2 &&
      x <= zone.cx + zone.w / 2 &&
      z >= zone.cz - zone.d / 2 &&
      z <= zone.cz + zone.d / 2
    ) {
      return zone;
    }
  }
  return null;
}

// Scratch singletons: this runs at pointer-event rate during drags, so avoid
// re-allocating raycaster/plane/vector objects per call (single-threaded use).
const SCRATCH_RAYCASTER = new Raycaster();
const SCRATCH_FLOOR = new Plane(new Vector3(0, 1, 0), 0);
const SCRATCH_NDC = new Vector2();
const SCRATCH_HIT = new Vector3();

/** Raycast a client-space pointer position onto the y=0 floor plane. */
export function groundPointFromClient(
  clientX: number,
  clientY: number,
  element: HTMLCanvasElement,
  camera: Camera,
  zones: readonly ZoneDef[],
): ScenePlacementPoint | null {
  const rect = element.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null;
  }
  SCRATCH_NDC.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  SCRATCH_RAYCASTER.setFromCamera(SCRATCH_NDC, camera);
  if (!SCRATCH_RAYCASTER.ray.intersectPlane(SCRATCH_FLOOR, SCRATCH_HIT)) return null;
  const { x, z } = SCRATCH_HIT;
  return { x, z, zoneId: hitTestZone(zones, x, z)?.id ?? null };
}

/** Clamp a prefab center so its placement bounds stay inside the zone rect —
 *  moving an object never rejects, it pins at the zone edge. Overlap between
 *  placed objects is the editor's choice. */
export function clampPrefabCenter(
  x: number,
  z: number,
  prefab: { prefabId: string; rotation: 0 | 90 | 180 | 270; gridSize?: readonly [number, number] },
  zone: Pick<ZoneDef, 'cx' | 'cz' | 'w' | 'd'>,
): { x: number; z: number } {
  const bounds = prefabPlacementBounds({
    prefabId: prefab.prefabId,
    x,
    z,
    rotation: prefab.rotation,
    gridSize: prefab.gridSize,
  });
  const minX = zone.cx - zone.w / 2 + (x - bounds.minX);
  const maxX = zone.cx + zone.w / 2 - (bounds.maxX - x);
  const minZ = zone.cz - zone.d / 2 + (z - bounds.minZ);
  const maxZ = zone.cz + zone.d / 2 - (bounds.maxZ - z);
  return {
    x: minX > maxX ? zone.cx : Math.min(maxX, Math.max(minX, x)),
    z: minZ > maxZ ? zone.cz : Math.min(maxZ, Math.max(minZ, z)),
  };
}
