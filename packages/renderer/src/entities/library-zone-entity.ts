import gsap from 'gsap';
import { Container, Graphics, Text } from 'pixi.js';
import type { MotionBucket } from '../tokens/motion.js';

/**
 * Bounding rectangle for a zone in the office layout.
 * Mirrors the shape expected by zone-layout-engine once it lands.
 */
export interface ZoneBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type RagStatus = 'idle' | 'indexing' | 'searching' | 'error';

const RAG_STATUS_COLORS: Record<RagStatus, number> = {
  idle: 0x22c55e, // green
  indexing: 0x3b82f6, // blue
  searching: 0xeab308, // yellow
  error: 0xef4444, // red
};

/**
 * PixiJS entity representing the Library / RAG zone in the office scene.
 *
 * Visual elements:
 * - RAG status indicator light (top-right corner)
 * - Document count text label
 * - Search-activity scan-line animation
 *
 * All animations follow the project motion-bucket convention (M0-M3).
 */
export class LibraryZoneEntity {
  readonly container: Container;

  private readonly zone: ZoneBounds;
  private readonly motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>;

  /** RAG status indicator light. */
  private readonly statusLight: Graphics;
  /** Document count label. */
  private readonly docCountText: Text;
  /** Semi-transparent scan bar for search animation. */
  private scanBar: Graphics | null = null;

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

    // --- Doc count text ---
    this.docCountText = new Text({
      text: '',
      style: { fontSize: 12, fill: 0xffffff },
    });
    this.docCountText.position.set(zone.x + zone.width - 120, zone.y + 4);
    this.container.addChild(this.docCountText);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Set the RAG status indicator.
   * - idle: solid green
   * - indexing: blue, blinking
   * - searching: yellow, fast blinking
   * - error: solid red
   */
  setRagStatus(status: RagStatus): void {
    // Kill any existing blink tweens
    this.killBlinkTweens();

    this.drawStatusLight(status);

    const { duration, ease } = this.motion.M3;

    if (status === 'indexing' && duration > 0) {
      const tw = gsap.to(this.statusLight, {
        alpha: 0.2,
        duration: duration * 2,
        ease,
        repeat: -1,
        yoyo: true,
      });
      this.activeTweens.push(tw);
    } else if (status === 'searching' && duration > 0) {
      const tw = gsap.to(this.statusLight, {
        alpha: 0.2,
        duration: duration * 0.8,
        ease,
        repeat: -1,
        yoyo: true,
      });
      this.activeTweens.push(tw);
    }
  }

  /**
   * Trigger a search-activity scan-line animation across the zone.
   * The scan bar sweeps left-to-right and auto-removes after ~3 seconds.
   */
  showSearchActivity(): void {
    // Clean up any existing scan bar
    this.removeScanBar();

    const bar = new Graphics();
    bar.rect(0, 0, 20, this.zone.height);
    bar.fill({ color: 0x3b82f6, alpha: 0.25 });
    bar.position.set(this.zone.x, this.zone.y);
    this.scanBar = bar;
    this.container.addChild(bar);

    const { ease } = this.motion.M2;
    const tw = gsap.to(bar.position, {
      x: this.zone.x + this.zone.width,
      duration: 3,
      ease,
      onComplete: () => {
        this.removeScanBar();
      },
    });
    this.activeTweens.push(tw);
  }

  /**
   * Update the document count display.
   * Shows nothing when n <= 0.
   */
  setDocCount(n: number): void {
    this.docCountText.text = n > 0 ? `\uD83D\uDCDA ${n} docs` : '';
  }

  /** Kill all running GSAP tweens and destroy the container. */
  destroy(): void {
    for (const tw of this.activeTweens) {
      tw.kill();
    }
    this.activeTweens = [];
    this.removeScanBar();
    this.container.destroy({ children: true });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private drawStatusLight(status: RagStatus): void {
    this.statusLight.clear();
    this.statusLight.circle(0, 0, 6);
    this.statusLight.fill({ color: RAG_STATUS_COLORS[status] });
    this.statusLight.alpha = 1;
  }

  private killBlinkTweens(): void {
    for (const tw of this.activeTweens) {
      tw.kill();
    }
    this.activeTweens = [];
  }

  private removeScanBar(): void {
    if (this.scanBar) {
      this.container.removeChild(this.scanBar);
      this.scanBar.destroy();
      this.scanBar = null;
    }
  }
}
