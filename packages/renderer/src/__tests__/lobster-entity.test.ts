import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock pixi.js — must be before importing LobsterEntity
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
  class MockText extends MockContainer {
    text = '';
    anchor = { set: vi.fn() };
    width = 40;
    height = 12;
    constructor(opts?: { text?: string }) {
      super();
      if (opts?.text) this.text = opts.text;
    }
  }
  return { Container: MockContainer, Graphics: MockGraphics, Text: MockText };
});

vi.mock('gsap', () => {
  function makeTween() {
    return { kill: vi.fn(), vars: {} };
  }
  return {
    default: {
      to: vi.fn(() => makeTween()),
      fromTo: vi.fn(() => makeTween()),
    },
  };
});

// Import after mocks
const { LobsterEntity } = await import('../entities/lobster-entity.js');
const gsapModule = await import('gsap');
const gsap = gsapModule.default;
const { MOTION } = await import('../tokens/motion.js');

describe('LobsterEntity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ------------------------------------------------------------------
  // 1. Constructor creates container with expected children count
  //    stateRing + legsGfx + bodyGfx + clawL + clawR + eyesGfx +
  //    antennaL + antennaR + label + taskBubble = 10 children
  // ------------------------------------------------------------------
  it('constructor creates container with 10 children in correct order', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);
    expect(entity.container.children.length).toBe(10);
  });

  // ------------------------------------------------------------------
  // 2. Different IDs produce different body colors
  // ------------------------------------------------------------------
  it('different IDs produce different palettes at index 8', () => {
    const a = new LobsterEntity('emp-alpha', 'Alpha', MOTION);
    const b = new LobsterEntity('emp-beta', 'Beta', MOTION);
    // Their palettes at index 8 (lobster body color) should differ
    expect(a.palette[8]).not.toBe(b.palette[8]);
  });

  // ------------------------------------------------------------------
  // 3. setState redraws the state ring
  // ------------------------------------------------------------------
  it('setState redraws state ring (clear + stroke called)', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);
    // The ring is the first child — spy on its methods
    // biome-ignore lint/suspicious/noExplicitAny: mock object cast for test assertions
    const ring = entity.container.children[0] as any;
    const clearSpy = vi.spyOn(ring, 'clear');
    const strokeSpy = vi.spyOn(ring, 'stroke');

    entity.setState('thinking');
    // drawRing should have been called: clear() then rect() then stroke()
    expect(clearSpy).toHaveBeenCalled();
    expect(strokeSpy).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // 4. setState('blocked') triggers shake animation (gsap.fromTo on container)
  // ------------------------------------------------------------------
  it('setState blocked triggers shake animation', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);
    vi.clearAllMocks();

    entity.setState('blocked');
    expect(gsap.fromTo).toHaveBeenCalledWith(
      entity.container,
      expect.objectContaining({ x: expect.any(Number) }),
      expect.objectContaining({
        x: expect.any(Number),
        duration: 0.08,
        yoyo: true,
        repeat: 5,
      }),
    );
  });

  // ------------------------------------------------------------------
  // 5. setState('success') triggers pop animation on ring scale
  // ------------------------------------------------------------------
  it('setState success triggers pop animation on ring scale', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);
    // biome-ignore lint/suspicious/noExplicitAny: mock object cast for test assertions
    const ring = entity.container.children[0] as any;
    vi.clearAllMocks();

    entity.setState('success');
    expect(gsap.fromTo).toHaveBeenCalledWith(
      ring.scale,
      expect.objectContaining({ x: 1, y: 1 }),
      expect.objectContaining({
        x: 1.25,
        y: 1.25,
        ease: 'back.out(2)',
        yoyo: true,
        repeat: 1,
      }),
    );
  });

  // ------------------------------------------------------------------
  // 6. Active states (thinking/searching/executing) start pulse tween
  // ------------------------------------------------------------------
  it('setState for active states starts pulse tween with repeat -1', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);
    // biome-ignore lint/suspicious/noExplicitAny: mock object cast for test assertions
    const ring = entity.container.children[0] as any;
    vi.clearAllMocks();

    entity.setState('thinking');
    // gsap.to should have been called for the pulse (repeat: -1)
    expect(gsap.to).toHaveBeenCalledWith(
      ring.scale,
      expect.objectContaining({
        x: 1.08,
        y: 1.08,
        yoyo: true,
        repeat: -1,
      }),
    );
  });

  it('active states pulse also applies to searching and executing', () => {
    for (const state of ['searching', 'executing'] as const) {
      const entity = new LobsterEntity(`emp-${state}`, 'Test', MOTION);
      vi.clearAllMocks();
      entity.setState(state);
      expect(gsap.to).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ repeat: -1 }),
      );
    }
  });

  // ------------------------------------------------------------------
  // 7. setHighlight scales container
  // ------------------------------------------------------------------
  it('setHighlight(true) scales up, setHighlight(false) scales back', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);
    vi.clearAllMocks();

    entity.setHighlight(true);
    expect(gsap.to).toHaveBeenCalledWith(
      entity.container.scale,
      expect.objectContaining({ x: 1.1, y: 1.1 }),
    );

    vi.clearAllMocks();
    entity.setHighlight(false);
    expect(gsap.to).toHaveBeenCalledWith(
      entity.container.scale,
      expect.objectContaining({ x: 1.0, y: 1.0 }),
    );
  });

  it('setHighlight with zero-duration motion snaps scale directly', () => {
    // M3_REDUCED has duration 0.1, so we need a truly zero-motion config
    const { M0 } = MOTION;
    const zeroMotion = { M0, M1: M0, M2: M0, M3: M0 };
    const entity = new LobsterEntity('emp-1', 'Alice', zeroMotion);

    entity.setHighlight(true);
    expect(entity.container.scale.set).toHaveBeenCalledWith(1.1);

    entity.setHighlight(false);
    expect(entity.container.scale.set).toHaveBeenCalledWith(1.0);
  });

  // ------------------------------------------------------------------
  // 8. setTask shows/hides task bubble
  // ------------------------------------------------------------------
  it('setTask shows task bubble, setTask(null) hides it', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);
    // taskBubble is the last child (index 9)
    const taskBubble = entity.container.children[9] as { visible: boolean };

    expect(taskBubble.visible).toBe(false);

    entity.setTask('task-123');
    expect(taskBubble.visible).toBe(true);

    entity.setTask(null);
    expect(taskBubble.visible).toBe(false);
  });

  // ------------------------------------------------------------------
  // 9. destroy kills all tweens
  // ------------------------------------------------------------------
  it('destroy kills pulse and active tweens', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);

    // Trigger a pulse (creates pulseTween)
    entity.setState('thinking');
    // Trigger a highlight (creates an active tween)
    entity.setHighlight(true);

    // Collect all kill functions
    const allTweens = [...vi.mocked(gsap.to).mock.results, ...vi.mocked(gsap.fromTo).mock.results];
    const killFns = allTweens.map((r) => r.value.kill);

    entity.destroy();

    // At least the pulse tween should have been killed
    const killedCount = killFns.filter((fn) => fn.mock.calls.length > 0).length;
    expect(killedCount).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------------
  // 10. setState same state twice is no-op
  // ------------------------------------------------------------------
  it('setState same state twice is no-op (no animation on second call)', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);

    entity.setState('assigned');

    // Spy on ring.clear after the first setState so we can detect a second call
    // biome-ignore lint/suspicious/noExplicitAny: mock object cast for test assertions
    const ring = entity.container.children[0] as any;
    const clearSpy = vi.spyOn(ring, 'clear');
    vi.mocked(gsap.fromTo).mockClear();

    // Second call with same state — should be no-op
    entity.setState('assigned');
    expect(gsap.fromTo).not.toHaveBeenCalled();
    // The ring should not be redrawn
    expect(clearSpy).not.toHaveBeenCalled();
  });
});
