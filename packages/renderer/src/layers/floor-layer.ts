import { Container, Graphics } from 'pixi.js';
import { drawPixelGrid } from '../pixel/draw-pixel-grid.js';
import { FLOOR_TILE_A, FLOOR_TILE_B } from '../pixel/floor-tiles.js';
import { PIXEL_CHAIR, PIXEL_DESK, PIXEL_MONITOR } from '../pixel/furniture-shapes.js';
import { PX } from '../pixel/pixel-palette.js';
import { LAYOUT } from '../tokens/layout.js';

export interface DeskPosition {
  x: number;
  y: number;
  workstationId?: string;
}

/** Axis-aligned bounding box for workstation hit-testing. */
export interface WorkstationBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Size of one tile in screen pixels (16 logical px * PX scale) */
const TILE_SCREEN = 16 * PX; // 48

/**
 * Default workstation IDs for the 2×2 desk grid.
 * Stable identifiers used for DB persistence and drag-drop targeting.
 */
export const DEFAULT_WORKSTATION_IDS = ['ws-1', 'ws-2', 'ws-3', 'ws-4'] as const;

/** Highlight color for drop-target feedback (amber-400). */
const HIGHLIGHT_COLOR = 0xfbbf24;
const HIGHLIGHT_ALPHA = 0.25;
const HIGHLIGHT_BORDER_ALPHA = 0.6;

export class FloorLayer {
  readonly container: Container;
  /** Highlight overlay graphics keyed by workstationId. */
  private highlights: Map<string, Graphics> = new Map();
  /** Container for highlight overlays — added above floor but below furniture. */
  private highlightContainer: Container;

  constructor() {
    this.container = new Container();
    this.highlightContainer = new Container();
    this.drawFloor();
    this.container.addChild(this.highlightContainer);
    this.drawDesks();
  }

  /** Get desk center positions for placing employees */
  getDeskPositions(): DeskPosition[] {
    const { floor, desk } = LAYOUT;
    const startX = (floor.width - (2 * desk.width + desk.gap)) / 2 + desk.width / 2;
    const startY = (floor.height - (2 * desk.height + desk.gap)) / 2 + desk.height / 2;

    return [
      { x: startX, y: startY, workstationId: DEFAULT_WORKSTATION_IDS[0] },
      { x: startX + desk.width + desk.gap, y: startY, workstationId: DEFAULT_WORKSTATION_IDS[1] },
      { x: startX, y: startY + desk.height + desk.gap, workstationId: DEFAULT_WORKSTATION_IDS[2] },
      {
        x: startX + desk.width + desk.gap,
        y: startY + desk.height + desk.gap,
        workstationId: DEFAULT_WORKSTATION_IDS[3],
      },
    ];
  }

  /**
   * Get bounding boxes for all workstations, suitable for drag-drop hit-testing.
   * Each box is centered on the desk and large enough to cover the desk + chair + monitor area.
   */
  getWorkstationBounds(): Map<string, WorkstationBounds> {
    const { desk, employee } = LAYOUT;
    const positions = this.getDeskPositions();
    const result = new Map<string, WorkstationBounds>();

    // Bounds are the desk area extended to include chair, monitor, and employee space
    const halfW = Math.max(desk.width, employee.radius) + 10;
    const halfH = desk.height / 2 + employee.radius + employee.labelOffsetY + 10;

    for (const pos of positions) {
      if (!pos.workstationId) continue;
      result.set(pos.workstationId, {
        x: pos.x - halfW,
        y: pos.y - halfH,
        width: halfW * 2,
        height: halfH * 2,
      });
    }

    return result;
  }

  /**
   * Show or hide a highlight overlay on a workstation (for drop-target feedback).
   * @param workstationId - The workstation to highlight
   * @param on - Whether to show (true) or hide (false) the highlight
   */
  setWorkstationHighlight(workstationId: string, on: boolean): void {
    const existing = this.highlights.get(workstationId);

    if (!on) {
      if (existing) {
        this.highlightContainer.removeChild(existing);
        existing.destroy();
        this.highlights.delete(workstationId);
      }
      return;
    }

    // Already highlighted
    if (existing) return;

    const bounds = this.getWorkstationBounds().get(workstationId);
    if (!bounds) return;

    const gfx = new Graphics();
    // Fill
    gfx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    gfx.fill({ color: HIGHLIGHT_COLOR, alpha: HIGHLIGHT_ALPHA });
    // Border
    gfx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    gfx.stroke({ color: HIGHLIGHT_COLOR, alpha: HIGHLIGHT_BORDER_ALPHA, width: 2 });

    this.highlightContainer.addChild(gfx);
    this.highlights.set(workstationId, gfx);
  }

  /** Clear all workstation highlights. */
  clearAllHighlights(): void {
    for (const [id] of this.highlights) {
      this.setWorkstationHighlight(id, false);
    }
  }

  /**
   * Draw a checkerboard pixel-art floor using alternating tile patterns.
   * Covers the full floor area (800×500) with 48px tiles.
   */
  private drawFloor(): void {
    const { width, height } = LAYOUT.floor;
    const cols = Math.ceil(width / TILE_SCREEN);
    const rows = Math.ceil(height / TILE_SCREEN);
    const g = new Graphics();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = (r + c) % 2 === 0 ? FLOOR_TILE_A : FLOOR_TILE_B;
        drawPixelGrid(g, tile, c * TILE_SCREEN, r * TILE_SCREEN);
      }
    }

    this.container.addChild(g);
  }

  /**
   * Draw pixel furniture at each desk position:
   * desk surface + monitor on top + chair in front (below desk).
   */
  private drawDesks(): void {
    const positions = this.getDeskPositions();

    for (const pos of positions) {
      const g = new Graphics();

      // Desk: center the pixel desk grid on the desk position
      const deskW = PIXEL_DESK[0]!.length * PX;
      const deskH = PIXEL_DESK.length * PX;
      drawPixelGrid(g, PIXEL_DESK, pos.x - deskW / 2, pos.y - deskH / 2);

      // Monitor: centered horizontally on desk, placed at the top edge of the desk
      const monW = PIXEL_MONITOR[0]!.length * PX;
      const monH = PIXEL_MONITOR.length * PX;
      drawPixelGrid(g, PIXEL_MONITOR, pos.x - monW / 2, pos.y - deskH / 2 - monH + 2 * PX);

      // Chair: centered horizontally, placed just below the desk
      const chairW = PIXEL_CHAIR[0]!.length * PX;
      drawPixelGrid(g, PIXEL_CHAIR, pos.x - chairW / 2, pos.y + deskH / 2 + PX);

      this.container.addChild(g);
    }
  }
}
