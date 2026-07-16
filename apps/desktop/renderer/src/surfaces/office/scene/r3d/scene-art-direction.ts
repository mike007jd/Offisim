import type { Scene3DColors } from './scene-colors.js';

/** Cubic workspace: square footprint (contains the template-seeded zone layout,
 *  which spans ~±20 world units) so it reads as a square room in a square viewport. */
const ROOM_WIDTH = 42;
const ROOM_DEPTH = 42;

export const OFFICE_ROOM = {
  width: ROOM_WIDTH,
  depth: ROOM_DEPTH,
  tileSize: 2,
} as const;

export const OFFICE_PLINTH = {
  baseHeight: 0.52,
  baseCenterY: -0.4,
  lipHeight: 0.14,
  lipCenterY: -0.07,
  floorY: 0.001,
} as const;

/**
 * Keep the perspective depth range tight around the complete diorama. A
 * bounded ratio preserves depth-buffer precision at the low, distant orbit
 * angles where coplanar-looking surfaces used to flicker.
 */
export const OFFICE_CAMERA_DEPTH = {
  near: 0.75,
  far: 180,
} as const;

/** Default office framing — a lower, closer hero 3/4 view (not the old high
 *  top-down). The camera is now a FREE orbit (rotate + pan + zoom), so this is
 *  just the opening shot; the clamps below keep the user above the floor and
 *  inside a sensible zoom band while letting them get close enough to read the
 *  furniture detail and circle the room. */
export const OFFICE_CAMERA_PRESET = {
  position: [2.8, 15.8, 26.2] as [number, number, number],
  target: [0.15, 1.3, 1.1] as [number, number, number],
  fov: 37,
  minDistance: 8.5,
  maxDistance: 72,
  /** Polar clamps for the free orbit: ~10° off straight-down to ~6° above the
   *  horizon, so you can swoop low for a hero angle but never dip under the
   *  floor plane. */
  minPolarAngle: 0.16,
  maxPolarAngle: 1.46,
} as const;

/** Global multiplier applied to placed furniture + employees in the 3D scene so
 *  each piece reads bigger and more present ("大而精致"). Kept modest because the
 *  seeded zone layouts pack pieces fairly tightly; the closer free camera does
 *  the rest of the "make it big" work without overlapping neighbours.
 *
 *  Cross-package coupling: the seeded prefab spacing in
 *  `@offisim/shared-types` `system-zone-prefab-layout.ts` is widened to leave
 *  room for this factor. If you raise this, re-check that layout's neighbour
 *  gaps so enlarged pieces don't overlap (there is no automated guard). */
export const SCENE_CONTENT_SCALE = 1.18;

export const SCENE_LAYER_Y = {
  floor: OFFICE_PLINTH.floorY,
  floorOverlay: OFFICE_PLINTH.floorY,
  zoneRug: OFFICE_PLINTH.floorY,
  zoneBorder: 0.05,
  dragGhost: 0.06,
} as const;

/** Physically stacked rug profile: the base top is exactly the inset bottom. */
export const ZONE_RUG_PROFILE = {
  baseHeight: 0.018,
  baseCenterY: SCENE_LAYER_Y.zoneRug + 0.009,
  insetHeight: 0.022,
  insetCenterY: SCENE_LAYER_Y.zoneRug + 0.018 + 0.011,
  topY: SCENE_LAYER_Y.zoneRug + 0.04,
} as const;

/** Ground-contact Y authored inside a prefab before SCENE_CONTENT_SCALE is applied. */
export const PREFAB_LOCAL_GROUND_Y = ZONE_RUG_PROFILE.topY / SCENE_CONTENT_SCALE;

/** Floor decoration is a non-depth-writing overlay, ordered after the floor. */
export const FLOOR_RENDER_ORDER = {
  floor: -30,
  bands: -29,
  minorGrid: -28,
  majorGrid: -27,
} as const;

/** `opacity` is the color-mix weight baked into each opaque overlay; it is not
 * runtime alpha, so the floor pass stays ahead of furniture in the render list. */
export const FLOOR_BANDS = [
  {
    id: 'central-runway',
    widthOffset: 2.2,
    depth: 5.2,
    z: 0,
    colorToken: 'floorTileAlt',
    opacity: 0.34,
    roughness: 0.62,
  },
  {
    id: 'back-service-band',
    widthOffset: 3.4,
    depth: 3.6,
    z: -8.4,
    colorToken: 'floorTileAlt',
    opacity: 0.22,
    roughness: 0.62,
  },
  {
    id: 'front-threshold',
    widthOffset: 1.5,
    depth: 1.2,
    z: 13.5,
    colorToken: 'floorBorder',
    opacity: 0.24,
    roughness: 0.68,
  },
] as const satisfies readonly {
  id: string;
  widthOffset: number;
  depth: number;
  z: number;
  colorToken: keyof Scene3DColors;
  opacity: number;
  roughness: number;
}[];

export const ROOM_GRID = {
  minorStep: OFFICE_ROOM.tileSize,
  majorStep: 10,
  minorOpacity: 0.18,
  majorOpacity: 0.22,
} as const;

export function createTileLineColor(sc: Scene3DColors, emphasis: 'major' | 'minor') {
  return emphasis === 'major' ? sc.floorBorder : sc.floorGrid;
}
