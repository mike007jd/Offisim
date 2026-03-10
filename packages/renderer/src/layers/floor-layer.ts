import { Container, Graphics } from 'pixi.js';
import { LAYOUT } from '../tokens/layout.js';
import { drawPixelGrid } from '../pixel/draw-pixel-grid.js';
import { PX } from '../pixel/pixel-palette.js';
import { FLOOR_TILE_A, FLOOR_TILE_B } from '../pixel/floor-tiles.js';
import { PIXEL_DESK, PIXEL_MONITOR, PIXEL_CHAIR } from '../pixel/furniture-shapes.js';

export interface DeskPosition {
  x: number;
  y: number;
}

/** Size of one tile in screen pixels (16 logical px * PX scale) */
const TILE_SCREEN = 16 * PX; // 48

export class FloorLayer {
  readonly container: Container;

  constructor() {
    this.container = new Container();
    this.drawFloor();
    this.drawDesks();
  }

  /** Get desk center positions for placing employees */
  getDeskPositions(): DeskPosition[] {
    const { floor, desk } = LAYOUT;
    const startX = (floor.width - (2 * desk.width + desk.gap)) / 2 + desk.width / 2;
    const startY = (floor.height - (2 * desk.height + desk.gap)) / 2 + desk.height / 2;

    return [
      { x: startX, y: startY },
      { x: startX + desk.width + desk.gap, y: startY },
      { x: startX, y: startY + desk.height + desk.gap },
      { x: startX + desk.width + desk.gap, y: startY + desk.height + desk.gap },
    ];
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
