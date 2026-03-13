// ── Camera controller ──────────────────────────────────────────────
// Manages zoom/pan for the office floor scene via worldContainer transform.

import gsap from 'gsap';
import type { Container } from 'pixi.js';

export interface CameraControllerOptions {
  /** The PixiJS stage container */
  stage: Container;
  /** The world container that holds all scene content */
  world: Container;
  /** Total floor width in world coordinates */
  floorWidth: number;
  /** Total floor height in world coordinates */
  floorHeight: number;
  /** Minimum zoom level (default: 0.3) */
  minZoom?: number;
  /** Maximum zoom level (default: 2.0) */
  maxZoom?: number;
}

export class CameraController {
  private readonly world: Container;
  private readonly floorWidth: number;
  private readonly floorHeight: number;
  private readonly minZoom: number;
  private readonly maxZoom: number;

  private _scale = 1;
  private _panX = 0;
  private _panY = 0;

  // Pan state
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panStartWorldX = 0;
  private panStartWorldY = 0;

  constructor(options: CameraControllerOptions) {
    this.world = options.world;
    this.floorWidth = options.floorWidth;
    this.floorHeight = options.floorHeight;
    this.minZoom = options.minZoom ?? 0.3;
    this.maxZoom = options.maxZoom ?? 2.0;
  }

  /** Current zoom level */
  get scale(): number {
    return this._scale;
  }

  /** Current pan offset X */
  get panX(): number {
    return this._panX;
  }

  /** Current pan offset Y */
  get panY(): number {
    return this._panY;
  }

  /** Fit the entire floor into the viewport */
  fitToView(viewportWidth: number, viewportHeight: number): void {
    const scaleX = viewportWidth / this.floorWidth;
    const scaleY = viewportHeight / this.floorHeight;
    this._scale = Math.min(scaleX, scaleY, this.maxZoom);
    this._scale = Math.max(this._scale, this.minZoom);

    // Center the floor in the viewport
    this._panX = (viewportWidth - this.floorWidth * this._scale) / 2;
    this._panY = (viewportHeight - this.floorHeight * this._scale) / 2;

    this.applyTransform();
  }

  /** Handle mouse wheel zoom (around cursor position) */
  onWheel(e: WheelEvent, _viewportWidth: number, _viewportHeight: number): void {
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(Math.max(this._scale * zoomFactor, this.minZoom), this.maxZoom);

    if (newScale === this._scale) return;

    // Zoom toward mouse position
    const mouseX = e.offsetX;
    const mouseY = e.offsetY;

    // World position under mouse before zoom
    const worldX = (mouseX - this._panX) / this._scale;
    const worldY = (mouseY - this._panY) / this._scale;

    this._scale = newScale;

    // Adjust pan so the same world point stays under cursor
    this._panX = mouseX - worldX * this._scale;
    this._panY = mouseY - worldY * this._scale;

    this.applyTransform();
  }

  /** Start pan (middle mouse button or space+left click) */
  onPanStart(screenX: number, screenY: number): void {
    this.isPanning = true;
    this.panStartX = screenX;
    this.panStartY = screenY;
    this.panStartWorldX = this._panX;
    this.panStartWorldY = this._panY;
  }

  /** Move during pan */
  onPanMove(screenX: number, screenY: number): void {
    if (!this.isPanning) return;
    this._panX = this.panStartWorldX + (screenX - this.panStartX);
    this._panY = this.panStartWorldY + (screenY - this.panStartY);
    this.applyTransform();
  }

  /** End pan */
  onPanEnd(): void {
    this.isPanning = false;
  }

  /** Smoothly pan to center a zone in the viewport */
  focusZone(
    bounds: { x: number; y: number; width: number; height: number },
    viewportWidth: number,
    viewportHeight: number,
    duration = 0.5,
  ): void {
    // Calculate scale to fit zone with padding
    const padding = 40;
    const scaleX = (viewportWidth - padding * 2) / bounds.width;
    const scaleY = (viewportHeight - padding * 2) / bounds.height;
    const targetScale = Math.min(scaleX, scaleY, this.maxZoom);

    // Calculate pan to center the zone
    const zoneCenterX = bounds.x + bounds.width / 2;
    const zoneCenterY = bounds.y + bounds.height / 2;
    const targetPanX = viewportWidth / 2 - zoneCenterX * targetScale;
    const targetPanY = viewportHeight / 2 - zoneCenterY * targetScale;

    gsap.to(this, {
      _scale: targetScale,
      _panX: targetPanX,
      _panY: targetPanY,
      duration,
      ease: 'power2.out',
      onUpdate: () => this.applyTransform(),
    });
  }

  /** Convert screen coordinates to world coordinates */
  getWorldPosition(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this._panX) / this._scale,
      y: (screenY - this._panY) / this._scale,
    };
  }

  /** Convert world coordinates to screen coordinates */
  getScreenPosition(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: worldX * this._scale + this._panX,
      y: worldY * this._scale + this._panY,
    };
  }

  /** Apply current transform to the world container */
  private applyTransform(): void {
    this.world.scale.set(this._scale);
    this.world.position.set(this._panX, this._panY);
  }
}
