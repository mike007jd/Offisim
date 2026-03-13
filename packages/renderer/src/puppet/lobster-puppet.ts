// ── LobsterPuppet ────────────────────────────────────────────────────
// Vector-style lobster character (OpenClaw brand) using PixiJS Graphics
// API with GSAP animation. Extends BasePuppet so it plugs into the
// SceneManager identically to EmployeePuppet.

import { BasePuppet, type MotionTokenSet } from './base-puppet.js';
import type { PuppetAnimState } from './types.js';
import gsap from 'gsap';
import { Container, Graphics } from 'pixi.js';

// ── Color helpers ────────────────────────────────────────────────────

/** Lighten a 24-bit hex color by `pct` (0-1). */
function lighten(color: number, pct: number): number {
  const r = Math.min(255, ((color >> 16) & 0xff) + Math.round(255 * pct));
  const g = Math.min(255, ((color >> 8) & 0xff) + Math.round(255 * pct));
  const b = Math.min(255, (color & 0xff) + Math.round(255 * pct));
  return (r << 16) | (g << 8) | b;
}

/** Darken a 24-bit hex color by `pct` (0-1). */
function darken(color: number, pct: number): number {
  const r = Math.max(0, ((color >> 16) & 0xff) - Math.round(255 * pct));
  const g = Math.max(0, ((color >> 8) & 0xff) - Math.round(255 * pct));
  const b = Math.max(0, (color & 0xff) - Math.round(255 * pct));
  return (r << 16) | (g << 8) | b;
}

// ── Lobster geometry constants ───────────────────────────────────────

const LOBSTER = {
  carapace: { rx: 7, ry: 10 },
  claw: { armW: 4, armH: 10, pincerR: 3 },
  antenna: { width: 2, length: 12 },
  leg: { width: 2, height: 6 },
  tail: { width: 10, height: 6 },
  eye: { stalkW: 2, stalkH: 4, radius: 3, pupilR: 1.5 },
} as const;

// ── LobsterPuppet ────────────────────────────────────────────────────

export class LobsterPuppet extends BasePuppet {
  // Body parts
  private carapace!: Graphics;
  private clawL!: Container;
  private clawR!: Container;
  private antennaL!: Container;
  private antennaR!: Container;
  private legs!: Container[];
  private tail!: Container;
  private eyeL!: Container;
  private eyeR!: Container;

  private readonly brandColor: number;

  constructor(id: string, name: string, motion: MotionTokenSet, brandColor: number = 0xe74c3c) {
    super(id, name, motion);
    this.brandColor = brandColor;
    this.buildBody();
    this.createAnimTimeline('idle');
  }

  // ── buildBody ──────────────────────────────────────────────────────

  protected buildBody(): void {
    const { brandColor } = this;
    const belly = lighten(brandColor, 0.2);
    const dark = darken(brandColor, 0.12);
    const { carapace: cDim, claw: clDim, antenna: aDim, leg: lDim, eye: eDim } = LOBSTER;

    // --- Tail (behind everything) ---
    this.tail = this.buildTail(dark);
    this.tail.position.set(0, cDim.ry);
    this.tail.pivot.set(0, 0);
    this.body.addChild(this.tail);

    // --- Legs (3 per side, behind carapace) ---
    this.legs = [];
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const idx = i < 3 ? i : i - 3;
      const leg = new Container();
      const g = new Graphics();
      g.roundRect(0, 0, lDim.width, lDim.height, 1);
      g.fill(dark);
      leg.addChild(g);
      leg.pivot.set(lDim.width / 2, 0);
      // Distribute along body side
      const yOff = -cDim.ry / 2 + idx * (cDim.ry * 0.8);
      leg.position.set(side * (cDim.rx + 1), yOff);
      leg.rotation = side * 0.3;
      this.body.addChild(leg);
      this.legs.push(leg);
    }

    // --- Carapace (main body) ---
    this.carapace = new Graphics();
    // Main shell
    this.carapace.ellipse(0, 0, cDim.rx, cDim.ry);
    this.carapace.fill(brandColor);
    // Belly highlight (slightly smaller, lower)
    this.carapace.ellipse(0, cDim.ry * 0.15, cDim.rx * 0.65, cDim.ry * 0.6);
    this.carapace.fill(belly);
    this.body.addChild(this.carapace);

    // --- Claws ---
    this.clawL = this.buildClaw(brandColor, dark, -1);
    this.clawL.position.set(-cDim.rx - clDim.armW / 2, -cDim.ry * 0.5);
    this.clawL.pivot.set(0, clDim.armH);
    this.body.addChild(this.clawL);

    this.clawR = this.buildClaw(brandColor, dark, 1);
    this.clawR.position.set(cDim.rx + clDim.armW / 2, -cDim.ry * 0.5);
    this.clawR.pivot.set(0, clDim.armH);
    this.body.addChild(this.clawR);

