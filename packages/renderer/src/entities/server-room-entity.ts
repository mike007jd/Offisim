import gsap from 'gsap';
import { Container, Graphics, Text } from 'pixi.js';
import type { MotionBucket } from '../tokens/motion.js';

/**
 * Bounding rectangle for a zone in the office layout.
 * Mirrors the shape expected by zone-layout-engine.
 */
export interface ZoneBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type ServerStatus = 'idle' | 'active' | 'overloaded' | 'error';

const SERVER_STATUS_COLORS: Record<ServerStatus, number> = {
  idle: 0x22c55e, // green
  active: 0x3b82f6, // blue
  overloaded: 0xfbbf24, // amber
  error: 0xef4444, // red
};

/**
 * PixiJS entity representing the Server Room zone in the office scene.
 *
 * Visual elements:
 * - Server status indicator light (top-right corner)
 * - Active connections count text
 * - Load pulse animation when active/overloaded
 *
 * All animations follow the project motion-bucket convention (M0-M3).
 */
export class ServerRoomEntity {
  readonly container: Container;

  private readonly zone: ZoneBounds;
  private readonly motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>;

  /** Server status indicator light. */
  private readonly statusLight: Graphics;
  /** Active connections label. */
  private readonly connectionText: Text;
  /** Semi-transparent load pulse overlay. */
  private loadPulse: Graphics | null = null;

  private activeTweens: gsap.core.Tween[] = [];

  constructor(zone: ZoneBounds, motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>) {
    this.zone = zone;
    this.motion = motion;
    this.container = new Container();

    // --- Status light ---
    this.statusLight = new Graphics();
    this.drawStatusLight('idle');
    this.statusLight.position.set(zone.x + zone.width - 30, zone.y + 10);
    this.container.addChild(this.statusLight);

    // --- Connection count text ---
    this.connectionText = new Text({
      text: '',
      style: { fontSize: 12, fill: 0xffffff },
    });
    this.connectionText.position.set(zone.x + zone.width - 120, zone.y + 4);
    this.container.addChild(this.connectionText);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Set the server status indicator.
   * - idle: solid green
   * - active: blue, slow pulse
   * - overloaded: amber, fast pulse
   * - error: solid red
   */
  setServerStatus(status: ServerStatus): void {
    this.killPulseTweens();
    this.drawStatusLight(status);

    const { duration, ease } = this.motion.M3;

    if (status === 'active' && duration > 0) {
      const tw = gsap.to(this.statusLight, {
        alpha: 0.3,
        duration: duration * 2,
        ease,
        repeat: -1,
        yoyo: true,
      });
      this.activeTweens.push(tw);
    } else if (status === 'overloaded' && duration > 0) {
      const tw = gsap.to(this.statusLight, {
        alpha: 0.2,
        duration: duration * 0.6,
        ease,
        repeat: -1,
        yoyo: true,
      });
      this.activeTweens.push(tw);
    }
  }

  /**
   * Trigger a load pulse animation across the zone.
   * A horizontal bar sweeps left-to-right indicating server activity.
   */
  showLoadPulse(): void {
    this.removeLoadPulse();

    const bar = new Graphics();
    bar.rect(0, 0, 16, this.zone.height);
    bar.fill({ color: 0x3b82f6, alpha: 0.2 });
    bar.position.set(this.zone.x, this.zone.y);
    this.loadPulse = bar;
    this.container.addChild(bar);

    const { ease } = this.motion.M2;
    const tw = gsap.to(bar.position, {
      x: this.zone.x + this.zone.width,
      duration: 2.5,
      ease,
      onComplete: () => {
        this.removeLoadPulse();
      },
    });
    this.activeTweens.push(tw);
  }

  /**
   * Update the active connections display.
   * Shows nothing when n <= 0.
   */
  setConnectionCount(n: number): void {
    this.connectionText.text = n > 0 ? `\u26A1 ${n} conn` : '';
  }

  /** Kill all running GSAP tweens and destroy the container. */
  destroy(): void {
    for (const tw of this.activeTweens) {
      tw.kill();
    }
    this.activeTweens = [];
    this.removeLoadPulse();
    this.container.destroy({ children: true });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private drawStatusLight(status: ServerStatus): void {
    this.statusLight.clear();
    this.statusLight.circle(0, 0, 6);
    this.statusLight.fill({ color: SERVER_STATUS_COLORS[status] });
    this.statusLight.alpha = 1;
  }

  private killPulseTweens(): void {
    for (const tw of this.activeTweens) {
      tw.kill();
    }
    this.activeTweens = [];
  }

  private removeLoadPulse(): void {
    if (this.loadPulse) {
      this.container.removeChild(this.loadPulse);
      this.loadPulse.destroy();
      this.loadPulse = null;
    }
  }
}
