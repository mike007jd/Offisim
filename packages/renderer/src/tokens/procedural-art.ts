/** Procedural art generation constants — centralized token file per GDD §13 */

/** Employee avatar generation parameters */
export const AVATAR = {
  /** Base circle radius */
  radius: 20,
  /** Initials font size */
  fontSize: 14,
  /** Selection ring gap from avatar edge */
  selectionRingGap: 4,
  /** State ring line width */
  stateRingWidth: 2.5,
} as const;

/** Desk/furniture procedural generation */
export const FURNITURE = {
  /** Desk dimensions */
  desk: { width: 60, height: 40 },
  /** Chair dimensions */
  chair: { width: 16, height: 16 },
  /** Monitor dimensions */
  monitor: { width: 24, height: 18 },
  /** Monitor screen inset */
  monitorScreenInset: 2,
} as const;

/** State badge constants */
export const STATE_BADGE = {
  /** Badge radius */
  radius: 6,
  /** Badge offset from avatar center (bottom-right) */
  offsetX: 14,
  offsetY: 14,
  /** Icon scale within badge */
  iconScale: 0.7,
} as const;
