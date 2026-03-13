// ── EmployeePuppet ───────────────────────────────────────────────────
// Q-version (chibi) human character using PixiJS Graphics + GSAP animation.
// Extends BasePuppet for shared state-ring, task-bubble, and GSAP lifecycle.

import gsap from 'gsap';
import { Container, Graphics } from 'pixi.js';
import { BasePuppet, type MotionTokenSet } from './base-puppet.js';
import { drawHair } from './hair-styles.js';
import type { CharacterConfig, PuppetAnimState } from './types.js';
import { PUPPET } from './types.js';

export class EmployeePuppet extends BasePuppet {
  // ── Body part references (for animation targeting) ──
  // Assigned in buildBody(), called from constructor before any use.
  private head!: Container;
  private torso!: Graphics;
  private armL!: Container; // left arm, pivot at shoulder
  private armR!: Container; // right arm, pivot at shoulder
  private legL!: Container; // left leg, pivot at hip
  private legR!: Container; // right leg, pivot at hip
  private eyes!: Graphics;
  private mouth!: Graphics;
  private hair!: Graphics;
  private blockedOverlay!: Graphics;

  private readonly config: CharacterConfig;

  constructor(id: string, name: string, motion: MotionTokenSet, config: CharacterConfig) {
    super(id, name, motion);
    this.config = config;
    this.buildBody();
    // Start idle animation
    this.createAnimTimeline('idle');
  }

  // ── Build body ──────────────────────────────────────────────────────

  protected buildBody(): void {
    const { head: H, body: B, arm: A, leg: L } = PUPPET;
    const cfg = this.config;

    // Body-type scale modifiers
    const bodyWidthMul = cfg.bodyType === 'stocky' ? 1.15 : cfg.bodyType === 'slim' ? 0.9 : 1;

    // -- Vertical layout (origin = body center) --
    const bodyTopY = -B.height / 2;
    const bodyBotY = B.height / 2;
    const headCenterY = bodyTopY - H.radius;
    const shoulderY = bodyTopY + 1;
    const hipY = bodyBotY;

    // ── Legs (drawn first, behind body) ──
    const legW = L.width;
    const legLen = L.length;

    this.legL = this._makeContainer(-L.spacing / 2, hipY);
    const legLGfx = new Graphics();
    legLGfx.roundRect(-legW / 2, 0, legW, legLen, 2);
    legLGfx.fill(cfg.clothingColor);
    this.legL.addChild(legLGfx);
    // Foot
    const footL = new Graphics();
    footL.roundRect(-L.footWidth / 2, legLen - L.footHeight / 2, L.footWidth, L.footHeight, 1);
    footL.fill(cfg.skinColor);
    this.legL.addChild(footL);
    this.body.addChild(this.legL);

    this.legR = this._makeContainer(L.spacing / 2, hipY);
    const legRGfx = new Graphics();
    legRGfx.roundRect(-legW / 2, 0, legW, legLen, 2);
    legRGfx.fill(cfg.clothingColor);
    this.legR.addChild(legRGfx);
    const footR = new Graphics();
    footR.roundRect(-L.footWidth / 2, legLen - L.footHeight / 2, L.footWidth, L.footHeight, 1);
    footR.fill(cfg.skinColor);
    this.legR.addChild(footR);
    this.body.addChild(this.legR);

    // ── Torso ──
    const torsoW = B.width * bodyWidthMul;
    this.torso = new Graphics();
    this.torso.roundRect(-torsoW / 2, bodyTopY, torsoW, B.height, B.cornerRadius);
    this.torso.fill(cfg.clothingColor);
    // Accent stripe at chest
    this.torso.roundRect(-torsoW / 2 + 1, bodyTopY + 2, torsoW - 2, 3, 1);
    this.torso.fill(cfg.clothingAccent);
    this.body.addChild(this.torso);

    // ── Arms ──
    const armW = A.width;
    const armLen = A.length;
    const shoulderX = torsoW / 2 + armW / 4;

    this.armL = this._makeContainer(-shoulderX, shoulderY);
    const armLGfx = new Graphics();
    armLGfx.roundRect(-armW / 2, 0, armW, armLen, 2);
    armLGfx.fill(cfg.skinColor);
    this.armL.addChild(armLGfx);
    const handL = new Graphics();
    handL.circle(0, armLen, A.handRadius);
    handL.fill(cfg.skinColor);
    this.armL.addChild(handL);
    this.body.addChild(this.armL);

    this.armR = this._makeContainer(shoulderX, shoulderY);
    const armRGfx = new Graphics();
    armRGfx.roundRect(-armW / 2, 0, armW, armLen, 2);
    armRGfx.fill(cfg.skinColor);
    this.armR.addChild(armRGfx);
    const handR = new Graphics();
    handR.circle(0, armLen, A.handRadius);
    handR.fill(cfg.skinColor);
    this.armR.addChild(handR);
    this.body.addChild(this.armR);

    // ── Head ──
    this.head = new Container();
    this.head.position.set(0, headCenterY);
    // Head circle
    const headGfx = new Graphics();
    headGfx.circle(0, 0, H.radius);
    headGfx.fill(cfg.skinColor);
    this.head.addChild(headGfx);

    // Eyes
    this.eyes = new Graphics();
    this._drawEyes();
    this.head.addChild(this.eyes);

    // Mouth
    this.mouth = new Graphics();
    this._drawMouth();
    this.head.addChild(this.mouth);

    // Hair (drawn on top of head)
    this.hair = new Graphics();
    drawHair(this.hair, cfg.hairStyle, cfg.hairColor, H.radius);
    this.head.addChild(this.hair);

    this.body.addChild(this.head);

    // ── Blocked overlay (hidden, covers body) ──
    this.blockedOverlay = new Graphics();
    this.blockedOverlay.roundRect(-torsoW / 2 - 2, headCenterY - H.radius - 2, torsoW + 4, PUPPET.height + 4, 4);
    this.blockedOverlay.fill({ color: 0xef4444, alpha: 0.25 });
    this.blockedOverlay.alpha = 0;
    this.body.addChild(this.blockedOverlay);
  }

