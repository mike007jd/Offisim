import type { EmployeeState } from '@aics/shared-types';
import gsap from 'gsap';
import { Container, Graphics, Text } from 'pixi.js';
import { drawPixelGrid, idToHue } from '../pixel/draw-pixel-grid.js';
import { PX, PIXEL_PALETTE } from '../pixel/pixel-palette.js';
import {
  LOBSTER_BODY,
  LOBSTER_CLAW_L,
  LOBSTER_CLAW_R,
  LOBSTER_EYES,
  LOBSTER_LEGS,
  LOBSTER_ANTENNA_L,
  LOBSTER_ANTENNA_R,
} from '../pixel/lobster-shapes.js';
import { STATE_COLORS } from '../tokens/colors.js';
import { LAYOUT } from '../tokens/layout.js';
import type { MotionBucket } from '../tokens/motion.js';

/**
 * Pixel-art lobster employee entity.
 *
 * Replaces the circle-based EmployeeEntity with a procedurally tinted
 * lobster avatar. Each employee gets a unique body color derived from
 * their ID via `idToHue()`.
 *
 * Public API is identical to EmployeeEntity so SceneManager integration
 * requires no changes.
 */
export class LobsterEntity {
  readonly container: Container;
  readonly id: string;

  private state: EmployeeState = 'idle';
  private highlighted = false;
  private pulseTween: gsap.core.Tween | null = null;
  /** Track all active one-shot tweens for cleanup. */
  private activeTweens: gsap.core.Tween[] = [];

  private readonly ring: Graphics;
  private readonly label: Text;
  private readonly taskBubble: Container;
  private readonly taskText: Text;
  private readonly motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>;
  private taskBubbleBg: Graphics | null = null;

  /** Per-employee palette (index 8 replaced with unique hue) */
  readonly palette: number[];

  constructor(id: string, name: string, motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>) {
    this.id = id;
    this.motion = motion;
    this.container = new Container();

    // --- Unique color per employee ---
    const bodyColor = idToHue(id);
    this.palette = [...PIXEL_PALETTE];
    this.palette[8] = bodyColor; // replace lobster-red with unique hue

    // --- Dimension calculations ---
    const bodyW = LOBSTER_BODY[0]!.length * PX;
    const bodyH = LOBSTER_BODY.length * PX;
    const clawLW = LOBSTER_CLAW_L[0]!.length * PX;
    const clawLH = LOBSTER_CLAW_L.length * PX;
    const clawRH = LOBSTER_CLAW_R.length * PX;
    const eyesW = LOBSTER_EYES[0]!.length * PX;
    const eyesH = LOBSTER_EYES.length * PX;
    const legsW = LOBSTER_LEGS[0]!.length * PX;
    const antennaLH = LOBSTER_ANTENNA_L.length * PX;
    const antennaRH = LOBSTER_ANTENNA_R.length * PX;

    // --- State ring (pixel-style square outline) ---
    const ringPadding = 12;
    const ringSize = Math.max(bodyW, bodyH) + ringPadding;
    this.ring = new Graphics();
    this.drawRing(STATE_COLORS.idle, ringSize);
    this.container.addChild(this.ring);

    // --- Legs (behind body) ---
    const legsGfx = new Graphics();
    drawPixelGrid(legsGfx, LOBSTER_LEGS, 0, 0, this.palette);
    legsGfx.position.set(-legsW / 2, bodyH / 2);
    this.container.addChild(legsGfx);

    // --- Body (centered at origin) ---
    const bodyGfx = new Graphics();
    drawPixelGrid(bodyGfx, LOBSTER_BODY, 0, 0, this.palette);
    bodyGfx.position.set(-bodyW / 2, -bodyH / 2);
    this.container.addChild(bodyGfx);

    // --- Left claw ---
    const clawL = new Graphics();
    drawPixelGrid(clawL, LOBSTER_CLAW_L, 0, 0, this.palette);
    clawL.position.set(-bodyW / 2 - clawLW, -bodyH / 4);
    // Pivot at the base (right edge, vertical center) for rotation
    clawL.pivot.set(clawLW, clawLH / 2);
    this.container.addChild(clawL);

    // --- Right claw ---
    const clawR = new Graphics();
    drawPixelGrid(clawR, LOBSTER_CLAW_R, 0, 0, this.palette);
    clawR.position.set(bodyW / 2, -bodyH / 4);
    // Pivot at the base (left edge, vertical center) for rotation
    clawR.pivot.set(0, clawRH / 2);
    this.container.addChild(clawR);

    // --- Eyes (above body center) ---
    const eyesGfx = new Graphics();
    drawPixelGrid(eyesGfx, LOBSTER_EYES, 0, 0, this.palette);
    eyesGfx.position.set(-eyesW / 2, -bodyH / 2 - eyesH);
    this.container.addChild(eyesGfx);

    // --- Left antenna (above left eye) ---
    const antennaL = new Graphics();
    drawPixelGrid(antennaL, LOBSTER_ANTENNA_L, 0, 0, this.palette);
    antennaL.position.set(eyesGfx.position.x + PX, eyesGfx.position.y - antennaLH);
    this.container.addChild(antennaL);

    // --- Right antenna (above right eye) ---
    const antennaR = new Graphics();
    drawPixelGrid(antennaR, LOBSTER_ANTENNA_R, 0, 0, this.palette);
    antennaR.position.set(
      eyesGfx.position.x + eyesW - 2 * PX,
      eyesGfx.position.y - antennaRH,
    );
    this.container.addChild(antennaR);

    // --- Name label ---
    this.label = new Text({
      text: name,
      style: {
        fontSize: LAYOUT.employee.fontSize,
        fill: 0x334155,
        fontFamily: 'Pixelify Sans, system-ui',
      },
    });
    this.label.anchor.set(0.5, 0);
    this.label.position.set(0, LAYOUT.employee.labelOffsetY);
    this.container.addChild(this.label);

    // --- Task bubble (hidden by default) ---
    this.taskBubble = new Container();
    this.taskBubble.visible = false;
    this.taskText = new Text({
      text: '',
      style: {
        fontSize: LAYOUT.taskBubble.fontSize,
        fill: 0xffffff,
        fontFamily: 'Pixelify Sans, system-ui',
      },
    });
    this.taskText.anchor.set(0.5);
    this.taskBubble.position.set(0, LAYOUT.taskBubble.offsetY);
    this.taskBubble.addChild(this.taskText);
    this.container.addChild(this.taskBubble);
  }

