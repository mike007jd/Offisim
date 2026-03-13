// ── Base puppet class ──────────────────────────────────────────────
// Abstract base for all modular paper-doll puppets (employee, lobster).
// Manages GSAP timeline lifecycle, task bubble, highlight, and state transitions.

import type { EmployeeState } from '@aics/shared-types';
import gsap from 'gsap';
import { Container, Graphics, Text } from 'pixi.js';
import { STATE_COLORS } from '../tokens/colors.js';
import type { MotionBucket } from '../tokens/motion.js';
import type { SceneEntity } from '../core/types.js';
import type { PuppetAnimState } from './types.js';

/** Motion tokens (4 buckets from performance tier) */
export type MotionTokenSet = Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>;

// Map EmployeeState → PuppetAnimState
const STATE_TO_ANIM: Record<EmployeeState, PuppetAnimState> = {
  idle: 'idle',
  assigned: 'sitting',
  thinking: 'thinking',
  searching: 'searching',
  executing: 'working',
  meeting: 'talking',
  blocked: 'blocked',
  waiting: 'sitting',
  reporting: 'reporting',
  success: 'success',
  failed: 'failed',
  paused: 'paused',
};

export abstract class BasePuppet implements SceneEntity {
  readonly container: Container;
  readonly id: string;

  protected currentState: EmployeeState = 'idle';
  protected currentAnimState: PuppetAnimState = 'idle';
  protected highlighted = false;
  protected readonly motion: MotionTokenSet;

  /** Body container — child of main container, holds all body parts */
  protected readonly body: Container;

  // ── GSAP lifecycle ──
  /** Current looping animation timeline */
  private animTimeline: gsap.core.Timeline | null = null;
  /** One-shot transition tweens */
  private activeTweens: gsap.core.Tween[] = [];

  // ── State ring ──
  private readonly ring: Graphics;
  private pulseTween: gsap.core.Tween | null = null;

  // ── Task bubble ──
  private readonly taskBubble: Container;
  private readonly taskText: Text;
  private taskBubbleBg: Graphics | null = null;

  // ── Name label ──
  protected readonly nameLabel: Text;

  constructor(id: string, name: string, motion: MotionTokenSet) {
    this.id = id;
    this.motion = motion;
    this.container = new Container();

    // State ring (behind everything)
    this.ring = new Graphics();
    this.drawRing(STATE_COLORS.idle);
    this.container.addChild(this.ring);

    // Body container — subclasses populate this
    this.body = new Container();
    this.container.addChild(this.body);

    // Name label below character
    this.nameLabel = new Text({
      text: name,
      style: {
        fontSize: 9,
        fill: 0x334155,
        fontFamily: 'system-ui, sans-serif',
      },
    });
    this.nameLabel.anchor.set(0.5, 0);
    this.nameLabel.position.set(0, 22);
    this.container.addChild(this.nameLabel);

    // Task bubble (hidden by default)
    this.taskBubble = new Container();
    this.taskBubble.visible = false;
    this.taskText = new Text({
      text: '',
      style: {
        fontSize: 8,
        fill: 0xffffff,
        fontFamily: 'system-ui, sans-serif',
      },
    });
    this.taskText.anchor.set(0.5);
    this.taskBubble.position.set(0, -28);
    this.taskBubble.addChild(this.taskText);
    this.container.addChild(this.taskBubble);
  }

  // ── Abstract methods (subclasses implement) ──

  /** Build body parts inside this.body. Called by subclass constructor. */
  protected abstract buildBody(): void;

  /** Create a GSAP Timeline for the given animation state. */
  protected abstract createAnimTimeline(state: PuppetAnimState): gsap.core.Timeline;

  // ── State management ──