  // ── Animation timelines ─────────────────────────────────────────────

  protected createAnimTimeline(state: PuppetAnimState): gsap.core.Timeline {
    const tl = gsap.timeline();

    switch (state) {
      case 'idle':
        this._resetPose(tl);
        this._addBreathing(tl);
        this._addBlink(tl);
        break;

      case 'walking':
        this._resetPose(tl);
        // Leg alternation
        tl.to(this.legL, { rotation: 0.4, duration: 0.2, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 0);
        tl.to(this.legR, { rotation: -0.4, duration: 0.2, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 0);
        // Arm swing opposite to legs
        tl.to(this.armL, { rotation: -0.3, duration: 0.2, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 0);
        tl.to(this.armR, { rotation: 0.3, duration: 0.2, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 0);
        // Body bounce
        tl.to(this.body, { y: -1, duration: 0.2, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 0);
        break;

      case 'sitting':
        this._resetPose(tl);
        // Legs bent forward
        tl.set(this.legL, { rotation: -0.8 }, 0);
        tl.set(this.legR, { rotation: -0.8 }, 0);
        // Arms at sides (slight inward)
        tl.set(this.armL, { rotation: 0.1 }, 0);
        tl.set(this.armR, { rotation: -0.1 }, 0);
        this._addBreathing(tl);
        break;

      case 'working':
        this._resetPose(tl);
        // Sitting pose base
        tl.set(this.legL, { rotation: -0.8 }, 0);
        tl.set(this.legR, { rotation: -0.8 }, 0);
        // Typing — arms micro-oscillation
        tl.to(this.armL, { rotation: 0.1, duration: 0.1, ease: 'none', yoyo: true, repeat: -1 }, 0);
        tl.to(this.armR, { rotation: -0.1, duration: 0.1, ease: 'none', yoyo: true, repeat: -1 }, 0);
        this._addBreathing(tl);
        break;

      case 'thinking':
        this._resetPose(tl);
        // One arm raised, hand near chin
        tl.set(this.armR, { rotation: -1.2 }, 0);
        // Head tilted
        tl.set(this.head, { rotation: 0.1 }, 0);
        // Subtle arm sway
        tl.to(this.armR, { rotation: -1.15, duration: 1.5, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 0);
        this._addBreathing(tl);
        break;

      case 'talking':
        this._resetPose(tl);
        // Mouth opens/closes
        tl.to(this.mouth.scale, { y: 0.3, duration: 0.15, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 0);
        // Arms gesture
        tl.to(this.armL, { rotation: -0.3, duration: 0.4, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 0);
        tl.to(this.armR, { rotation: 0.3, duration: 0.5, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 0);
        this._addBreathing(tl);
        break;

      case 'resting':
        this._resetPose(tl);
        // Body leaned back
        tl.set(this.body, { rotation: 0.1 }, 0);
        // Arms relaxed (slight outward)
        tl.set(this.armL, { rotation: 0.15 }, 0);
        tl.set(this.armR, { rotation: -0.15 }, 0);
        // Eyes half closed
        tl.set(this.eyes.scale, { y: 0.5 }, 0);
        this._addBreathing(tl);
        break;

      case 'searching':
        this._resetPose(tl);
        // One arm up shading eyes
        tl.set(this.armR, { rotation: -1.0 }, 0);
        // Body slight turn
        tl.set(this.body, { rotation: 0.05 }, 0);
        // Scan side to side
        tl.to(this.head, { rotation: 0.15, duration: 1.0, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 0);
        this._addBreathing(tl);
        break;

      case 'reporting':
        this._resetPose(tl);
        // One arm extended forward (like holding a document)
        tl.set(this.armR, { rotation: -0.5 }, 0);
        // Subtle forward lean
        tl.to(this.body, { rotation: -0.03, duration: 2.0, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 0);
        this._addBreathing(tl);
        break;

      case 'excited':
        this._resetPose(tl);
        // Jump + arms up — play once
        tl.to(this.body, { y: -5, duration: 0.15, ease: 'power2.out', yoyo: true, repeat: 1 }, 0);
        tl.to(this.armL, { rotation: -2.5, duration: 0.2, ease: 'back.out(2)' }, 0);
        tl.to(this.armR, { rotation: 2.5, duration: 0.2, ease: 'back.out(2)' }, 0);
        // Arms back down
        tl.to(this.armL, { rotation: 0, duration: 0.3, ease: 'power2.inOut' }, 0.35);
        tl.to(this.armR, { rotation: 0, duration: 0.3, ease: 'power2.inOut' }, 0.35);
        break;

      case 'blocked':
        this._resetPose(tl);
        // Body slump
        tl.set(this.body, { y: 2 }, 0);
        // Head down
        tl.set(this.head, { rotation: 0.15 }, 0);
        // Red overlay pulse
        tl.to(this.blockedOverlay, { alpha: 1, duration: 0.8, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 0);
        break;

      case 'success':
        this._resetPose(tl);
        // Arms up celebration — play once
        tl.to(this.armL, { rotation: -2.0, duration: 0.25, ease: 'back.out(2)' }, 0);
        tl.to(this.armR, { rotation: 2.0, duration: 0.25, ease: 'back.out(2)' }, 0);
        // Y bounce
        tl.to(this.body, { y: -3, duration: 0.2, ease: 'power2.out', yoyo: true, repeat: 1 }, 0);
        // Arms back down
        tl.to(this.armL, { rotation: 0, duration: 0.4, ease: 'power2.inOut' }, 0.5);
        tl.to(this.armR, { rotation: 0, duration: 0.4, ease: 'power2.inOut' }, 0.5);
        break;

      case 'failed':
        this._resetPose(tl);
        // Head down
        tl.set(this.head, { rotation: 0.2 }, 0);
        // Shoulders slumped (arms slightly forward)
        tl.set(this.armL, { rotation: 0.2 }, 0);
        tl.set(this.armR, { rotation: -0.2 }, 0);
        // Body sag
        tl.set(this.body, { y: 1 }, 0);
        break;

      case 'paused':
        // No animation, body alpha reduced
        tl.set(this.body, { alpha: 0.5 }, 0);
        break;
    }

    return tl;
  }

  // ── Private drawing helpers ─────────────────────────────────────────

  private _drawEyes(): void {
    const { eyeRadius, eyeSpacing } = PUPPET.head;
    this.eyes.clear();
    this.eyes.circle(-eyeSpacing / 2, -1, eyeRadius);
    this.eyes.circle(eyeSpacing / 2, -1, eyeRadius);
    this.eyes.fill(0x1a1a2e);
  }

  private _drawMouth(): void {
    const { mouthWidth } = PUPPET.head;
    this.mouth.clear();
    this.mouth.roundRect(-mouthWidth / 2, 2, mouthWidth, 1.5, 0.75);
    this.mouth.fill(0xd4756b);
  }

  private _makeContainer(x: number, y: number): Container {
    const c = new Container();
    c.position.set(x, y);
    c.pivot.set(0, 0);
    return c;
  }

  // ── Shared animation sub-routines ───────────────────────────────────

  /** Gentle Y micro-breathing on the body (3s loop). */
  private _addBreathing(tl: gsap.core.Timeline): void {
    tl.to(this.body, { y: -0.5, duration: 1.5, ease: 'sine.inOut', yoyo: true, repeat: -1 }, 0);
  }

  /** Eye blink — quick scaleY 0→1 every ~3-5s. */
  private _addBlink(tl: gsap.core.Timeline): void {
    tl.to(this.eyes.scale, { y: 0.05, duration: 0.08, ease: 'power2.in', yoyo: true, repeat: -1, repeatDelay: 3 }, 0);
  }

  /** Reset all body parts to neutral pose at timeline start. */
  private _resetPose(tl: gsap.core.Timeline): void {
    tl.set(this.body, { y: 0, rotation: 0, alpha: 1 }, 0);
    tl.set(this.head, { rotation: 0 }, 0);
    tl.set(this.armL, { rotation: 0 }, 0);
    tl.set(this.armR, { rotation: 0 }, 0);
    tl.set(this.legL, { rotation: 0 }, 0);
    tl.set(this.legR, { rotation: 0 }, 0);
    tl.set(this.eyes.scale, { y: 1 }, 0);
    tl.set(this.mouth.scale, { y: 1 }, 0);
    tl.set(this.blockedOverlay, { alpha: 0 }, 0);
  }
}
