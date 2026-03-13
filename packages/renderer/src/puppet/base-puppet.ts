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
import { EMPLOYEE_STATE_SIGNALS } from '../tokens/state-feedback-matrix.js';

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

  // ── Badge ──
  private readonly badgeContainer: Container;
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

    // Badge container (hidden by default, top-right)
    this.badgeContainer = new Container();
    this.badgeContainer.position.set(12, -20);
    this.badgeContainer.visible = false;
    this.container.addChild(this.badgeContainer);

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

    // Clear existing badge
    this.clearBadge();

    // Redraw state ring
    this.drawRing(color);

    // Resolve signals from state-feedback-matrix
    const signals = EMPLOYEE_STATE_SIGNALS[next] ?? [];

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

    // Apply signals from state-feedback-matrix
    for (const signal of signals) {
      switch (signal.type) {
        case 'ring_pulse': {
          if (this.motion.M1.duration > 0 && signal.config) {
            const amplitude = (signal.config.amplitude as number) ?? 1.05;
            const period = (signal.config.period as number) ?? 1000;
            this.pulseTween = gsap.to(this.ring.scale, {
              x: amplitude,
              y: amplitude,
              duration: period / 1000,
              ease: 'sine.inOut',
              yoyo: true,
              repeat: -1,
            });
          }
          break;
        }
        case 'badge': {
          if (signal.config) {
            const icon = signal.config.icon as string;
            if (icon) {
              this.drawBadgeIcon(icon);
              this.badgeContainer.visible = true;
            }
          }
          break;
        }
        // ring_color: already handled above via drawRing
        // route_line, room_glow, ambient_dim: handled by SceneManager, not puppet
        default:
          break;
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

  private clearBadge(): void {
    // Remove all children (bg circle + icon graphics)
    while (this.badgeContainer.children.length > 0) {
      const child = this.badgeContainer.children[0] as Graphics;
      this.badgeContainer.removeChild(child);
      child.destroy();
    }
    this.badgeContainer.visible = false;
  }

  private drawBadgeIcon(icon: string): void {
    this.clearBadge();
    const bg = new Graphics();
    bg.circle(0, 0, 7);
    bg.fill({ color: 0xffffff, alpha: 0.95 });

    const g = new Graphics();
    switch (icon) {
      case 'thought':
        // Small cloud: 3 overlapping circles
        g.circle(-2, 1, 2.5);
        g.circle(1.5, 0, 3);
        g.circle(-1, -2, 2);
        g.fill(0x94a3b8);
        break;
      case 'search':
        // Magnifying glass: circle + line
        g.circle(-1, -1, 3);
        g.stroke({ color: 0x475569, width: 1.2 });
        g.moveTo(1.5, 1.5);
        g.lineTo(4, 4);
        g.stroke({ color: 0x475569, width: 1.2 });
        break;
      case 'bolt':
        // Lightning bolt: triangle fold
        g.moveTo(0, -4);
        g.lineTo(-2, 0);
        g.lineTo(1, 0);
        g.lineTo(-1, 4);
        g.lineTo(3, -1);
        g.lineTo(0, -1);
        g.fill(0xeab308);
        break;
      case 'alert':
        // Exclamation in triangle
        g.moveTo(0, -4);
        g.lineTo(-3.5, 3);
        g.lineTo(3.5, 3);
        g.fill(0xef4444);
        g.rect(-0.5, -2, 1, 3);
        g.fill(0xffffff);
        g.circle(0, 2.5, 0.6);
        g.fill(0xffffff);
        break;
      case 'clock':
        // Clock: circle + two hands
        g.circle(0, 0, 3.5);
        g.stroke({ color: 0x475569, width: 1 });
        g.moveTo(0, 0);
        g.lineTo(0, -2);
        g.stroke({ color: 0x475569, width: 1 });
        g.moveTo(0, 0);
        g.lineTo(2, 0.5);
        g.stroke({ color: 0x475569, width: 0.8 });
        break;
      case 'document':
        // File with folded corner
        g.rect(-2.5, -3.5, 5, 7);
        g.fill(0x64748b);
        g.moveTo(2.5, -3.5);
        g.lineTo(2.5, -1.5);
        g.lineTo(0.5, -1.5);
        g.fill(0x94a3b8);
        break;
      case 'check':
        // Checkmark
        g.moveTo(-3, 0);
        g.lineTo(-1, 2.5);
        g.lineTo(3, -2.5);
        g.stroke({ color: 0x22c55e, width: 1.5 });
        break;
      case 'x':
        // X mark
        g.moveTo(-2.5, -2.5);
        g.lineTo(2.5, 2.5);
        g.stroke({ color: 0xef4444, width: 1.5 });
        g.moveTo(2.5, -2.5);
        g.lineTo(-2.5, 2.5);
        g.stroke({ color: 0xef4444, width: 1.5 });
        break;
      case 'pause':
        // Two vertical bars
        g.rect(-2.5, -2.5, 2, 5);
        g.fill(0x94a3b8);
        g.rect(0.5, -2.5, 2, 5);
        g.fill(0x94a3b8);
        break;
      default:
        // Fallback: simple dot
        g.circle(0, 0, 2);
        g.fill(0x94a3b8);
        break;
    }

    this.badgeContainer.addChild(bg);
    this.badgeContainer.addChild(g);
  }
}
