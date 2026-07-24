/**
 * Rest & dining prefab dimensions — single numeric source for the 11 rest-area
 * prefabs (and the vending-machine approach anchor).
 *
 * The same constants feed three consumers so they can never diverge:
 *  - `prefab-spatial.ts` footprints (pathfinding obstacle + anti-overlap) use
 *    the `footprint*` fields, which equal the mesh's outer XZ half-extents;
 *  - dramaturgy `staging.ts` affordance anchors use the `*Offset` fields, so an
 *    actor always stages exactly where the mesh puts the seat/front;
 *  - the renderer mesh components (DecorativeMesh3D / RestAreaMesh3D /
 *    RestDiningMesh3D) build their geometry from the body fields.
 *
 * Units are 3D scene world units in prefab-local space (origin = prefab
 * center, front = +z). Seat tops honor the 1.62-body contract: chair top
 * 0.42, table surface 0.768.
 */

/** Chair seat top — the 1.62-unit toy body contract (office art bible §6). */
export const REST_SEAT_TOP_Y = 0.42;
/** Dining/cafe table surface height — aligned with the desk-top contract. */
export const REST_TABLE_SURFACE_Y = 0.768;

export const COFFEE_MACHINE_DIMENSIONS = Object.freeze({
  standWidth: 0.56,
  standDepth: 0.48,
  standHeight: 0.52,
  bodyWidth: 0.5,
  bodyDepth: 0.4,
  bodyHeight: 0.44,
  footprintHalfW: 0.3,
  footprintHalfD: 0.26,
  footprintPadding: 0.12,
  /** Standing spot in front of the dispenser. */
  approachOffset: Object.freeze([0, 0.62] as const),
});

export const PANTRY_COUNTER_DIMENSIONS = Object.freeze({
  counterWidth: 2.6,
  counterDepth: 0.62,
  counterHeight: 0.88,
  topThickness: 0.04,
  topOverhang: 0.04,
  footprintHalfW: 1.36,
  footprintHalfD: 0.37,
  footprintPadding: 0.14,
  /** Two standing spots along the counter front. */
  approachOffsets: Object.freeze([
    Object.freeze([-0.68, 0.7] as const),
    Object.freeze([0.68, 0.7] as const),
  ]),
});

export const SNACK_SHELF_DIMENSIONS = Object.freeze({
  shelfWidth: 0.9,
  shelfDepth: 0.48,
  shelfHeight: 1.5,
  panelThickness: 0.04,
  tierCount: 4,
  footprintHalfW: 0.48,
  footprintHalfD: 0.27,
  footprintPadding: 0.12,
  approachOffset: Object.freeze([0, 0.62] as const),
});

export const FRIDGE_DIMENSIONS = Object.freeze({
  bodyWidth: 0.72,
  bodyDepth: 0.66,
  bodyHeight: 1.5,
  doorThickness: 0.03,
  footprintHalfW: 0.38,
  footprintHalfD: 0.36,
  footprintPadding: 0.12,
  approachOffset: Object.freeze([0, 0.7] as const),
});

export const DINING_TABLE_4_DIMENSIONS = Object.freeze({
  topSize: 1.6,
  topThickness: 0.08,
  legThickness: 0.09,
  chairSeatWidth: 0.46,
  chairSeatDepth: 0.44,
  chairSeatThickness: 0.06,
  chairBackHeight: 0.5,
  chairBackThickness: 0.06,
  /** Seat center distance from prefab center on each of the four sides. */
  chairOffset: 1.14,
  footprintHalfW: 1.36,
  footprintHalfD: 1.36,
  footprintPadding: 0.16,
  /** One social seat per side, centered on each chair. */
  seatFrontOffset: Object.freeze([0, 1.14] as const),
  seatBackOffset: Object.freeze([0, -1.14] as const),
  seatRightOffset: Object.freeze([1.14, 0] as const),
  seatLeftOffset: Object.freeze([-1.14, 0] as const),
});

export const CAFE_TABLE_2_DIMENSIONS = Object.freeze({
  topRadius: 0.5,
  topThickness: 0.06,
  columnRadius: 0.05,
  baseRadius: 0.3,
  chairSeatWidth: 0.44,
  chairSeatDepth: 0.42,
  chairSeatThickness: 0.06,
  chairBackHeight: 0.46,
  chairBackThickness: 0.06,
  /** Seat center distance from prefab center on the two facing sides. */
  chairOffset: 1.05,
  footprintHalfW: 0.52,
  footprintHalfD: 1.27,
  footprintPadding: 0.14,
  seatFrontOffset: Object.freeze([0, 1.05] as const),
  seatBackOffset: Object.freeze([0, -1.05] as const),
});

export const SOFA_SINGLE_DIMENSIONS = Object.freeze({
  seatWidth: 0.86,
  seatDepth: 0.8,
  seatHeight: REST_SEAT_TOP_Y,
  backHeight: 0.5,
  backDepth: 0.24,
  armWidth: 0.18,
  armHeight: 0.24,
  footprintHalfW: 0.45,
  footprintHalfD: 0.42,
  footprintPadding: 0.12,
  /** 0.4 forward-of-center seat spot, matching the sofa-set precedent. */
  seatOffset: Object.freeze([0, 0.4] as const),
});

export const LOUNGE_BENCH_DIMENSIONS = Object.freeze({
  benchWidth: 1.8,
  benchDepth: 0.6,
  footHeight: 0.04,
  baseHeight: 0.28,
  cushionThickness: 0.1,
  footprintHalfW: 0.92,
  footprintHalfD: 0.33,
  footprintPadding: 0.12,
  seatOffsets: Object.freeze([
    Object.freeze([-0.45, 0.4] as const),
    Object.freeze([0.45, 0.4] as const),
  ]),
});

export const MAGAZINE_RACK_DIMENSIONS = Object.freeze({
  rackWidth: 0.6,
  rackDepth: 0.42,
  rackHeight: 1.2,
  panelThickness: 0.04,
  tierCount: 3,
  footprintHalfW: 0.33,
  footprintHalfD: 0.24,
  footprintPadding: 0.12,
  approachOffset: Object.freeze([0, 0.62] as const),
});

export const FLOOR_LAMP_DIMENSIONS = Object.freeze({
  baseRadius: 0.26,
  baseHeight: 0.05,
  poleHeight: 1.5,
  poleRadius: 0.03,
  shadeRadius: 0.3,
  shadeHeight: 0.32,
  footprintHalfW: 0.28,
  footprintHalfD: 0.28,
  footprintPadding: 0.12,
});

export const PLANT_MEDIUM_DIMENSIONS = Object.freeze({
  /** Rendered as the shared plant mesh at this scale (small 0.72 / large 1.35). */
  plantScale: 1.0,
  footprintHalfW: 0.62,
  footprintHalfD: 0.62,
  footprintPadding: 0.12,
});

/**
 * Standing spot in front of the existing vending machine mesh (body front at
 * local z = 0.31; the actor stages clear of the pickup tray at z = 0.33).
 */
export const VENDING_MACHINE_APPROACH_OFFSET = Object.freeze([0, 0.95] as const);
