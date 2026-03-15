// ── Editor Grid Overlay ─────────────────────────────────────────────
// Draws a subtle snap grid for alignment in editor mode.
// Grid lines are spaced at GRID_SIZE pixels (32px default).

import { Container, Graphics } from 'pixi.js';
import type { OfficeTheme } from './types.js';
import { THEME_PALETTES } from './types.js';

/** Grid cell size in pixels. */
export const GRID_SIZE = 32;

export class EditorGrid {
  readonly container: Container;
  private gridGfx: Graphics;
  private _visible = true;
  private _theme: OfficeTheme = 'default';

  constructor(
    private canvasWidth: number,
    private canvasHeight: number,
  ) {
    this.container = new Container();
    this.gridGfx = new Graphics();
    this.container.addChild(this.gridGfx);
    this.draw();
  }

  get visible(): boolean {
    return this._visible;
  }

  set visible(v: boolean) {
    this._visible = v;
    this.container.visible = v;
  }

  set theme(t: OfficeTheme) {
    this._theme = t;
    this.draw();
  }

  resize(w: number, h: number): void {
    this.canvasWidth = w;
    this.canvasHeight = h;
    this.draw();
  }

  /** Snap a coordinate to the nearest grid point. */
  static snap(value: number): number {
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
  }

  /** Snap an {x, y} pair. */
  static snapPoint(x: number, y: number): { x: number; y: number } {
    return { x: EditorGrid.snap(x), y: EditorGrid.snap(y) };
  }

  private draw(): void {
    const g = this.gridGfx;
    g.clear();

    const palette = THEME_PALETTES[this._theme];

    // Vertical lines
    for (let x = 0; x <= this.canvasWidth; x += GRID_SIZE) {
      g.moveTo(x, 0);
      g.lineTo(x, this.canvasHeight);
      g.stroke({ color: palette.gridColor, alpha: palette.gridAlpha, width: 1 });
    }

    // Horizontal lines
    for (let y = 0; y <= this.canvasHeight; y += GRID_SIZE) {
      g.moveTo(0, y);
      g.lineTo(this.canvasWidth, y);
      g.stroke({ color: palette.gridColor, alpha: palette.gridAlpha, width: 1 });
    }
  }

  destroy(): void {
    this.gridGfx.destroy();
    this.container.destroy({ children: true });
  }
}