  setState(next: EmployeeState): void {
    if (this.currentState === next) return;
    this.currentState = next;
    const color = STATE_COLORS[next];

    // Stop pulse + current animation
    this.stopPulse();
    this.stopAnimation();

    // Redraw state ring
    this.drawRing(color);

    // Transition effects
    const { duration, ease } = this.motion.M2;
    if (duration > 0) {
      if (next === 'blocked' || next === 'failed') {
        this.trackTween(
          gsap.fromTo(
            this.container,
            { x: this.container.x - 3 },
            { x: this.container.x + 3, duration: 0.08, ease: 'none', yoyo: true, repeat: 5 },
          ),
        );
      } else if (next === 'success') {
        this.trackTween(
          gsap.fromTo(
            this.ring.scale,
            { x: 1, y: 1 },
            { x: 1.25, y: 1.25, duration: duration / 2, ease: 'back.out(2)', yoyo: true, repeat: 1 },
          ),
        );
      } else {
        this.trackTween(
          gsap.fromTo(
            this.ring.scale,
            { x: 1, y: 1 },
            { x: 1.15, y: 1.15, duration: duration / 2, ease, yoyo: true, repeat: 1 },
          ),
        );
      }
    }

    // Start ring pulse for active states
    if (this.motion.M1.duration > 0) {
      const pulseConfig = this.getPulseConfig(next);
      if (pulseConfig) {
        this.pulseTween = gsap.to(this.ring.scale, {
          x: pulseConfig.scale,
          y: pulseConfig.scale,
          duration: pulseConfig.duration,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        });
      }
    }

    // Start body animation
    const animState = STATE_TO_ANIM[next];
    if (animState !== this.currentAnimState) {
      this.currentAnimState = animState;
      this.animTimeline = this.createAnimTimeline(animState);
    }
  }

  setTask(taskId: string | null): void {
    if (taskId) {
      this.taskText.text = taskId.length > 16 ? `${taskId.slice(0, 14)}…` : taskId;
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

  setHighlight(on: boolean): void {
    if (this.highlighted === on) return;
    this.highlighted = on;
    const { duration, ease } = this.motion.M3;
    const s = on ? 1.1 : 1.0;
    if (duration > 0) {
      this.trackTween(gsap.to(this.container.scale, { x: s, y: s, duration, ease }));
    } else {
      this.container.scale.set(s);
    }
  }

  destroy(): void {
    this.stopPulse();
    this.stopAnimation();
    for (const tw of this.activeTweens) tw.kill();
    this.activeTweens = [];
  }

  // ── Private helpers ──

  private stopPulse(): void {
    if (this.pulseTween) {
      this.pulseTween.kill();
      this.pulseTween = null;
      this.ring.scale.set(1);
    }
  }

  private stopAnimation(): void {
    if (this.animTimeline) {
      this.animTimeline.kill();
      this.animTimeline = null;
    }
  }

  protected trackTween(tw: gsap.core.Tween): void {
    this.activeTweens.push(tw);
    const origOnComplete = tw.vars.onComplete;
    tw.vars.onComplete = () => {
      const idx = this.activeTweens.indexOf(tw);
      if (idx >= 0) this.activeTweens.splice(idx, 1);
      if (origOnComplete) origOnComplete();
    };
  }

  private drawRing(color: number): void {
    const ringRadius = 18;
    const ringWidth = 2;
    this.ring.clear();
    this.ring.circle(0, 0, ringRadius);
    this.ring.fill(color);
    this.ring.circle(0, 0, ringRadius - ringWidth);
    this.ring.cut();
  }

  private drawTaskBubbleBg(): void {
    const padding = 4;
    const cr = 4;
    const w = this.taskText.width + padding * 2;
    const h = this.taskText.height + padding * 2;
    if (this.taskBubbleBg) {
      this.taskBubble.removeChild(this.taskBubbleBg);
      this.taskBubbleBg.destroy();
    }
    const bg = new Graphics();
    bg.roundRect(-w / 2, -h / 2, w, h, cr);
    bg.fill({ color: 0x334155, alpha: 0.9 });
    this.taskBubble.addChildAt(bg, 0);
    this.taskBubbleBg = bg;
  }

  private getPulseConfig(state: EmployeeState): { scale: number; duration: number } | null {
    switch (state) {
      case 'searching': return { scale: 1.05, duration: 0.3 };
      case 'waiting':
      case 'assigned': return { scale: 1.01, duration: 1.5 };
      case 'reporting': return { scale: 1.06, duration: this.motion.M1.duration };
      case 'thinking':
      case 'executing': return { scale: 1.08, duration: this.motion.M1.duration };
      default: return null;
    }
  }
}
