/**
 * Pure coordinate transform module for the 2D office Canvas view.
 * No React, no side effects — just math.
 *
 * Mirrors the constants and logic from office-2d-geometry.ts (SVG path)
 * but adds viewport pan/zoom helpers for the Canvas renderer.
 */

// ── Constants ─────────────────────────────────────────────────────────

export const SCALE = 50; // px per 3D unit
export const ROOM_W = 2000; // 40 * 50
export const ROOM_H = 1500; // 30 * 50
export const WORLD_OFFSET_X = 20; // world origin x offset
export const WORLD_OFFSET_Z = 15; // world origin z offset
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 4.0;
export const FIT_MARGIN = 0.92;
export const EMPLOYEE_RADIUS = 18; // canvas units
export const DRAG_THRESHOLD = 5; // pixels

// ── Types ─────────────────────────────────────────────────────────────

export interface ViewportTransform {
  x: number; // translateX in screen pixels
  y: number; // translateY in screen pixels
  scale: number;
}

// ── Coordinate transforms ─────────────────────────────────────────────

/** Convert 3D world (x, z) → canvas pixel coordinates. */
export function worldToCanvas(
  worldX: number,
  worldZ: number,
): { x: number; y: number } {
  return {
    x: (worldX + WORLD_OFFSET_X) * SCALE,
    y: (worldZ + WORLD_OFFSET_Z) * SCALE,
  };
}

/** Convert canvas pixel coordinates → 3D world (x, z). Inverse of worldToCanvas. */
export function canvasToWorld(
  canvasX: number,
  canvasY: number,
): { x: number; z: number } {
  return {
    x: canvasX / SCALE - WORLD_OFFSET_X,
    z: canvasY / SCALE - WORLD_OFFSET_Z,
  };
}


/**
 * Convert 3D zone center + dimensions → canvas rect (top-left, width, height).
 * Matches the `toSVG` logic from office-2d-geometry.ts.
 */
export function zoneToCanvasRect(
  cx: number,
  cz: number,
  w: number,
  d: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: (cx + WORLD_OFFSET_X) * SCALE - (w * SCALE) / 2,
    y: (cz + WORLD_OFFSET_Z) * SCALE - (d * SCALE) / 2,
    w: w * SCALE,
    h: d * SCALE,
  };
}

/**
 * Convert screen (clientX, clientY) → canvas-space coordinates,
 * accounting for the canvas element position and current viewport transform.
 */
export function screenToCanvas(
  clientX: number,
  clientY: number,
  canvasRect: DOMRect,
  viewport: ViewportTransform,
): { x: number; y: number } {
  return {
    x: (clientX - canvasRect.left - viewport.x) / viewport.scale,
    y: (clientY - canvasRect.top - viewport.y) / viewport.scale,
  };
}

/**
 * Compute initial viewport that fits ROOM_W×ROOM_H in the container
 * with FIT_MARGIN, centered.
 */
export function computeFitViewport(
  containerWidth: number,
  containerHeight: number,
): ViewportTransform {
  const scaleX = containerWidth / ROOM_W;
  const scaleY = containerHeight / ROOM_H;
  const scale = Math.min(scaleX, scaleY) * FIT_MARGIN;

  const x = (containerWidth - ROOM_W * scale) / 2;
  const y = (containerHeight - ROOM_H * scale) / 2;

  return { x, y, scale };
}

/**
 * Preserve the world point currently centered in the viewport when the container resizes.
 * Keeps the current zoom level intact instead of snapping back to fit-to-screen framing.
 */
export function preserveViewportOnResize(
  prev: ViewportTransform,
  previousWidth: number,
  previousHeight: number,
  nextWidth: number,
  nextHeight: number,
): ViewportTransform {
  if (previousWidth <= 0 || previousHeight <= 0) {
    return computeFitViewport(nextWidth, nextHeight);
  }

  const previousCenterWorldX = (previousWidth / 2 - prev.x) / prev.scale;
  const previousCenterWorldY = (previousHeight / 2 - prev.y) / prev.scale;

  return {
    x: nextWidth / 2 - previousCenterWorldX * prev.scale,
    y: nextHeight / 2 - previousCenterWorldY * prev.scale,
    scale: prev.scale,
  };
}

/**
 * Apply wheel zoom toward pointer position, clamped to [ZOOM_MIN, ZOOM_MAX].
 * pointerX/pointerY are relative to the canvas container (not screen).
 */
export function applyWheelZoom(
  prev: ViewportTransform,
  deltaY: number,
  pointerX: number,
  pointerY: number,
): ViewportTransform {
  const zoomFactor = deltaY < 0 ? 1.1 : 1 / 1.1;
  const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.scale * zoomFactor));

  // Zoom toward pointer: adjust translation so the point under the pointer stays fixed
  const x = pointerX - (pointerX - prev.x) * (newScale / prev.scale);
  const y = pointerY - (pointerY - prev.y) * (newScale / prev.scale);

  return { x, y, scale: newScale };
}

/** Apply pan delta to viewport. */
export function applyPan(
  prev: ViewportTransform,
  dx: number,
  dy: number,
): ViewportTransform {
  return {
    x: prev.x + dx,
    y: prev.y + dy,
    scale: prev.scale,
  };
}
