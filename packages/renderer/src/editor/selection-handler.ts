// ── Selection Handler ───────────────────────────────────────────────
// Manages selection state and draws selection handles (resize corners)
// around the currently selected zone/desk/room in editor mode.

import { Container, Graphics } from 'pixi.js';
import type { EditorSelection, EditorZone, EditorDesk, EditorRoom } from './types.js';

/** Corner handle visual size. */
const HANDLE_SIZE = 8;
const HANDLE_COLOR = 0x3b82f6;
const SELECTION_BORDER_COLOR = 0x3b82f6;
const SELECTION_BORDER_ALPHA = 0.8;
const SELECTION_FILL_ALPHA = 0.08;

/** Which resize handle is being dragged. */
export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se' | null;

export class SelectionHandler {
  readonly container: Container;
  private selectionGfx: Graphics;
  private handleGfx: Graphics[] = [];
  private _selection: EditorSelection = { kind: 'none' };

  constructor() {
    this.container = new Container();
    this.selectionGfx = new Graphics();
    this.container.addChild(this.selectionGfx);
  }

  get selection(): EditorSelection {
    return this._selection;
  }

  /** Update selection and redraw handles. */
  select(sel: EditorSelection, zones: EditorZone[], desks: EditorDesk[], rooms: EditorRoom[]): void {
    this._selection = sel;
    this.clearVisuals();

    if (sel.kind === 'none') return;

    let bounds: { x: number; y: number; width: number; height: number } | null = null;

    if (sel.kind === 'zone') {
      const zone = zones.find((z) => z.id === sel.id);
      if (zone) bounds = { x: zone.x, y: zone.y, width: zone.width, height: zone.height };
    } else if (sel.kind === 'desk') {
      const desk = desks.find((d) => d.id === sel.id);
      if (desk) bounds = { x: desk.x - 25, y: desk.y - 15, width: 50, height: 30 };
    } else if (sel.kind === 'room') {
      const room = rooms.find((r) => r.id === sel.id);
      if (room) bounds = { x: room.x, y: room.y, width: room.width, height: room.height };
    }

    if (!bounds) return;
    this.drawSelection(bounds);
  }

  deselect(): void {
    this._selection = { kind: 'none' };
    this.clearVisuals();
  }

  /** Test if a point hits a resize handle. Returns corner ID or null. */
  hitTestHandles(x: number, y: number, zones: EditorZone[], _desks: EditorDesk[], rooms: EditorRoom[]): ResizeCorner {
    const sel = this._selection;
    if (sel.kind === 'none' || sel.kind === 'desk') return null; // desks are not resizable

    let bounds: { x: number; y: number; width: number; height: number } | null = null;
    if (sel.kind === 'zone') {
      const zone = zones.find((z) => z.id === sel.id);
      if (zone) bounds = zone;
    } else if (sel.kind === 'room') {
      const room = rooms.find((r) => r.id === sel.id);
      if (room) bounds = room;
    }
    if (!bounds) return null;

    const corners: Array<{ corner: ResizeCorner; cx: number; cy: number }> = [
      { corner: 'nw', cx: bounds.x, cy: bounds.y },
      { corner: 'ne', cx: bounds.x + bounds.width, cy: bounds.y },
      { corner: 'sw', cx: bounds.x, cy: bounds.y + bounds.height },
      { corner: 'se', cx: bounds.x + bounds.width, cy: bounds.y + bounds.height },
    ];

    const hitRadius = HANDLE_SIZE + 4;
    for (const { corner, cx, cy } of corners) {
      if (Math.abs(x - cx) < hitRadius && Math.abs(y - cy) < hitRadius) {
        return corner;
      }
    }
    return null;
  }

  private drawSelection(bounds: { x: number; y: number; width: number; height: number }): void {
    const g = this.selectionGfx;

    // Fill overlay
    g.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    g.fill({ color: HANDLE_COLOR, alpha: SELECTION_FILL_ALPHA });

    // Border
    g.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    g.stroke({ color: SELECTION_BORDER_COLOR, alpha: SELECTION_BORDER_ALPHA, width: 2 });

    // Corner handles
    const corners = [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x, y: bounds.y + bounds.height },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    ];

    for (const corner of corners) {
      const h = new Graphics();
      h.rect(corner.x - HANDLE_SIZE / 2, corner.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      h.fill({ color: HANDLE_COLOR, alpha: 1 });
      h.rect(corner.x - HANDLE_SIZE / 2, corner.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      h.stroke({ color: 0xffffff, alpha: 0.9, width: 1 });
      this.container.addChild(h);
      this.handleGfx.push(h);
    }
  }

  private clearVisuals(): void {
    this.selectionGfx.clear();
    for (const h of this.handleGfx) {
      this.container.removeChild(h);
      h.destroy();
    }
    this.handleGfx = [];
  }

  destroy(): void {
    this.clearVisuals();
    this.selectionGfx.destroy();
    this.container.destroy({ children: true });
  }
}
