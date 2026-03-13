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
  private _floorWidth: number;
  private _floorHeight: number;
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

  /** Currently active GSAP tween (killed before starting a new one) */
  private _activeTween: gsap.core.Tween | null = null;

  constructor(options: CameraControllerOptions) {
    this.world = options.world;
    this._floorWidth = options.floorWidth;
    this._floorHeight = options.floorHeight;
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

  /** Update floor dimensions (e.g. after rebuildLayout). */
  set floorWidth(value: number) {
    this._floorWidth = value;
  }
  set floorHeight(value: number) {
    this._floorHeight = value;
  }

  /** Whether a GSAP animation is currently in progress. */
  get isAnimating(): boolean {
    return this._activeTween !== null && this._activeTween.isActive();
  }

  /** Fit the entire floor into the viewport with padding */
  fitToView(viewportWidth: number, viewportHeight: number): void {
    const padX = 40;
    const padY = 40;
    const scaleX = (viewportWidth - padX * 2) / this._floorWidth;
    const scaleY = (viewportHeight - padY * 2) / this._floorHeight;
    this._scale = this.clampScale(Math.min(scaleX, scaleY));

    this._panX = (viewportWidth - this._floorWidth * this._scale) / 2;
    this._panY = (viewportHeight - this._floorHeight * this._scale) / 2;

    this.applyTransform();
  }

  /** Handle mouse wheel zoom (zooms toward pointer position) */
  onWheel(
    deltaY: number,
    pointerX: number,
    pointerY: number,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const zoomFactor = deltaY > 0 ? 0.9 : 1.1;
    const newScale = this.clampScale(this._scale * zoomFactor);

    if (newScale === this._scale) return;

    // Zoom toward pointer: keep the world point under the pointer fixed
    const worldX = (pointerX - this._panX) / this._scale;
    const worldY = (pointerY - this._panY) / this._scale;

    this._scale = newScale;
    this._panX = pointerX - worldX * this._scale;
    this._panY = pointerY - worldY * this._scale;

    this.clampPan(viewportWidth, viewportHeight);
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

  /** Continue a pan gesture. */
  onPanMove(screenX: number, screenY: number, viewportWidth: number, viewportHeight: number): void {
    if (!this.isPanning) return;
    this._panX = this.panStartWorldX + (screenX - this.panStartX);
    this._panY = this.panStartWorldY + (screenY - this.panStartY);
    this.clampPan(viewportWidth, viewportHeight);
    this.applyTransform();
  }

  /** End pan */
  onPanEnd(): void {
    this.isPanning = false;
  }

  /** Animate the camera to center on a zone's bounding box. */
  focusZone(
    bounds: { x: number; y: number; width: number; height: number },
    viewportWidth: number,
    viewportHeight: number,
    duration = 0.5,
  ): void {
    const padding = 40;
    const scaleX = (viewportWidth - padding * 2) / bounds.width;
    const scaleY = (viewportHeight - padding * 2) / bounds.height;
    const targetScale = this.clampScale(Math.min(scaleX, scaleY));

    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    const targetPanX = viewportWidth / 2 - centerX * targetScale;
    const targetPanY = viewportHeight / 2 - centerY * targetScale;

    this.animateTo(targetScale, targetPanX, targetPanY, duration);
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

  /**
   * Smoothly zoom and pan to center on a single employee position.
   * Zooms to at least 1.2x (or the current scale if already higher).
   */
  focusEmployee(
    position: { x: number; y: number },
    viewportWidth: number,
    viewportHeight: number,
    duration = 0.4,
  ): void {
    const targetScale = this.clampScale(Math.max(1.2, this._scale));
    const targetPanX = viewportWidth / 2 - position.x * targetScale;
    const targetPanY = viewportHeight / 2 - position.y * targetScale;

    this.animateTo(targetScale, targetPanX, targetPanY, duration);
  }

  /**
   * Adjust the viewport to contain all given employee positions with padding.
   * If positions is empty, falls back to fitToView behavior.
   */
  fitAllEmployees(
    positions: Array<{ x: number; y: number }>,
    viewportWidth: number,
    viewportHeight: number,
    duration = 0.5,
  ): void {
    if (positions.length === 0) {
      const targetScale = this.computeFitScale(
        this._floorWidth, this._floorHeight,
        viewportWidth, viewportHeight, 40,
      );
      const targetPanX = (viewportWidth - this._floorWidth * targetScale) / 2;
      const targetPanY = (viewportHeight - this._floorHeight * targetScale) / 2;
      this.animateTo(targetScale, targetPanX, targetPanY, duration);
      return;
    }

    let minX = positions[0]!.x;
    let minY = positions[0]!.y;
    let maxX = positions[0]!.x;
    let maxY = positions[0]!.y;

    for (const pos of positions) {
      if (pos.x < minX) minX = pos.x;
      if (pos.y < minY) minY = pos.y;
      if (pos.x > maxX) maxX = pos.x;
      if (pos.y > maxY) maxY = pos.y;
    }

    const padding = 60;
    const bboxWidth = maxX - minX + padding * 2;
    const bboxHeight = maxY - minY + padding * 2;

    const targetScale = this.computeFitScale(
      Math.max(bboxWidth, 1), Math.max(bboxHeight, 1),
      viewportWidth, viewportHeight, 0,
    );

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const targetPanX = viewportWidth / 2 - centerX * targetScale;
    const targetPanY = viewportHeight / 2 - centerY * targetScale;

    this.animateTo(targetScale, targetPanX, targetPanY, duration);
  }

  /** Smoothly reset the camera to the fitToView state. */
  resetView(
    viewportWidth: number,
    viewportHeight: number,
    duration = 0.5,
  ): void {
    const padX = 40;
    const padY = 40;
    const scaleX = (viewportWidth - padX * 2) / this._floorWidth;
    const scaleY = (viewportHeight - padY * 2) / this._floorHeight;
    const targetScale = this.clampScale(Math.min(scaleX, scaleY));

    const targetPanX = (viewportWidth - this._floorWidth * targetScale) / 2;
    const targetPanY = (viewportHeight - this._floorHeight * targetScale) / 2;

    this.animateTo(targetScale, targetPanX, targetPanY, duration);
  }

  /** Smoothly zoom to a target scale level, keeping a specific world point centered. */
  zoomTo(
    targetScale: number,
    centerWorldX: number,
    centerWorldY: number,
    viewportWidth: number,
    viewportHeight: number,
    duration = 0.4,
  ): void {
    const clamped = this.clampScale(targetScale);
    const targetPanX = viewportWidth / 2 - centerWorldX * clamped;
    const targetPanY = viewportHeight / 2 - centerWorldY * clamped;

    this.animateTo(clamped, targetPanX, targetPanY, duration);
  }

  // ── Private helpers ──────────────────────────────────────────────

  /** Apply current transform to the world container */
  private applyTransform(): void {
    this.world.scale.set(this._scale);
    this.world.position.set(this._panX, this._panY);
  }

  /** Clamp scale to [minZoom, maxZoom]. */
  private clampScale(s: number): number {
    return Math.min(this.maxZoom, Math.max(this.minZoom, s));
  }

  /** Clamp pan so the floor doesn't fly off-screen entirely. */
  private clampPan(viewportWidth: number, viewportHeight: number): void {
    const worldW = this._floorWidth * this._scale;
    const worldH = this._floorHeight * this._scale;
    const margin = 100;
    this._panX = Math.max(-worldW + margin, Math.min(viewportWidth - margin, this._panX));
    this._panY = Math.max(-worldH + margin, Math.min(viewportHeight - margin, this._panY));
  }

  /** Compute fit scale for a given content size within a viewport, with padding. */
  private computeFitScale(
    contentWidth: number,
    contentHeight: number,
    viewportWidth: number,
    viewportHeight: number,
    padding: number,
  ): number {
    const scaleX = (viewportWidth - padding * 2) / contentWidth;
    const scaleY = (viewportHeight - padding * 2) / contentHeight;
    return this.clampScale(Math.min(scaleX, scaleY));
  }

  /**
   * Kill any running camera animation and animate to target state.
   * Updates internal _scale/_panX/_panY as the tween progresses.
   */
  private animateTo(
    targetScale: number,
    targetPanX: number,
    targetPanY: number,
    duration: number,
  ): void {
    if (this._activeTween) {
      this._activeTween.kill();
      this._activeTween = null;
    }

    if (duration <= 0) {
      this._scale = targetScale;
      this._panX = targetPanX;
      this._panY = targetPanY;
      this.applyTransform();
      return;
    }

    const proxy = { scale: this._scale, panX: this._panX, panY: this._panY };

    this._activeTween = gsap.to(proxy, {
      scale: targetScale,
      panX: targetPanX,
      panY: targetPanY,
      duration,
      ease: 'power2.inOut',
      onUpdate: () => {
        this._scale = proxy.scale;
        this._panX = proxy.panX;
        this._panY = proxy.panY;
        this.applyTransform();
      },
      onComplete: () => {
        this._activeTween = null;
      },
    });
  }
}
