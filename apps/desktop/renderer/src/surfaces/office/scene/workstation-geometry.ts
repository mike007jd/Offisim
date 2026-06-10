/**
 * Workstation seat geometry shared by the 3D mesh (WorkstationUnit3D renders
 * the chairs) and the seat planner (scene-layout anchors seated employees into
 * those chairs). Single source so a desk or chair tweak cannot silently strand
 * seated characters. Deliberately three-free: scene-layout is consumed by the
 * 2D scene too.
 */

/** Desk depth (prefab-local z) per workstation variant. */
export const WORKSTATION_DESK_DEPTH = {
  standard: 1.25,
  compact: 1.05,
  dual: 1.25,
} as const;

/** Seat lane x-offsets — dual workstations seat two, others one. */
export const WORKSTATION_DUAL_LANES: readonly number[] = [-0.56, 0.56];
export const WORKSTATION_SINGLE_LANES: readonly number[] = [0];

/** The chair centre sits this far past the desk edge (z = deskDepth / 2 + this). */
export const WORKSTATION_CHAIR_FORWARD = 0.5;

/** Seated characters land slightly inside the chair centre (CHAIR_FORWARD minus
 *  a sit-into delta) so they read as sitting in the chair, not on its edge. */
export const WORKSTATION_SEAT_FORWARD = 0.46;
