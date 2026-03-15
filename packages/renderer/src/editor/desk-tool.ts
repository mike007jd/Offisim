// ── Desk Tool ───────────────────────────────────────────────────────
// Places desks within zones, snapping to the editor grid.

import { Graphics } from 'pixi.js';
import type { EditorDesk, EditorZone } from './types.js';
import { EditorGrid } from './editor-grid.js';
// Desk drawing uses inline Graphics calls (same shapes as furniture.ts)

/** Desk visual dimensions (same as FloorLayer). */
const DESK_HALF_W = 25;
const DESK_HALF_H = 15;

export class DeskTool {
  /** Find which zone contains the given point. */
  static findContainingZone(x: number, y: number, zones: EditorZone[]): EditorZone | null {
    for (const zone of zones) {
      if (x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height) {
        return zone;
      }
    }
    return null;
  }

  /** Create a desk at the snapped position, if inside a zone. */
  static placeDesk(x: number, y: number, zones: EditorZone[]): EditorDesk | null {
    const snapped = EditorGrid.snapPoint(x, y);
    const zone = DeskTool.findContainingZone(snapped.x, snapped.y, zones);
    if (!zone) return null;

    return {
      id: `desk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      zoneId: zone.id,
      x: snapped.x,
      y: snapped.y,
    };
  }

  /** Draw a desk + monitor + chair at the given position. */
  static drawDesk(g: Graphics, desk: EditorDesk): void {
    // Desk surface (rounded rectangle)
    g.roundRect(desk.x - DESK_HALF_W, desk.y - DESK_HALF_H, DESK_HALF_W * 2, DESK_HALF_H * 2, 3);
    g.fill(0x5c4033);

    // Monitor indicator (small rectangle on top of desk)
    g.roundRect(desk.x - 8, desk.y - DESK_HALF_H - 8, 16, 8, 1);
    g.fill(0x334155);

    // Chair indicator (small circle below desk)
    g.circle(desk.x, desk.y + DESK_HALF_H + 6, 5);
    g.fill(0x2d3748);
  }

  /** Check if a point hits a desk. */
  static hitTest(x: number, y: number, desks: EditorDesk[]): EditorDesk | null {
    for (const desk of desks) {
      if (
        x >= desk.x - DESK_HALF_W &&
        x <= desk.x + DESK_HALF_W &&
        y >= desk.y - DESK_HALF_H &&
        y <= desk.y + DESK_HALF_H
      ) {
        return desk;
      }
    }
    return null;
  }
}
