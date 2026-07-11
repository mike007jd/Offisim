/**
 * Workstation seat geometry shared by the 3D mesh (WorkstationUnit3D renders
 * the chairs) and the seat planner (scene-layout anchors seated employees into
 * those chairs). Single source so a desk or chair tweak cannot silently strand
 * seated characters. Deliberately three-free: scene-layout is consumed by the
 * 2D scene too.
 */

import toyMetrics from './toy-performance-metrics.json';

/** Desk depth (prefab-local z) per workstation variant. */
export const WORKSTATION_DESK_DEPTH = {
  ...toyMetrics.workstation.deskDepth,
} as const;

/** Seat lane x-offsets — dual workstations seat two, others one. */
export const WORKSTATION_DUAL_LANES: readonly number[] = [-0.56, 0.56];
export const WORKSTATION_SINGLE_LANES: readonly number[] = [0];

/** The chair centre sits this far past the desk edge (z = deskDepth / 2 + this). */
export const WORKSTATION_CHAIR_FORWARD = toyMetrics.workstation.chairForward;

/** Seated characters land slightly inside the chair centre (CHAIR_FORWARD minus
 *  a sit-into delta) so they read as sitting in the chair, not on its edge. */
export const WORKSTATION_SEAT_FORWARD = toyMetrics.workstation.seatForward;

/**
 * P0 toy-character metric contract. Character normalization, seated offsets,
 * and the canonical workstation's vertical geometry consume these values so a
 * body-proportion change cannot leave the chair/desk at unrelated heights.
 * P6 extends this same contract to the remaining furniture and obstacles.
 */
export const OFFICE_CHARACTER_METRICS = toyMetrics.character;

const { workstation } = toyMetrics;

export const WORKSTATION_VERTICAL_METRICS = {
  seatTop: workstation.seatTop,
  chairCushionWidth: workstation.chairCushionWidth,
  chairCushionDepth: workstation.chairCushionDepth,
  chairCushionThickness: workstation.chairCushionThickness,
  chairCushionRadius: workstation.chairCushionRadius,
  chairCushionCenter: workstation.seatTop - workstation.chairCushionThickness / 2,
  deskTop: workstation.deskTop,
  deskTopThickness: workstation.deskTopThickness,
  deskTopCenter: workstation.deskTop - workstation.deskTopThickness / 2,
  laptopDeck: workstation.laptopDeck,
  seatedBodyLift: workstation.seatedBodyLift,
  seatedBodyForward: workstation.seatedBodyForward,
} as const;

export const WORKSTATION_GEOMETRY_METRICS = {
  standardDeskWidth: workstation.standardDeskWidth,
  compactDeskWidth: workstation.compactDeskWidth,
  laptopWidth: workstation.laptopWidth,
  laptopDepth: workstation.laptopDepth,
  laptopScreenHeight: workstation.laptopScreenHeight,
} as const;

function workstationFootprintRadius(
  width: number,
  depth: number,
  lanes: readonly number[],
): number {
  const laneExtent =
    Math.max(...lanes.map((lane) => Math.abs(lane))) + workstation.chairCushionWidth / 2;
  const halfWidth = Math.max(width / 2, laneExtent);
  const forwardExtent = depth / 2 + workstation.chairForward + workstation.chairCushionDepth / 2;
  return Math.hypot(halfWidth, forwardExtent);
}

/** Authoring-space furniture footprint derived from the same desk/chair body
 * metrics as the rendered mesh. scene-layout applies SCENE_CONTENT_SCALE and a
 * small navigation clearance, eliminating the previous hand-tuned radii. */
export const WORKSTATION_FOOTPRINT_RADIUS = {
  standard: workstationFootprintRadius(
    workstation.standardDeskWidth,
    workstation.deskDepth.standard,
    WORKSTATION_SINGLE_LANES,
  ),
  compact: workstationFootprintRadius(
    workstation.compactDeskWidth,
    workstation.deskDepth.compact,
    WORKSTATION_SINGLE_LANES,
  ),
  dual: workstationFootprintRadius(
    workstation.standardDeskWidth,
    workstation.deskDepth.dual,
    WORKSTATION_DUAL_LANES,
  ),
} as const;
