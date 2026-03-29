/**
 * Pure geometry helpers for the 2D office SVG view.
 * No React, no side effects — just math.
 */
import type { Zone } from '@offisim/shared-types';
import { DRAG_THRESHOLD_PX } from './office3d-shared';

// ── Constants ─────────────────────────────────────────────────────────

export const SCALE = 50; // px per 3D unit
export const ROOM_W = 2000; // 40 * 50
export const ROOM_H = 1500; // 30 * 50

/** Re-export the shared drag threshold so 2D consumers don't need to know about office3d-shared. */
export const DRAG_THRESHOLD = DRAG_THRESHOLD_PX;

// ── Coordinate transforms ─────────────────────────────────────────────

/** Map 3D center coords → SVG top-left rect. */
export function toSVG(cx: number, cz: number, w: number, d: number) {
  return {
    x: (cx + 20) * SCALE - (w * SCALE) / 2,
    y: (cz + 15) * SCALE - (d * SCALE) / 2,
    w: w * SCALE,
    h: d * SCALE,
  };
}

export interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

/**
 * Convert screen (clientX, clientY) → SVG viewBox coordinates.
 * Pure function — caller supplies the viewport rect and current transform.
 */
export function screenToSvg(
  clientX: number,
  clientY: number,
  viewportRect: DOMRect,
  transform: ViewportTransform,
): { x: number; y: number } {
  const divX = (clientX - viewportRect.left - transform.x) / transform.scale;
  const divY = (clientY - viewportRect.top - transform.y) / transform.scale;
  return { x: divX, y: divY };
}

// ── Hit testing ───────────────────────────────────────────────────────

export interface ZoneSvgBound {
  zone: Zone;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Find which drop-target zone contains a point in SVG coords. */
export function hitTestZone(
  svgX: number,
  svgY: number,
  bounds: ReadonlyArray<ZoneSvgBound>,
): Zone | null {
  for (const b of bounds) {
    if (svgX >= b.x && svgX <= b.x + b.w && svgY >= b.y && svgY <= b.y + b.h) {
      return b.zone;
    }
  }
  return null;
}