    // --- Eyes ---
    this.eyeL = this.buildEye(eDim);
    this.eyeL.position.set(-3, -cDim.ry - eDim.stalkH);
    this.body.addChild(this.eyeL);

    this.eyeR = this.buildEye(eDim);
    this.eyeR.position.set(3, -cDim.ry - eDim.stalkH);
    this.body.addChild(this.eyeR);

    // --- Antennae ---
    this.antennaL = this.buildAntenna(dark, -1);
    this.antennaL.position.set(-2, -cDim.ry - eDim.stalkH - eDim.radius);
    this.antennaL.pivot.set(0, aDim.length);
    this.body.addChild(this.antennaL);

    this.antennaR = this.buildAntenna(dark, 1);
    this.antennaR.position.set(2, -cDim.ry - eDim.stalkH - eDim.radius);
    this.antennaR.pivot.set(0, aDim.length);
    this.body.addChild(this.antennaR);
  }

  // ── Part builders ──────────────────────────────────────────────────

  private buildClaw(color: number, darkColor: number, side: number): Container {
    const { armW, armH, pincerR } = LOBSTER.claw;
    const c = new Container();

    // Arm
    const arm = new Graphics();
    arm.roundRect(-armW / 2, 0, armW, armH, 1);
    arm.fill(color);
    c.addChild(arm);

    // Pincer — two arcs forming a claw shape
    const pincer = new Graphics();
    // Upper pincer half
    pincer.moveTo(0, -pincerR);
    pincer.bezierCurveTo(side * pincerR * 1.5, -pincerR, side * pincerR * 1.5, 0, 0, 0);
    pincer.fill(darkColor);
    // Lower pincer half
    pincer.moveTo(0, pincerR * 0.5);
    pincer.bezierCurveTo(side * pincerR * 1.2, pincerR * 0.5, side * pincerR * 1.2, -0.5, 0, -0.5);
    pincer.fill(darkColor);
    pincer.position.set(0, -pincerR);
    c.addChild(pincer);

    return c;
  }

  private buildEye(eDim: typeof LOBSTER.eye): Container {
    const c = new Container();

    // Stalk
    const stalk = new Graphics();
    stalk.roundRect(-eDim.stalkW / 2, 0, eDim.stalkW, eDim.stalkH, 1);
    stalk.fill(darken(this.brandColor, 0.05));
    c.addChild(stalk);

    // Eyeball
    const eye = new Graphics();
    eye.circle(0, 0, eDim.radius);
    eye.fill(0xffffff);
    // Pupil
    eye.circle(0, 0, eDim.pupilR);
    eye.fill(0x111111);
    eye.position.set(0, -1);
    c.addChild(eye);

    return c;
  }

  private buildAntenna(color: number, side: number): Container {
    const { width, length } = LOBSTER.antenna;
    const c = new Container();

    const g = new Graphics();
    g.moveTo(0, length);
    g.bezierCurveTo(side * 4, length * 0.5, side * 6, length * 0.2, side * 3, 0);
    g.stroke({ color, width });
    c.addChild(g);

    return c;
  }

  private buildTail(color: number): Container {
    const { width, height } = LOBSTER.tail;
    const c = new Container();

    const g = new Graphics();
    // Central fan segment
    g.moveTo(0, 0);
    g.bezierCurveTo(-width * 0.15, height * 0.5, -width * 0.1, height, 0, height);
    g.bezierCurveTo(width * 0.1, height, width * 0.15, height * 0.5, 0, 0);
    g.fill(color);
    // Left fan
    g.moveTo(0, 0);
    g.bezierCurveTo(-width * 0.3, height * 0.4, -width * 0.4, height * 0.8, -width * 0.3, height);
    g.bezierCurveTo(-width * 0.2, height * 0.7, -width * 0.1, height * 0.3, 0, 0);
    g.fill(lighten(color, 0.08));
    // Right fan
    g.moveTo(0, 0);
    g.bezierCurveTo(width * 0.3, height * 0.4, width * 0.4, height * 0.8, width * 0.3, height);
    g.bezierCurveTo(width * 0.2, height * 0.7, width * 0.1, height * 0.3, 0, 0);
    g.fill(lighten(color, 0.08));
    c.addChild(g);

    return c;
  }

  // ── createAnimTimeline ─────────────────────────────────────────────

  protected createAnimTimeline(state: PuppetAnimState): gsap.core.Timeline {
    const { M1, M2 } = this.motion;

    const tl = gsap.timeline({ repeat: -1, yoyo: true });

    switch (state) {
      // -------- idle: gentle bob + antenna sway + claw micro-wiggle --------
      case 'idle': {
        tl.to(this.body, { y: -0.5, duration: 3, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaL, { rotation: 0.1, duration: 2.5, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaR, { rotation: -0.1, duration: 2.7, ease: 'sine.inOut' }, 0);
        tl.to(this.clawL, { rotation: -0.03, duration: 2, ease: 'sine.inOut' }, 0);
        tl.to(this.clawR, { rotation: 0.03, duration: 2, ease: 'sine.inOut' }, 0);
        break;
      }

      // -------- walking: tripod gait, body lean, antenna bob --------
      case 'walking': {
        const d = M2.duration || 0.3;
        // Tripod gait: legs 0,1,2 alternate with 3,4,5
        for (let i = 0; i < 3; i++) {
          tl.to(this.legs[i]!, { rotation: this.legs[i]!.rotation + 0.3, duration: d, ease: 'power1.inOut' }, 0);
          tl.to(this.legs[i + 3]!, { rotation: this.legs[i + 3]!.rotation - 0.3, duration: d, ease: 'power1.inOut' }, 0);
        }
        tl.to(this.body, { rotation: 0.05, duration: d, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaL, { y: -1, duration: d * 0.8, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaR, { y: -1, duration: d * 0.8, ease: 'sine.inOut' }, 0.1);
        break;
      }

      // -------- sitting: legs tucked, claws resting, antenna sway --------
      case 'sitting': {
        // Tuck legs inward
        for (const leg of this.legs) {
          tl.to(leg, { rotation: 0, duration: 0.5, ease: 'power2.out' }, 0);
        }
        tl.to(this.antennaL, { rotation: 0.08, duration: 3, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaR, { rotation: -0.08, duration: 3.2, ease: 'sine.inOut' }, 0);
        break;
      }

      // -------- working: sitting + fast claw open/close --------
      case 'working': {
        const wd = M1.duration || 0.6;
        tl.to(this.clawL, { rotation: -0.15, duration: wd * 0.3, ease: 'power1.inOut' }, 0);
        tl.to(this.clawR, { rotation: 0.15, duration: wd * 0.3, ease: 'power1.inOut' }, 0.05);
        tl.to(this.antennaL, { rotation: 0.05, duration: wd, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaR, { rotation: -0.05, duration: wd, ease: 'sine.inOut' }, 0);
        tl.to(this.body, { y: -0.3, duration: wd, ease: 'sine.inOut' }, 0);
        break;
      }

      // -------- thinking: claw up near chin, antenna lean, body tilt --------
      case 'thinking': {
        const td = M1.duration || 0.6;
        tl.to(this.clawL, { rotation: -0.3, y: this.clawL.position.y - 2, duration: td, ease: 'sine.inOut' }, 0);
        tl.to(this.clawR, { rotation: 0.05, duration: td * 1.2, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaL, { rotation: 0.2, duration: td, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaR, { rotation: -0.2, duration: td * 1.1, ease: 'sine.inOut' }, 0);
        tl.to(this.body, { rotation: -0.04, duration: td * 1.5, ease: 'sine.inOut' }, 0);
        break;
      }

      // -------- talking: claws gesture, antenna emphasize --------
      case 'talking': {
        const tkd = M1.duration || 0.6;
        tl.to(this.clawL, { rotation: -0.2, duration: tkd * 0.4, ease: 'power1.inOut' }, 0);
        tl.to(this.clawR, { rotation: 0.2, duration: tkd * 0.4, ease: 'power1.inOut' }, 0.1);
        tl.to(this.antennaL, { rotation: 0.15, duration: tkd * 0.5, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaR, { rotation: -0.15, duration: tkd * 0.5, ease: 'sine.inOut' }, 0.05);
        tl.to(this.body, { y: -0.5, duration: tkd * 0.6, ease: 'sine.inOut' }, 0);
        break;
      }

      // -------- resting: body sinks, legs relaxed, eyes droop --------
      case 'resting': {
        tl.to(this.body, { y: 2, duration: 2, ease: 'sine.inOut' }, 0);
        for (const leg of this.legs) {
          tl.to(leg, { rotation: 0, duration: 1, ease: 'power2.out' }, 0);
        }
        // Droop eyes via scaleY
        tl.to(this.eyeL.scale, { y: 0.6, duration: 2, ease: 'sine.inOut' }, 0);
        tl.to(this.eyeR.scale, { y: 0.6, duration: 2, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaL, { rotation: 0.05, duration: 3, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaR, { rotation: -0.05, duration: 3, ease: 'sine.inOut' }, 0);
        break;
      }

      // -------- searching: antennae sweep, eyes scan, body raised --------
      case 'searching': {
        const sd = M1.duration || 0.6;
        tl.to(this.antennaL, { rotation: 0.35, duration: sd * 0.6, ease: 'power1.inOut' }, 0);
        tl.to(this.antennaR, { rotation: -0.35, duration: sd * 0.6, ease: 'power1.inOut' }, 0.1);
        // Eyes scan (x oscillation)
        tl.to(this.eyeL, { x: this.eyeL.position.x - 1, duration: sd * 0.5, ease: 'sine.inOut' }, 0);
        tl.to(this.eyeR, { x: this.eyeR.position.x + 1, duration: sd * 0.5, ease: 'sine.inOut' }, 0.15);
        tl.to(this.body, { y: -1.5, duration: sd, ease: 'sine.inOut' }, 0);
        break;
      }

      // -------- reporting: one claw extended, presenting --------
      case 'reporting': {
        const rd = M1.duration || 0.6;
        tl.to(this.clawR, { rotation: 0.35, y: this.clawR.position.y - 3, duration: rd, ease: 'sine.inOut' }, 0);
        tl.to(this.clawL, { rotation: -0.05, duration: rd, ease: 'sine.inOut' }, 0);
        tl.to(this.body, { y: -1, duration: rd, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaL, { rotation: 0.1, duration: rd * 1.2, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaR, { rotation: -0.1, duration: rd * 1.2, ease: 'sine.inOut' }, 0);
        break;
      }

      // -------- excited: jump, claws wide, antenna up, tail flip --------
      case 'excited': {
        const ed = M2.duration || 0.4;
        tl.to(this.body, { y: -4, duration: ed * 0.5, ease: 'back.out(2)' }, 0);
        tl.to(this.clawL, { rotation: -0.5, duration: ed * 0.4, ease: 'back.out(1.5)' }, 0);
        tl.to(this.clawR, { rotation: 0.5, duration: ed * 0.4, ease: 'back.out(1.5)' }, 0);
        tl.to(this.antennaL, { rotation: 0.3, duration: ed * 0.3, ease: 'power2.out' }, 0);
        tl.to(this.antennaR, { rotation: -0.3, duration: ed * 0.3, ease: 'power2.out' }, 0);
        tl.to(this.tail, { rotation: 0.4, duration: ed * 0.3, ease: 'power2.inOut' }, 0);
        break;
      }

      // -------- blocked: defensive, claws curled, hunker, shake --------
      case 'blocked': {
        const bd = M1.duration || 0.6;
        tl.to(this.clawL, { rotation: 0.2, duration: bd * 0.5, ease: 'power2.inOut' }, 0);
        tl.to(this.clawR, { rotation: -0.2, duration: bd * 0.5, ease: 'power2.inOut' }, 0);
        tl.to(this.body, { x: 0.5, duration: 0.1, ease: 'none' }, 0);
        tl.to(this.body, { y: 1, duration: bd, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaL, { rotation: -0.1, duration: bd, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaR, { rotation: 0.1, duration: bd, ease: 'sine.inOut' }, 0);
        break;
      }

      // -------- success: claws wide open, tail fan --------
      case 'success': {
        const sd2 = M2.duration || 0.4;
        tl.to(this.clawL, { rotation: -0.5, duration: sd2 * 0.5, ease: 'back.out(2)' }, 0);
        tl.to(this.clawR, { rotation: 0.5, duration: sd2 * 0.5, ease: 'back.out(2)' }, 0);
        tl.to(this.body, { y: -2, duration: sd2, ease: 'sine.inOut' }, 0);
        tl.to(this.tail, { scaleX: 1.3, scaleY: 1.3, duration: sd2, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaL, { rotation: 0.25, duration: sd2 * 0.6, ease: 'power2.out' }, 0);
        tl.to(this.antennaR, { rotation: -0.25, duration: sd2 * 0.6, ease: 'power2.out' }, 0);
        break;
      }

      // -------- failed: claws drooped, antenna down, body slouch --------
      case 'failed': {
        const fd = M1.duration || 0.6;
        tl.to(this.clawL, { rotation: 0.1, y: this.clawL.position.y + 2, duration: fd, ease: 'sine.inOut' }, 0);
        tl.to(this.clawR, { rotation: -0.1, y: this.clawR.position.y + 2, duration: fd, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaL, { rotation: -0.15, duration: fd, ease: 'sine.inOut' }, 0);
        tl.to(this.antennaR, { rotation: 0.15, duration: fd, ease: 'sine.inOut' }, 0);
        tl.to(this.body, { y: 1.5, duration: fd, ease: 'sine.inOut' }, 0);
        tl.to(this.eyeL.scale, { y: 0.7, duration: fd, ease: 'sine.inOut' }, 0);
        tl.to(this.eyeR.scale, { y: 0.7, duration: fd, ease: 'sine.inOut' }, 0);
        break;
      }

      // -------- paused: no animation, alpha 0.5 --------
      case 'paused': {
        tl.kill();
        this.body.alpha = 0.5;
        // Return a dead timeline — no looping animation
        return gsap.timeline();
      }
    }

    return tl;
  }
}
