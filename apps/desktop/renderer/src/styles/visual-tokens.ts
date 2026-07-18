export const PANEL_SIZE_TOKENS = {
  personnelRailDefault: '280px',
  personnelRailMin: '240px',
  personnelRailCollapsed: '64px',
  personnelInspectorMin: '320px',
  personnelInspectorMax: '460px',
  studioRoomsMin: '180px',
  studioDetailsMin: '220px',
} as const;

export const CANVAS_FONT_TOKENS = {
  /** Deterministic Canvas 2D reset before scene-specific typography is applied. */
  canvasReset: '10px sans-serif',
  officeSceneLabel: '600 11px "General Sans", system-ui, sans-serif',
  /** Single-character glyph inside the 2D resource-marker disc (six-kind scheme). */
  officeSceneMarkerGlyph: '700 8px "General Sans", system-ui, sans-serif',
} as const;

/** Canvas-only art geometry. CSS component radii use the semantic role tokens. */
export const CANVAS_RADIUS_TOKENS = {
  officeFloor: 14,
  zone: 10,
  label: 7,
  deliveryShelf: 8,
  deliveryShelfGlow: 10,
  chip: 6,
  desk: 4,
  resourceMarker: 4,
  blockedMarker: 3.5,
} as const;
