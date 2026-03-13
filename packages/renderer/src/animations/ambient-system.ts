import gsap from 'gsap';
import type { Container } from 'pixi.js';

/**
 * Ambient idle animation system — GDD §6.2 / ANIM-006
 * Adds subtle "alive" micro-motions to idle office elements:
 * - Monitor glow variance (brightness oscillation)
 * - Desk micro-breathing (very subtle Y offset)
 * - Idle flicker on unoccupied desks
 */
export class AmbientSystem {
  private timeline: gsap.core.Timeline | null = null;
  private targets: Map<string, Container> = new Map();
  private _reducedMotion = false;

  get reducedMotion(): boolean {
    return this._reducedMotion;
  }

  set reducedMotion(v: boolean) {
    this._reducedMotion = v;
    if (v) this.pause();
    else this.resume();
  }

  /** Register a desk container for ambient animation */
  registerDesk(id: string, container: Container): void {
    this.targets.set(id, container);
  }

  /** Unregister a desk */
  unregisterDesk(id: string): void {
    this.targets.delete(id);
  }

  /** Start ambient loops for all registered targets */
  start(): void {
    if (this._reducedMotion || this.targets.size === 0) return;
    this.stop();

    this.timeline = gsap.timeline({ repeat: -1 });

    let delay = 0;
    for (const [, container] of this.targets) {
      // Subtle Y breathing — 0.5px amplitude, staggered per desk
      this.timeline.to(
        container,
        {
          y: `+=${0.5}`,
          duration: 3 + Math.random() * 2,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        },
        delay,
      );

      // Monitor alpha variance — subtle brightness flicker
      const monitor = container.getChildByLabel?.('monitor');
      if (monitor) {
        this.timeline.to(
          monitor,
          {
            alpha: 0.85 + Math.random() * 0.15,
            duration: 2 + Math.random() * 3,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
          },
          delay + 0.5,
        );
      }

      delay += 0.3; // stagger each desk
    }
  }

  pause(): void {
    this.timeline?.pause();
  }

  resume(): void {
    if (!this._reducedMotion) {
      this.timeline?.resume();
    }
  }

  stop(): void {
    this.timeline?.kill();
    this.timeline = null;
  }

  destroy(): void {
    this.stop();
    this.targets.clear();
  }
}
