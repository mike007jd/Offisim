/** Shared world-motion metric consumed by the live EmployeeUnit and P5 scheduler. */
export const CHARACTER_WALK_SPEED_UNITS_PER_SECOND = 1.9;

/**
 * Mixer time scale for locomotion clips (walk / walk.formal / carry) so the
 * animated stride matches the world translation speed above — without it the
 * feet cover ~55% of the ground actually travelled and the character visibly
 * moonwalks/glides ("stiff robotic walk").
 *
 * Derivation (measured, 2026-07-11, character lab stance-foot sampling):
 *   walk clip stance-foot ground speed at the office rig scale
 *   (1.62-unit character × 1.18 scene content scale) ≈ 1.045 units/s;
 *   1.9 / 1.045 ≈ 1.82.
 */
export const CHARACTER_WALK_ANIMATION_TIME_SCALE = 1.82;

/** Heading turn smoothing rate (per second) while walking / settling at a seat. */
export const CHARACTER_TURN_RATE_PER_SECOND = 10;
