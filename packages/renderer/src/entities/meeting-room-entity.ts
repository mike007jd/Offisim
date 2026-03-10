import gsap from 'gsap';
import { Container, Graphics } from 'pixi.js';
import { LAYOUT } from '../tokens/layout.js';
import type { MotionBucket } from '../tokens/motion.js';

/**
 * PixiJS entity representing a meeting room.
 * Displays a conference table with surrounding chairs.
 * Animated entrance/exit via GSAP using the configured motion buckets.
 */
export class MeetingRoomEntity {
  readonly container: Container;

  private readonly table: Graphics;
  private readonly chairs: Graphics[];
  private readonly motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>;
  /** Track active tweens for cleanup (matches EmployeeEntity pattern). */
  private activeTweens: gsap.core.Tween[] = [];

  constructor(motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>) {
    this.motion = motion;
    this.container = new Container();
    this.container.visible = false;

    // Build table + chairs visuals
    this.table = this.buildTable();
    this.chairs = this.buildChairs();
    this.container.addChild(this.table, ...this.chairs);
  }

  /** Show the meeting room with scale-from-zero + fade-in entrance animation. */
  show(): void {
    this.container.visible = true;
    this.container.scale.set(0);
    this.container.alpha = 0;

    const { duration, ease } = this.motion.M1;
    if (duration > 0) {
      this.trackTween(gsap.to(this.container.scale, { x: 1, y: 1, duration, ease }));
      this.trackTween(gsap.to(this.container, { alpha: 1, duration, ease }));
    } else {
      this.container.scale.set(1);
      this.container.alpha = 1;
    }
  }

  /** Hide the meeting room with scale-to-zero + fade-out exit animation. */
  hide(): void {
    const { duration, ease } = this.motion.M2;
    if (duration > 0) {
      this.trackTween(gsap.to(this.container.scale, { x: 0, y: 0, duration, ease }));
      this.trackTween(
        gsap.to(this.container, {
          alpha: 0,
          duration,
          ease,
          onComplete: () => {
            this.container.visible = false;
          },
        }),
      );
    } else {
      this.container.scale.set(0);
      this.container.alpha = 0;
      this.container.visible = false;
    }
  }

  /** Kill all running GSAP tweens and destroy the container. */
  destroy(): void {
    for (const tw of this.activeTweens) {
      tw.kill();
    }
    this.activeTweens = [];
    this.container.destroy({ children: true });
  }

  /** Track a tween and auto-remove on completion (same pattern as EmployeeEntity). */
  private trackTween(tw: gsap.core.Tween): void {
    this.activeTweens.push(tw);
    const origOnComplete = tw.vars.onComplete;
    tw.vars.onComplete = () => {
      const idx = this.activeTweens.indexOf(tw);
      if (idx >= 0) this.activeTweens.splice(idx, 1);
      if (origOnComplete) origOnComplete();
    };
  }

  private buildTable(): Graphics {
    const { tableWidth: w, tableHeight: h, tableCornerRadius: r } = LAYOUT.meetingRoom;
    const g = new Graphics();
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill({ color: 0x5c6370 }); // Dark gray table
    return g;
  }

  private buildChairs(): Graphics[] {
    const { chairSideX, chairInnerX, chairInnerY, chairRadius } = LAYOUT.meetingRoom;
    const positions = [
      { x: -chairSideX, y: 0 },
      { x: chairSideX, y: 0 },
      { x: -chairInnerX, y: -chairInnerY },
      { x: chairInnerX, y: -chairInnerY },
      { x: -chairInnerX, y: chairInnerY },
      { x: chairInnerX, y: chairInnerY },
    ];
    return positions.map((pos) => {
      const g = new Graphics();
      g.circle(pos.x, pos.y, chairRadius);
      g.fill({ color: 0x3e4451 }); // Darker chair
      return g;
    });
  }
}
