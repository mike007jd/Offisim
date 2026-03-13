import gsap from 'gsap';
import { Container, Graphics } from 'pixi.js';
import type { MotionBucket } from '../tokens/motion.js';

/** Meeting room layout constants (self-contained — no external LAYOUT dependency). */
const MEETING = {
  tableWidth: 100,
  tableHeight: 60,
  tableCornerRadius: 8,
  chairRadius: 8,
  chairSideX: 65,
  chairInnerX: 30,
  chairInnerY: 45,
} as const;

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
  private activeTweens: gsap.core.Tween[] = [];
  private tableGlow: Graphics | null = null;

  constructor(motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>) {
    this.motion = motion;
    this.container = new Container();
    this.container.visible = false;

    this.table = this.buildTable();
    this.chairs = this.buildChairs();
    this.container.addChild(this.table, ...this.chairs);
  }

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

  hide(): void {
    const { duration, ease } = this.motion.M2;
    if (duration > 0) {
      this.trackTween(gsap.to(this.container.scale, { x: 0, y: 0, duration, ease }));
      this.trackTween(
        gsap.to(this.container, {
          alpha: 0, duration, ease,
          onComplete: () => { this.container.visible = false; },
        }),
      );
    } else {
      this.container.scale.set(0);
      this.container.alpha = 0;
      this.container.visible = false;
    }
  }

  showScheduled(): void {
    this.container.visible = true;
    this.container.scale.set(1);
    this.container.alpha = 1;
    if (!this.tableGlow) {
      this.tableGlow = new Graphics();
      this.tableGlow.roundRect(
        -MEETING.tableWidth / 2 - 4,
        -MEETING.tableHeight / 2 - 4,
        MEETING.tableWidth + 8,
        MEETING.tableHeight + 8,
        MEETING.tableCornerRadius,
      );
      this.tableGlow.fill({ color: 0xfbbf24, alpha: 0.15 });
      this.container.addChildAt(this.tableGlow, 0);
    }
  }

  showGathering(): void {
    if (this.tableGlow) {
      const { duration, ease } = this.motion.M2;
      if (duration > 0) {
        this.trackTween(gsap.to(this.tableGlow, { alpha: 0.3, duration, ease }));
      } else {
        this.tableGlow.alpha = 0.3;
      }
    }
  }

  showActive(): void {
    if (this.tableGlow) {
      const { duration, ease } = this.motion.M2;
      if (duration > 0) {
        this.trackTween(gsap.to(this.tableGlow, { alpha: 0.4, duration, ease }));
      } else {
        this.tableGlow.alpha = 0.4;
      }
    }
  }

  showEnded(): void {
    if (this.tableGlow) {
      const { duration, ease } = this.motion.M2;
      if (duration > 0) {
        this.trackTween(
          gsap.to(this.tableGlow, {
            alpha: 0, duration, ease,
            onComplete: () => {
              if (this.tableGlow) {
                this.container.removeChild(this.tableGlow);
                this.tableGlow.destroy();
                this.tableGlow = null;
              }
            },
          }),
        );
      } else if (this.tableGlow) {
        this.container.removeChild(this.tableGlow);
        this.tableGlow.destroy();
        this.tableGlow = null;
      }
    }
  }

  destroy(): void {
    for (const tw of this.activeTweens) tw.kill();
    this.activeTweens = [];
    if (this.tableGlow) {
      this.tableGlow.destroy();
      this.tableGlow = null;
    }
    this.container.destroy({ children: true });
  }

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
    const { tableWidth: w, tableHeight: h, tableCornerRadius: r } = MEETING;
    const g = new Graphics();
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill({ color: 0x5c6370 });
    return g;
  }

  private buildChairs(): Graphics[] {
    const { chairSideX, chairInnerX, chairInnerY, chairRadius } = MEETING;
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
      g.fill({ color: 0x3e4451 });
      return g;
    });
  }
}
