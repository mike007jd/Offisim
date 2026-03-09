import { Container, Graphics, Text } from 'pixi.js';
import gsap from 'gsap';
import type { EmployeeState } from '@aics/shared-types';
import { STATE_COLORS } from '../tokens/colors.js';
import { LAYOUT } from '../tokens/layout.js';
import type { MotionBucket } from '../tokens/motion.js';

export class EmployeeEntity {
  readonly container: Container;
  readonly id: string;

  private state: EmployeeState = 'idle';
  private highlighted = false;

  private readonly avatar: Graphics;
  private readonly ring: Graphics;
  private readonly label: Text;
  private readonly taskBubble: Container;
  private readonly taskText: Text;
  private readonly motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>;

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
    const initial = new Text({ text: (name[0] ?? '?').toUpperCase(), style: { fontSize: radius, fill: STATE_COLORS.idle, fontFamily: 'system-ui, sans-serif', fontWeight: 'bold' } });
    initial.anchor.set(0.5);
    this.container.addChild(initial);

    // Name label below
    this.label = new Text({ text: name, style: { fontSize, fill: 0x334155, fontFamily: 'system-ui, sans-serif' } });
    this.label.anchor.set(0.5, 0);
    this.label.position.set(0, labelOffsetY);
    this.container.addChild(this.label);

    // Task bubble (hidden by default)
    this.taskBubble = new Container();
    this.taskBubble.visible = false;
    this.taskText = new Text({ text: '', style: { fontSize: LAYOUT.taskBubble.fontSize, fill: 0xffffff, fontFamily: 'system-ui, sans-serif' } });
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

    const { duration, ease } = this.motion.M2;
    if (duration > 0) {
      // Animate ring color via scale bounce
      gsap.to(this.ring, {
        pixi: { scale: 1.15 },
        duration: duration / 2,
        ease,
        yoyo: true,
        repeat: 1,
        onStart: () => this.drawRing(color),
      });
    } else {
      this.drawRing(color);
    }
  }

  /** Set or clear the current task */
  setTask(taskId: string | null): void {
    if (taskId) {
      this.taskText.text = taskId.length > 16 ? taskId.slice(0, 14) + '…' : taskId;
      this.drawTaskBubbleBg();
      this.taskBubble.visible = true;
      const { duration, ease } = this.motion.M3;
      if (duration > 0) {
        this.taskBubble.alpha = 0;
        gsap.to(this.taskBubble, { alpha: 1, duration, ease });
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
      gsap.to(this.container, { pixi: { scale: targetScale }, duration, ease });
    } else {
      this.container.scale.set(targetScale);
    }
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

    // Remove old bg if any
    const existingBg = this.taskBubble.getChildAt(0);
    if (existingBg instanceof Graphics) {
      this.taskBubble.removeChild(existingBg);
    }

    const bg = new Graphics();
    bg.roundRect(-width / 2, -height / 2, width, height, cornerRadius);
    bg.fill({ color: 0x334155, alpha: 0.9 });
    this.taskBubble.addChildAt(bg, 0);
  }
}
