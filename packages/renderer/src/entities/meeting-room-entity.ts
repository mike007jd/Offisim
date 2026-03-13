import gsap from 'gsap';
import { Container, Graphics } from 'pixi.js';
import type { ZoneBounds } from '../layout/zone-layout-engine.js';
import type { MotionBucket } from '../tokens/motion.js';

/**
 * PixiJS entity representing a meeting room.
 * Displays a conference table with surrounding chairs, sized proportionally
 * to the provided ZoneBounds so the room adapts to any zone allocation.
 *
 * Animated entrance/exit via GSAP using the configured motion buckets.
 */
export class MeetingRoomEntity {
  readonly container: Container;

  private readonly table: Graphics;
  private readonly chairs: Graphics[];
  private readonly motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>;
  private readonly zone: ZoneBounds;
  /** Track active tweens for cleanup (matches EmployeeEntity pattern). */
  private activeTweens: gsap.core.Tween[] = [];
  /** Amber glow overlay behind table for meeting state feedback (ANIM-016~019). */
  private tableGlow: Graphics | null = null;

  // Computed dimensions cached for glow overlay
  private readonly tableWidth: number;
  private readonly tableHeight: number;
  private readonly tableCornerRadius: number;

  constructor(
    zone: ZoneBounds,
    motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>,
  ) {
    this.zone = zone;
    this.motion = motion;

    // Compute table and chair sizes proportionally to zone bounds
    // Table takes ~50% of zone width and ~40% of zone height
    this.tableWidth = Math.round(zone.width * 0.5);
    this.tableHeight = Math.round(zone.height * 0.4);
    this.tableCornerRadius = Math.round(Math.min(this.tableWidth, this.tableHeight) * 0.06);

    this.container = new Container();
    this.container.visible = false;
    // Position the container at the center of the zone
    this.container.position.set(
      zone.x + zone.width / 2,
      zone.y + zone.height / 2,
    );

    // Build table + chairs visuals (drawn relative to container center = 0,0)
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

  /** ANIM-016: Meeting scheduled — soft glow tint */
  showScheduled(): void {
    this.container.visible = true;
    this.container.scale.set(1);
    this.container.alpha = 1;
    // Add amber glow tint to table
    if (!this.tableGlow) {
      this.tableGlow = new Graphics();
      const glowPad = 4;
      this.tableGlow.roundRect(
        -this.tableWidth / 2 - glowPad,
        -this.tableHeight / 2 - glowPad,
        this.tableWidth + glowPad * 2,
        this.tableHeight + glowPad * 2,
        this.tableCornerRadius,
      );
      this.tableGlow.fill({ color: 0xfbbf24, alpha: 0.15 });
      this.container.addChildAt(this.tableGlow, 0);
    }
  }

  /** ANIM-017: Gathering — increase glow */
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

  /** ANIM-018: Active meeting — focus glow */
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

  /** ANIM-019: Meeting ended — fade glow */
  showEnded(): void {
    if (this.tableGlow) {
      const { duration, ease } = this.motion.M2;
      if (duration > 0) {
        this.trackTween(
          gsap.to(this.tableGlow, {
            alpha: 0,
            duration,
            ease,
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

  /** Kill all running GSAP tweens and destroy the container. */
  destroy(): void {
    for (const tw of this.activeTweens) {
      tw.kill();
    }
    this.activeTweens = [];
    if (this.tableGlow) {
      this.tableGlow.destroy();
      this.tableGlow = null;
    }
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
    const g = new Graphics();
    g.roundRect(-this.tableWidth / 2, -this.tableHeight / 2, this.tableWidth, this.tableHeight, this.tableCornerRadius);
    g.fill({ color: 0x5c6370 }); // Dark gray table
    return g;
  }

  private buildChairs(): Graphics[] {
    // Chair radius scales with zone — roughly 4% of the smaller dimension
    const chairRadius = Math.max(6, Math.round(Math.min(this.zone.width, this.zone.height) * 0.04));

    // Position chairs around the table:
    //   2 side chairs (left / right of table)
    //   4 inner chairs (top-left, top-right, bottom-left, bottom-right)
    const sideX = this.tableWidth / 2 + chairRadius + 8;
    const innerX = this.tableWidth * 0.3;
    const innerY = this.tableHeight / 2 + chairRadius + 8;

    const positions = [
      { x: -sideX, y: 0 },            // left side
      { x: sideX, y: 0 },             // right side
      { x: -innerX, y: -innerY },     // top-left
      { x: innerX, y: -innerY },      // top-right
      { x: -innerX, y: innerY },      // bottom-left
      { x: innerX, y: innerY },       // bottom-right
    ];

    return positions.map((pos) => {
      const g = new Graphics();
      g.circle(pos.x, pos.y, chairRadius);
      g.fill({ color: 0x3e4451 }); // Darker chair
      return g;
    });
  }
}
