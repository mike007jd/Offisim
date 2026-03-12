import gsap from 'gsap';
import { Container, Graphics } from 'pixi.js';
import { MIN_FADE_DURATION, type MotionBucket } from '../tokens/motion.js';

/** Draw a dashed line manually (PixiJS 8 Graphics has no native dash support). */
function drawDashedLine(
  g: Graphics,
  x1: number, y1: number,
  x2: number, y2: number,
  dashLen: number,
  gapLen: number,
  offset: number,
  color: number,
  lineWidth: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return;

  const ux = dx / dist;
  const uy = dy / dist;
  const segLen = dashLen + gapLen;
  // Normalize offset to [0, segLen)
  let pos = ((offset % segLen) + segLen) % segLen;

  while (pos < dist) {
    const dashStart = Math.max(pos, 0);
    const dashEnd = Math.min(pos + dashLen, dist);
    if (dashEnd > dashStart && dashStart < dist) {
      // PixiJS 8: moveTo -> lineTo -> stroke({ color, width })
      g.moveTo(x1 + ux * dashStart, y1 + uy * dashStart);
      g.lineTo(x1 + ux * dashEnd, y1 + uy * dashEnd);
      g.stroke({ color, width: lineWidth });
    }
    pos += segLen;
  }
}

/**
 * Animated dashed route line between two scene positions.
 * Used for task handoff visualization (ANIM-004).
 *
 * The dash offset increments each frame via a GSAP tween driving
 * a proxy value, triggering `redraw()` on update.
 */
export class RouteLineEntity {
  readonly container: Container;
  readonly taskRunId: string;

  private readonly gfx: Graphics;
  private fromX = 0;
  private fromY = 0;
  private toX = 0;
  private toY = 0;
  private color: number;
  private readonly motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>;
  private dashOffset = 0;
  private dashTween: gsap.core.Tween | null = null;
  private fadeTween: gsap.core.Tween | null = null;

  constructor(
    taskRunId: string,
    color: number,
    motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>,
  ) {
    this.taskRunId = taskRunId;
    this.color = color;
    this.motion = motion;
    this.container = new Container();
    this.gfx = new Graphics();
    this.container.addChild(this.gfx);
  }

  /** Set endpoints and start dash animation. */
  setEndpoints(fromX: number, fromY: number, toX: number, toY: number): void {
    this.fromX = fromX;
    this.fromY = fromY;
    this.toX = toX;
    this.toY = toY;
    this.redraw();
    this.startDashAnimation();
  }

  /** Update line color (e.g., on task state change). */
  setColor(color: number): void {
    this.color = color;
    this.redraw();
  }

  /** Fade out and call onComplete when done. */
  fadeOut(onComplete?: () => void): void {
    this.stopDashAnimation();
    const { duration, ease } = this.motion.M2;
    if (duration > 0) {
      this.fadeTween = gsap.to(this.container, {
        alpha: 0,
        duration: Math.max(duration, MIN_FADE_DURATION),
        ease,
        onComplete: () => {
          this.destroy();
          onComplete?.();
        },
      });
    } else {
      this.destroy();
      onComplete?.();
    }
  }

  destroy(): void {
    this.stopDashAnimation();
    this.fadeTween?.kill();
    this.fadeTween = null;
    this.container.destroy({ children: true });
  }

  private redraw(): void {
    this.gfx.clear();
    drawDashedLine(
      this.gfx,
      this.fromX, this.fromY,
      this.toX, this.toY,
      8, 4, // dash: 8px on, 4px off
      this.dashOffset,
      this.color,
      2,
    );
  }

  private startDashAnimation(): void {
    this.stopDashAnimation();
    if (this.motion.M1.duration === 0) return; // Tier C: static line

    const proxy = { offset: 0 };
    this.dashTween = gsap.to(proxy, {
      offset: 12, // dash + gap = 12px cycle
      duration: 0.8,
      ease: 'none',
      repeat: -1,
      onUpdate: () => {
        this.dashOffset = proxy.offset;
        this.redraw();
      },
    });
  }

  private stopDashAnimation(): void {
    this.dashTween?.kill();
    this.dashTween = null;
  }
}
