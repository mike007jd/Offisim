// ── InstallGhostEntity ────────────────────────────────────────────────
// Visual placeholder shown in the office scene while an asset is being
// installed. Shows a translucent geometric puppet shape with a progress
// bar and transitions to a settled (installed) or failed state.
//
// ANIM-024 (ghost creation), ANIM-025 (settle), ANIM-026 (fail/remove)

import gsap from 'gsap';
import { Container, Graphics } from 'pixi.js';
import { M1, M2 } from '../tokens/motion.js';

/** Ghost color defaults — slate-blue translucent figure */
const DEFAULT_GHOST_COLOR = 0x7c9bce;
const PROGRESS_BAR_BG_COLOR = 0x334155;
const PROGRESS_BAR_FILL_COLOR = 0x60a5fa;
const SUCCESS_FLASH_COLOR = 0x22c55e;
const FAIL_TINT_COLOR = 0xff4444;

/** Ghost figure dimensions (matches puppet proportions roughly) */
const BODY_WIDTH = 16;
const BODY_HEIGHT = 18;
const BODY_CORNER_RADIUS = 4;
const HEAD_RADIUS = 7;
const HEAD_Y_OFFSET = -(BODY_HEIGHT / 2 + HEAD_RADIUS + 2);

const PROGRESS_BAR_WIDTH = BODY_WIDTH + 8;
const PROGRESS_BAR_HEIGHT = 3;
const PROGRESS_BAR_Y = BODY_HEIGHT / 2 + 5;

export interface InstallGhostConfig {
  x: number;
  y: number;
  color?: number;
}

export class InstallGhostEntity {
  /** Root PixiJS container — add to a scene layer. */
  readonly container: Container;

  private readonly bodyGfx: Graphics;
  private readonly headGfx: Graphics;
  private readonly progressBg: Graphics;
  private readonly progressFill: Graphics;

  private pulseTween: gsap.core.Tween | null = null;

