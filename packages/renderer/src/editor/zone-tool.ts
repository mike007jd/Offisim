// ── Zone Tool ───────────────────────────────────────────────────────
// Handles drawing rectangle zones by dragging on the canvas.
// Supports: create zone, drag to move, resize via handles.

import { Graphics } from 'pixi.js';
import type { Container } from 'pixi.js';
import type { EditorZone } from './types.js';
import { ZONE_TYPE_COLORS, DEPT_COLORS } from './types.js';
import { EditorGrid } from './editor-grid.js';
import type { ZoneType } from '../tokens/departments.js';

/** Minimum zone dimension in pixels. */
const MIN_ZONE_SIZE = 64;

/** Zone label font size. */
const LABEL_FONT_SIZE = 11;

export class ZoneTool {
  /** Currently drawing a new zone. */
  private drawing = false;
  private drawStart = { x: 0, y: 0 };
  private previewGfx: Graphics | null = null;

  /** Zone type to assign to newly drawn zones. */
  zoneType: ZoneType = 'department';
  /** Department label for department zones. */
  zoneLabelEn = 'DEV';

  constructor(private readonly layer: Container) {}

  /** Start drawing a new zone at the given position. */
  startDraw(x: number, y: number): void {
    const snapped = EditorGrid.snapPoint(x, y);
    this.drawStart = snapped;
    this.drawing = true;

    this.previewGfx = new Graphics();
    this.layer.addChild(this.previewGfx);
  }

  /** Update preview rectangle while drawing. */
  updateDraw(x: number, y: number): void {
    if (!this.drawing || !this.previewGfx) return;

    const snapped = EditorGrid.snapPoint(x, y);
    const rx = Math.min(this.drawStart.x, snapped.x);
    const ry = Math.min(this.drawStart.y, snapped.y);
    const rw = Math.abs(snapped.x - this.drawStart.x);
    const rh = Math.abs(snapped.y - this.drawStart.y);

    const g = this.previewGfx;
    g.clear();
    g.rect(rx, ry, rw, rh);
    g.stroke({ color: 0x3b82f6, alpha: 0.6, width: 2 });
    g.rect(rx, ry, rw, rh);
    g.fill({ color: 0x3b82f6, alpha: 0.1 });
  }

  /** Finish drawing and return the new zone, or null if too small. */
  finishDraw(x: number, y: number): EditorZone | null {
    if (!this.drawing) return null;
    this.drawing = false;

    // Clean up preview
    if (this.previewGfx) {
      this.layer.removeChild(this.previewGfx);
      this.previewGfx.destroy();
      this.previewGfx = null;
    }

    const snapped = EditorGrid.snapPoint(x, y);
    const rx = Math.min(this.drawStart.x, snapped.x);
    const ry = Math.min(this.drawStart.y, snapped.y);
    const rw = Math.abs(snapped.x - this.drawStart.x);
    const rh = Math.abs(snapped.y - this.drawStart.y);

    if (rw < MIN_ZONE_SIZE || rh < MIN_ZONE_SIZE) return null;

    const id = `zone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const deptColors = DEPT_COLORS as Record<string, number>;
    const zoneColors = ZONE_TYPE_COLORS as Record<string, number>;
    const color = this.zoneType === 'department'
      ? (deptColors[this.zoneLabelEn] ?? 0x2a3a5c)
      : (zoneColors[this.zoneType] ?? 0x2a3a5c);

    return {
      id,
      type: this.zoneType,
      label: this.getDefaultLabel(),
      labelEn: this.zoneLabelEn,
      x: rx,
      y: ry,
      width: rw,
      height: rh,
      floorColor: color,
    };
  }

  /** Cancel drawing in progress. */
  cancelDraw(): void {
    this.drawing = false;
    if (this.previewGfx) {
      this.layer.removeChild(this.previewGfx);
      this.previewGfx.destroy();
      this.previewGfx = null;
    }
  }

  get isDrawing(): boolean {
    return this.drawing;
  }

  /** Draw a zone rectangle onto a Graphics object (for the static render). */
  static drawZone(g: Graphics, zone: EditorZone): void {
    // Fill
    g.roundRect(zone.x, zone.y, zone.width, zone.height, 6);
    g.fill(zone.floorColor);

    // Border (dashed effect via short segments)
    const dashLen = 8;
    const gapLen = 4;
    ZoneTool.drawDashedRect(g, zone.x, zone.y, zone.width, zone.height, dashLen, gapLen, zone.floorColor);
  }

  /** Draw a dashed rectangle border. */
  static drawDashedRect(
    g: Graphics,
    x: number, y: number, w: number, h: number,
    dash: number, gap: number,
    color: number,
  ): void {
    const alpha = 0.5;
    const sides: Array<[number, number, number, number]> = [
      [x, y, x + w, y],         // top
      [x + w, y, x + w, y + h], // right
      [x + w, y + h, x, y + h], // bottom
      [x, y + h, x, y],         // left
    ];

    for (const [x1, y1, x2, y2] of sides) {
      const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      const dx = (x2 - x1) / len;
      const dy = (y2 - y1) / len;
      let pos = 0;
      let drawing = true;
      while (pos < len) {
        const segLen = drawing ? dash : gap;
        const end = Math.min(pos + segLen, len);
        if (drawing) {
          g.moveTo(x1 + dx * pos, y1 + dy * pos);
          g.lineTo(x1 + dx * end, y1 + dy * end);
          g.stroke({ color, alpha, width: 2 });
        }
        pos = end;
        drawing = !drawing;
      }
    }
  }

  private getDefaultLabel(): string {
    switch (this.zoneType) {
      case 'department': return this.zoneLabelEn === 'DEV' ? '开发部门' : this.zoneLabelEn === 'PROD' ? '产品部门' : this.zoneLabelEn === 'ART' ? '美术部门' : '自定义部门';
      case 'library': return '图书馆';
      case 'rest_area': return '休息区';
      case 'meeting_room': return '会议室';
      default: return '区域';
    }
  }

  destroy(): void {
    this.cancelDraw();
  }
}

export { LABEL_FONT_SIZE };
