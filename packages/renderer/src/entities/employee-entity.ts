import type { EmployeeState } from '@aics/shared-types';
import gsap from 'gsap';
import { Container, Graphics, Text } from 'pixi.js';
import { STATE_COLORS } from '../tokens/colors.js';
import { LAYOUT } from '../tokens/layout.js';
import type { MotionBucket } from '../tokens/motion.js';

// TODO(P1-refactor): Before adding meeting rooms / route lines / handoff visuals,
// extract animation logic into `animations/state-transitions.ts` (GSAP timeline factory)
// and task bubble logic into `overlays/task-bubble.ts`.
// Current 213-line monolith is acceptable for MVP (3 employees, 6 animation types),
// but will become unmanageable at ~400+ lines.
// See: Phase 4 plan § Task 6 & Task 7 for the planned separation.
export class EmployeeEntity {
  readonly container: Container;
  readonly id: string;

  private state: EmployeeState = 'idle';
  private highlighted = false;
  private pulseTween: gsap.core.Tween | null = null;
  /** Track all active one-shot tweens for cleanup (C2). */
  private activeTweens: gsap.core.Tween[] = [];

  private readonly avatar: Graphics;
  private readonly ring: Graphics;
  private readonly label: Text;
  private readonly taskBubble: Container;
  private readonly taskText: Text;
  private readonly motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>;
  private taskBubbleBg: Graphics | null = null;

  constructor(id: string, name: string, motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>) {
    this.id = id;
    this.motion = motion;
    this.container = new Container();

    const { radius, ringWidth, fontSize, labelOffsetY } = LAYOUT.employee;

    // State ring (drawn behind avatar)
    this.ring = new Graphics();
    this.drawRing(STATE_COLORS.idle);
    this.container.addChild(this.ring);

    // Avatar circle
    this.avatar = new Graphics();
    this.avatar.circle(0, 0, radius - ringWidth);
    this.avatar.fill(0xffffff);
    this.container.addChild(this.avatar);

    // Name initial in avatar
    const initial = new Text({
      text: (name[0] ?? '?').toUpperCase(),
      style: {
        fontSize: radius,
        fill: STATE_COLORS.idle,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 'bold',
      },
    });
    initial.anchor.set(0.5);
    this.container.addChild(initial);

    // Name label below
    this.label = new Text({
      text: name,
      style: { fontSize, fill: 0x334155, fontFamily: 'system-ui, sans-serif' },
    });
    this.label.anchor.set(0.5, 0);
    this.label.position.set(0, labelOffsetY);
    this.container.addChild(this.label);

    // Task bubble (hidden by default)
    this.taskBubble = new Container();
    this.taskBubble.visible = false;
    this.taskText = new Text({
      text: '',
      style: {
        fontSize: LAYOUT.taskBubble.fontSize,
        fill: 0xffffff,
        fontFamily: 'system-ui, sans-serif',
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

    // Start continuous animation for non-idle/paused/failed/success states
    if (this.motion.M1.duration > 0) {
      if (next === 'searching') {
        // ANIM-008: Fast scanning pulse
        this.pulseTween = gsap.to(this.ring.scale, {
          x: 1.05,
          y: 1.05,
          duration: 0.3,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        });
      } else if (next === 'waiting' || next === 'assigned') {
        // ANIM-011: Very slow breathe
        this.pulseTween = gsap.to(this.ring.scale, {
          x: 1.01,
          y: 1.01,
          duration: 1.5,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        });
      } else if (next === 'reporting') {
        // ANIM-012: Reporting pulse
        this.pulseTween = gsap.to(this.ring.scale, {
          x: 1.06,
          y: 1.06,
          duration: this.motion.M1.duration,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        });
      } else if (isActiveState(next)) {
        // Existing: active work states (thinking, executing)
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
  }

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

  /** Set or clear the current task */
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

  /** Kill all running GSAP tweens and reset state (C2). */
  destroy(): void {
    this.stopPulse();
    for (const tw of this.activeTweens) {
      tw.kill();
    }
    this.activeTweens = [];
  }

  private drawRing(color: number): void {
    const { radius, ringWidth } = LAYOUT.employee;
    this.ring.clear();
    this.ring.circle(0, 0, radius);
    this.ring.fill(color);
    // Cut out inner circle to create ring effect
    this.ring.circle(0, 0, radius - ringWidth);
    this.ring.cut();
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

const ACTIVE_STATES: ReadonlySet<EmployeeState> = new Set([
  'thinking',
  'searching',
  'executing',
  'reporting',
]);

function isActiveState(state: EmployeeState): boolean {
  return ACTIVE_STATES.has(state);
}