  constructor(config: InstallGhostConfig) {
    this.container = new Container();
    this.container.position.set(config.x, config.y);

    const color = config.color ?? DEFAULT_GHOST_COLOR;

    // ── Body (rounded rect) ──
    this.bodyGfx = new Graphics();
    this.bodyGfx.roundRect(-BODY_WIDTH / 2, -BODY_HEIGHT / 2, BODY_WIDTH, BODY_HEIGHT, BODY_CORNER_RADIUS);
    this.bodyGfx.fill({ color, alpha: 1 });
    this.container.addChild(this.bodyGfx);

    // ── Head (circle) ──
    this.headGfx = new Graphics();
    this.headGfx.circle(0, 0, HEAD_RADIUS);
    this.headGfx.fill({ color, alpha: 1 });
    this.headGfx.position.set(0, HEAD_Y_OFFSET);
    this.container.addChild(this.headGfx);

    // ── Progress bar background ──
    this.progressBg = new Graphics();
    this.progressBg.roundRect(-PROGRESS_BAR_WIDTH / 2, 0, PROGRESS_BAR_WIDTH, PROGRESS_BAR_HEIGHT, 1);
    this.progressBg.fill({ color: PROGRESS_BAR_BG_COLOR, alpha: 0.8 });
    this.progressBg.position.set(0, PROGRESS_BAR_Y);
    this.container.addChild(this.progressBg);

    // ── Progress bar fill (starts at 0 width) ──
    this.progressFill = new Graphics();
    this.progressFill.position.set(0, PROGRESS_BAR_Y);
    this.container.addChild(this.progressFill);
    this._drawProgressFill(0);

    // ── Initial state: translucent ──
    this.container.alpha = 0.4;

    // ── ANIM-024: pulsing opacity (0.3↔0.5, 2s loop) ──
    this.pulseTween = gsap.to(this.container, {
      alpha: 0.5,
      duration: 1,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
      // Start from 0.3 at first tick via fromTo-style initial value
    });
    // Override start alpha after tween is created
    this.container.alpha = 0.3;
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Update the progress bar to `fraction` [0, 1].
   * Redraws the fill graphics.
   */
  setProgress(fraction: number): void {
    const clamped = Math.max(0, Math.min(1, fraction));
    this._drawProgressFill(clamped);
  }

  /**
   * ANIM-025: settle animation — ghost solidifies as an installed employee.
   * alpha 0.3–0.5 → 1.0, scale 0.9 → 1.0, brief green flash, 600ms.
   */
  settleAsInstalled(): void {
    this._stopPulse();

    // Full progress bar
    this._drawProgressFill(1);

    const dur = M1.duration > 0 ? M1.duration : 0.6;
    const ease = M1.ease;

    // Scale pop from 0.9 → 1.0
    this.container.scale.set(0.9);
    gsap.to(this.container.scale, { x: 1, y: 1, duration: dur, ease });

    // Alpha solidify
    gsap.to(this.container, { alpha: 1, duration: dur, ease });

    // Brief green flash on body: tint to green then fade back
    const flashDur = 0.18;
    const flashTl = gsap.timeline();
    flashTl.to(this.bodyGfx, { alpha: 0, duration: flashDur / 2, ease: 'power2.out' }, 0);

    // Draw a green overlay briefly
    const flashGfx = new Graphics();
    flashGfx.roundRect(-BODY_WIDTH / 2, -BODY_HEIGHT / 2, BODY_WIDTH, BODY_HEIGHT, BODY_CORNER_RADIUS);
    flashGfx.fill({ color: SUCCESS_FLASH_COLOR, alpha: 0.8 });
    flashGfx.alpha = 0;
    this.container.addChild(flashGfx);

    flashTl.to(flashGfx, { alpha: 0.8, duration: flashDur / 2, ease: 'power2.out' }, 0);
    flashTl.to(flashGfx, { alpha: 0, duration: flashDur, ease: 'power2.in' }, flashDur / 2);
    flashTl.to(this.bodyGfx, { alpha: 1, duration: flashDur / 2, ease: 'power2.in' }, flashDur / 2);
    flashTl.call(() => {
      if (flashGfx.parent) flashGfx.parent.removeChild(flashGfx);
      flashGfx.destroy();
    });
  }

  /**
   * ANIM-026: tint to red, alpha → 0, scale → 0.8, 400ms, then destroy self.
   */
  failAndRemove(): void {
    this._stopPulse();

    const dur = M2.duration > 0 ? M2.duration : 0.4;
    const ease = M2.ease;

    // Tint body + head to red
    this.bodyGfx.clear();
    this.bodyGfx.roundRect(-BODY_WIDTH / 2, -BODY_HEIGHT / 2, BODY_WIDTH, BODY_HEIGHT, BODY_CORNER_RADIUS);
    this.bodyGfx.fill({ color: FAIL_TINT_COLOR, alpha: 1 });

    this.headGfx.clear();
    this.headGfx.circle(0, 0, HEAD_RADIUS);
    this.headGfx.fill({ color: FAIL_TINT_COLOR, alpha: 1 });

    gsap.to(this.container, {
      alpha: 0,
      duration: dur,
      ease,
    });
    gsap.to(this.container.scale, {
      x: 0.8,
      y: 0.8,
      duration: dur,
      ease,
      onComplete: () => {
        this.destroy();
      },
    });
  }

  /** Kill all GSAP tweens and destroy the PixiJS container hierarchy. */
  destroy(): void {
    this._stopPulse();
    gsap.killTweensOf(this.container);
    gsap.killTweensOf(this.container.scale);
    gsap.killTweensOf(this.bodyGfx);
    gsap.killTweensOf(this.headGfx);
    if (this.container.parent) {
      this.container.parent.removeChild(this.container);
    }
    this.container.destroy({ children: true });
  }

  // ── Private helpers ────────────────────────────────────────────────

  private _stopPulse(): void {
    if (this.pulseTween) {
      this.pulseTween.kill();
      this.pulseTween = null;
    }
  }

  private _drawProgressFill(fraction: number): void {
    this.progressFill.clear();
    if (fraction <= 0) return;
    const fillWidth = PROGRESS_BAR_WIDTH * fraction;
    this.progressFill.roundRect(-PROGRESS_BAR_WIDTH / 2, 0, fillWidth, PROGRESS_BAR_HEIGHT, 1);
    this.progressFill.fill({ color: PROGRESS_BAR_FILL_COLOR, alpha: 1 });
  }
}
