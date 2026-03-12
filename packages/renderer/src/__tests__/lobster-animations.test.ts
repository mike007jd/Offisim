import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock pixi.js
vi.mock('pixi.js', () => {
  class MockContainer {
    children: unknown[] = [];
    position = { set: vi.fn(), x: 0, y: 0 };
    scale = { set: vi.fn(), x: 1, y: 1 };
    pivot = { set: vi.fn(), x: 0, y: 0 };
    visible = true;
    alpha = 1;
    rotation = 0;
    addChild(c: unknown) {
      this.children.push(c);
      return c;
    }
    addChildAt(c: unknown, i: number) {
      this.children.splice(i, 0, c);
      return c;
    }
    removeChild(c: unknown) {
      const idx = this.children.indexOf(c);
      if (idx >= 0) this.children.splice(idx, 1);
    }
    destroy() {}
  }
  class MockGraphics extends MockContainer {
    clear() {
      return this;
    }
    circle() {
      return this;
    }
    roundRect() {
      return this;
    }
    rect() {
      return this;
    }
    fill(_c?: unknown) {
      return this;
    }
    stroke(_c?: unknown) {
      return this;
    }
    cut() {
      return this;
    }
  }
  return { Container: MockContainer, Graphics: MockGraphics };
});

vi.mock('gsap', () => {
  function makeTween() {
    return { kill: vi.fn(), vars: {} };
  }
  function makeTimeline() {
    const tl = {
      kill: vi.fn(),
      vars: {},
      to: vi.fn(() => tl), // chainable
    };
    return tl;
  }
  return {
    default: {
      to: vi.fn(() => makeTween()),
      fromTo: vi.fn(() => makeTween()),
      timeline: vi.fn(() => makeTimeline()),
    },
  };
});

// Import after mocks
const { createIdleBob, createClawWiggle, createThinkingAnimation, createWorkingAnimation } =
  await import('../entities/lobster-animations.js');
const gsapModule = await import('gsap');
const gsap = gsapModule.default;
const { Container, Graphics } = await import('pixi.js');