  /** Update employee state with animation */
  setState(next: EmployeeState): void {
    if (this.state === next) return;
    this.state = next;
    const color = STATE_COLORS[next];

    // Stop any existing pulse
    this.stopPulse();

    this.drawRing(color);

    const { duration, ease } = this.motion.M2;
    if (duration > 0) {
      if (next === 'blocked' || next === 'failed') {
        // Shake animation for error states
        this.trackTween(
          gsap.fromTo(
            this.container,
            { x: this.container.x - 3 },
            {
              x: this.container.x + 3,
              duration: 0.08,
              ease: 'none',
              yoyo: true,
              repeat: 5,
            },
          ),
        );
      } else if (next === 'success') {
        // Pop animation for success
        this.trackTween(
          gsap.fromTo(
            this.ring.scale,
            { x: 1, y: 1 },
            {
              x: 1.25,
              y: 1.25,
              duration: duration / 2,
              ease: 'back.out(2)',
              yoyo: true,
              repeat: 1,
            },
          ),
        );
      } else {
        // Standard scale bounce for other transitions
        this.trackTween(
          gsap.fromTo(
            this.ring.scale,
            { x: 1, y: 1 },
            {
              x: 1.15,
              y: 1.15,
              duration: duration / 2,
              ease,
              yoyo: true,
              repeat: 1,
            },
          ),
        );
      }
    }

    // Start continuous pulse for active work states
    if (isActiveState(next) && this.motion.M1.duration > 0) {
      this.pulseTween = gsap.to(this.ring.scale, {
        x: 1.08,
        y: 1.08,
        duration: this.motion.M1.duration,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
      });
    }
  }

  /** Set or clear the current task */
  setTask(taskId: string | null): void {
    if (taskId) {
      this.taskText.text = taskId.length > 16 ? `${taskId.slice(0, 14)}...` : taskId;
      this.drawTaskBubbleBg();
      this.taskBubble.visible = true;
      const { duration, ease } = this.motion.M3;
      if (duration > 0) {
        this.taskBubble.alpha = 0;
        this.trackTween(gsap.to(this.taskBubble, { alpha: 1, duration, ease }));
      }
    } else {
      this.taskBubble.visible = false;
    }
  }

  /** Toggle highlight glow */
  setHighlight(on: boolean): void {
    if (this.highlighted === on) return;
    this.highlighted = on;
    const { duration, ease } = this.motion.M3;
    const targetScale = on ? 1.1 : 1.0;
    if (duration > 0) {
      this.trackTween(
        gsap.to(this.container.scale, { x: targetScale, y: targetScale, duration, ease }),
      );
    } else {
      this.container.scale.set(targetScale);
    }
  }

  /** Kill all running GSAP tweens and reset state. */
  destroy(): void {
    this.stopPulse();
    for (const tw of this.activeTweens) {
      tw.kill();
    }
    this.activeTweens = [];
  }

  // ---- Private helpers ----

  private stopPulse(): void {
    if (this.pulseTween) {
      this.pulseTween.kill();
      this.pulseTween = null;
      this.ring.scale.set(1);
    }
  }

  /** Track a one-shot tween and auto-remove when it completes. */
  private trackTween(tw: gsap.core.Tween): void {
    this.activeTweens.push(tw);
    const origOnComplete = tw.vars.onComplete;
    tw.vars.onComplete = () => {
      const idx = this.activeTweens.indexOf(tw);
      if (idx >= 0) this.activeTweens.splice(idx, 1);
      if (origOnComplete) origOnComplete();
    };
  }

  /**
   * Draw the state ring as a square outline.
   * @param ringSize - If provided, overrides the default ring size calculation.
   */
  private drawRing(color: number, ringSize?: number): void {
    const size =
      ringSize ??
      Math.max(LOBSTER_BODY[0]!.length * PX, LOBSTER_BODY.length * PX) + 12;
    const { ringWidth } = LAYOUT.employee;
    this.ring.clear();
    this.ring.rect(-size / 2, -size / 2, size, size);
    this.ring.stroke({ color, width: ringWidth });
  }

  private drawTaskBubbleBg(): void {
    const { padding, cornerRadius } = LAYOUT.taskBubble;
    const width = this.taskText.width + padding * 2;
    const height = this.taskText.height + padding * 2;

    // Remove old bg
    if (this.taskBubbleBg) {
      this.taskBubble.removeChild(this.taskBubbleBg);
      this.taskBubbleBg.destroy();
    }

    const bg = new Graphics();
    bg.roundRect(-width / 2, -height / 2, width, height, cornerRadius);
    bg.fill({ color: 0x334155, alpha: 0.9 });
    this.taskBubble.addChildAt(bg, 0);
    this.taskBubbleBg = bg;
  }
}

const ACTIVE_STATES: ReadonlySet<EmployeeState> = new Set(['thinking', 'searching', 'executing']);

function isActiveState(state: EmployeeState): boolean {
  return ACTIVE_STATES.has(state);
}