describe('lobster-animations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ------------------------------------------------------------------
  // createIdleBob
  // ------------------------------------------------------------------
  describe('createIdleBob', () => {
    it('calls gsap.to with yoyo and repeat: -1', () => {
      const container = new Container();
      const motion = { duration: 0.6, ease: 'power2.out' };

      createIdleBob(container, motion);

      expect(gsap.to).toHaveBeenCalledWith(
        container,
        expect.objectContaining({
          y: -3,
          duration: 0.6,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        }),
      );
    });

    it('returns a no-op tween (duration: 0) when motion duration is zero', () => {
      const container = new Container();
      const motion = { duration: 0, ease: 'none' };

      createIdleBob(container, motion);

      expect(gsap.to).toHaveBeenCalledWith(container, expect.objectContaining({ duration: 0 }));
      // Should NOT have yoyo/repeat in the zero-duration call
      const callArgs = vi.mocked(gsap.to).mock.calls[0]![1] as Record<string, unknown>;
      expect(callArgs.yoyo).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // createClawWiggle
  // ------------------------------------------------------------------
  describe('createClawWiggle', () => {
    it('creates a timeline (gsap.timeline called)', () => {
      const clawL = new Graphics();
      const clawR = new Graphics();
      const motion = { duration: 0.6, ease: 'power2.out' };

      createClawWiggle(clawL, clawR, motion);

      expect(gsap.timeline).toHaveBeenCalledWith(
        expect.objectContaining({ repeat: -1, yoyo: true }),
      );
    });

    it('timeline has .to calls for both claws', () => {
      const clawL = new Graphics();
      const clawR = new Graphics();
      const motion = { duration: 0.6, ease: 'power2.out' };

      const result = createClawWiggle(clawL, clawR, motion);

      // The result is a timeline mock with .to method
      // biome-ignore lint/suspicious/noExplicitAny: mock inspection
      const tl = result as any;
      expect(tl.to).toHaveBeenCalledTimes(2);
      // First call for clawL with positive rotation
      expect(tl.to).toHaveBeenCalledWith(clawL, expect.objectContaining({ rotation: 0.09 }), 0);
      // Second call for clawR with negative rotation
      expect(tl.to).toHaveBeenCalledWith(clawR, expect.objectContaining({ rotation: -0.09 }), 0);
    });

    it('returns no-op tween when motion duration is zero', () => {
      const clawL = new Graphics();
      const clawR = new Graphics();
      const motion = { duration: 0, ease: 'none' };

      createClawWiggle(clawL, clawR, motion);

      // Should call gsap.to (no-op), NOT gsap.timeline
      expect(gsap.to).toHaveBeenCalledWith(clawL, expect.objectContaining({ duration: 0 }));
      expect(gsap.timeline).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // createThinkingAnimation
  // ------------------------------------------------------------------
  describe('createThinkingAnimation', () => {
    it('creates timeline with antenna + eye tweens', () => {
      const antennaL = new Graphics();
      const antennaR = new Graphics();
      const eyesGfx = new Graphics();
      const motion = { duration: 0.6, ease: 'power2.out' };

      const result = createThinkingAnimation(antennaL, antennaR, eyesGfx, motion);

      expect(gsap.timeline).toHaveBeenCalledWith(
        expect.objectContaining({ repeat: -1, yoyo: true }),
      );
      // biome-ignore lint/suspicious/noExplicitAny: mock inspection
      const tl = result as any;
      // 3 calls: antennaL, antennaR, eyesGfx
      expect(tl.to).toHaveBeenCalledTimes(3);
      expect(tl.to).toHaveBeenCalledWith(antennaL, expect.objectContaining({ rotation: 0.15 }), 0);
      expect(tl.to).toHaveBeenCalledWith(antennaR, expect.objectContaining({ rotation: -0.15 }), 0);
      expect(tl.to).toHaveBeenCalledWith(eyesGfx, expect.objectContaining({ y: -2 }), 0);
    });

    it('returns no-op tween when motion duration is zero', () => {
      const antennaL = new Graphics();
      const antennaR = new Graphics();
      const eyesGfx = new Graphics();
      const motion = { duration: 0, ease: 'none' };

      createThinkingAnimation(antennaL, antennaR, eyesGfx, motion);

      expect(gsap.to).toHaveBeenCalledWith(antennaL, expect.objectContaining({ duration: 0 }));
      expect(gsap.timeline).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // createWorkingAnimation
  // ------------------------------------------------------------------
  describe('createWorkingAnimation', () => {
    it('creates timeline with claw tweens', () => {
      const clawL = new Graphics();
      const clawR = new Graphics();
      const motion = { duration: 0.6, ease: 'power2.out' };

      const result = createWorkingAnimation(clawL, clawR, motion);

      expect(gsap.timeline).toHaveBeenCalledWith(
        expect.objectContaining({ repeat: -1, yoyo: true }),
      );
      // biome-ignore lint/suspicious/noExplicitAny: mock inspection
      const tl = result as any;
      expect(tl.to).toHaveBeenCalledTimes(2);
      expect(tl.to).toHaveBeenCalledWith(
        clawL,
        expect.objectContaining({ rotation: 0.12, ease: 'power1.inOut' }),
        0,
      );
      expect(tl.to).toHaveBeenCalledWith(
        clawR,
        expect.objectContaining({ rotation: -0.12, ease: 'power1.inOut' }),
        0.05,
      );
    });

    it('returns no-op tween when motion duration is zero', () => {
      const clawL = new Graphics();
      const clawR = new Graphics();
      const motion = { duration: 0, ease: 'none' };

      createWorkingAnimation(clawL, clawR, motion);

      expect(gsap.to).toHaveBeenCalledWith(clawL, expect.objectContaining({ duration: 0 }));
      expect(gsap.timeline).not.toHaveBeenCalled();
    });
  });
});
