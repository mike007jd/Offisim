import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock pixi.js — must be before importing entities
vi.mock('pixi.js', () => {
  class MockContainer {
    children: unknown[] = [];
    position = { set: vi.fn(), x: 0, y: 0 };
    scale = { set: vi.fn(), x: 1, y: 1 };
    pivot = { set: vi.fn(), x: 0, y: 0 };
    visible = true;
    alpha = 1;
    rotation = 0;
    x = 0;
    y = 0;
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
    clear() { return this; }
    circle() { return this; }
    roundRect() { return this; }
    rect() { return this; }
    fill(_c?: unknown) { return this; }
    stroke(_c?: unknown) { return this; }
    cut() { return this; }
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
  function makeTimeline() {
    const tl = { kill: vi.fn(), vars: {}, to: vi.fn(() => tl) };
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
const { LobsterEntity } = await import('../entities/lobster-entity.js');
const { EmployeeEntity } = await import('../entities/employee-entity.js');
const gsapModule = await import('gsap');
const gsap = gsapModule.default;
const { MOTION } = await import('../tokens/motion.js');

// All 12 employee states
const ALL_STATES = [
  'idle', 'assigned', 'thinking', 'searching', 'executing',
  'meeting', 'blocked', 'waiting', 'reporting', 'success', 'failed', 'paused',
] as const;

// New states added in Chunk 3
const NEW_STATES = ['searching', 'blocked', 'waiting', 'reporting', 'success'] as const;

// ------------------------------------------------------------------
// LobsterEntity — new state animations
// ------------------------------------------------------------------
describe('LobsterEntity — new state animations (Chunk 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(NEW_STATES)('setState("%s") does not throw', (state) => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);
    expect(() => entity.setState(state)).not.toThrow();
  });

  it('setState("searching") starts body animations (idle bob + search timeline)', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);
    vi.clearAllMocks();

    entity.setState('searching');

    // createIdleBob calls gsap.to; createSearchingAnimation calls gsap.timeline + gsap.to for antennae
    expect(gsap.to).toHaveBeenCalled();
    expect(gsap.timeline).toHaveBeenCalled();
  });

  it('setState("blocked") starts blocked animation (jitter timeline, no idle bob)', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);
    vi.clearAllMocks();

    entity.setState('blocked');

    // createBlockedAnimation creates a timeline for jitter + claw folds (all via tl.to, no standalone gsap.to)
    expect(gsap.timeline).toHaveBeenCalled();
  });

  it('setState("waiting") starts waiting breathe animation (gsap.to on scale)', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);
    vi.clearAllMocks();

    entity.setState('waiting');

    // createWaitingAnimation calls gsap.to with x: 1.01, y: 1.01
    expect(gsap.to).toHaveBeenCalled();
  });

  it('setState("assigned") starts waiting breathe animation', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);
    vi.clearAllMocks();

    entity.setState('assigned');

    expect(gsap.to).toHaveBeenCalled();
  });

  it('setState("reporting") starts reporting float animation (gsap.to with repeat: -1)', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);
    vi.clearAllMocks();

    entity.setState('reporting');

    // createReportingAnimation + ring pulse both call gsap.to
    expect(gsap.to).toHaveBeenCalled();
  });

  it('setState("reporting") starts ring pulse (active state)', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);
    // biome-ignore lint/suspicious/noExplicitAny: mock object cast for test assertions
    const ring = entity.container.children[0] as any;
    vi.clearAllMocks();

    entity.setState('reporting');

    // Ring pulse for active states
    expect(gsap.to).toHaveBeenCalledWith(
      ring.scale,
      expect.objectContaining({ repeat: -1 }),
    );
  });

  it('setState("success") starts success animation (claws open via timeline)', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);
    vi.clearAllMocks();

    entity.setState('success');

    // createSuccessAnimation creates a timeline
    expect(gsap.timeline).toHaveBeenCalled();
  });

  it('setState("failed") has no body animations but has shake transition', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);
    vi.clearAllMocks();

    entity.setState('failed');

    // Shake is fromTo on container; no timeline for body animations
    expect(gsap.fromTo).toHaveBeenCalledWith(
      entity.container,
      expect.objectContaining({ x: expect.any(Number) }),
      expect.objectContaining({ duration: 0.08, yoyo: true, repeat: 5 }),
    );
  });

  it('sequential transition through all 12 states does not throw', () => {
    const entity = new LobsterEntity('emp-seq', 'Seq', MOTION);
    expect(() => {
      for (const state of ALL_STATES) {
        entity.setState(state);
      }
    }).not.toThrow();
  });

  it('destroy() cleans up after new state transitions', () => {
    const entity = new LobsterEntity('emp-1', 'Alice', MOTION);

    entity.setState('searching');
    entity.setState('blocked');
    entity.setState('reporting');

    expect(() => entity.destroy()).not.toThrow();
  });
});

// ------------------------------------------------------------------
// EmployeeEntity — new state animations
// ------------------------------------------------------------------
describe('EmployeeEntity — new state animations (Chunk 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(NEW_STATES)('setState("%s") does not throw', (state) => {
    const entity = new EmployeeEntity('emp-1', 'Alice', MOTION);
    expect(() => entity.setState(state)).not.toThrow();
  });

  it('setState("searching") starts fast scanning pulse on ring (x: 1.05)', () => {
    const entity = new EmployeeEntity('emp-1', 'Alice', MOTION);
    // ring is first child
    // biome-ignore lint/suspicious/noExplicitAny: mock object cast for test assertions
    const ring = entity.container.children[0] as any;
    vi.clearAllMocks();

    entity.setState('searching');

    expect(gsap.to).toHaveBeenCalledWith(
      ring.scale,
      expect.objectContaining({ x: 1.05, y: 1.05, duration: 0.3, repeat: -1 }),
    );
  });

  it('setState("waiting") starts slow breathe pulse on ring (x: 1.01)', () => {
    const entity = new EmployeeEntity('emp-1', 'Alice', MOTION);
    // biome-ignore lint/suspicious/noExplicitAny: mock object cast for test assertions
    const ring = entity.container.children[0] as any;
    vi.clearAllMocks();

    entity.setState('waiting');

    expect(gsap.to).toHaveBeenCalledWith(
      ring.scale,
      expect.objectContaining({ x: 1.01, y: 1.01, duration: 1.5, repeat: -1 }),
    );
  });

  it('setState("assigned") starts slow breathe pulse on ring (x: 1.01)', () => {
    const entity = new EmployeeEntity('emp-1', 'Alice', MOTION);
    // biome-ignore lint/suspicious/noExplicitAny: mock object cast for test assertions
    const ring = entity.container.children[0] as any;
    vi.clearAllMocks();

    entity.setState('assigned');

    expect(gsap.to).toHaveBeenCalledWith(
      ring.scale,
      expect.objectContaining({ x: 1.01, y: 1.01, duration: 1.5, repeat: -1 }),
    );
  });

  it('setState("reporting") starts reporting pulse on ring (x: 1.06)', () => {
    const entity = new EmployeeEntity('emp-1', 'Alice', MOTION);
    // biome-ignore lint/suspicious/noExplicitAny: mock object cast for test assertions
    const ring = entity.container.children[0] as any;
    vi.clearAllMocks();

    entity.setState('reporting');

    expect(gsap.to).toHaveBeenCalledWith(
      ring.scale,
      expect.objectContaining({ x: 1.06, y: 1.06, repeat: -1 }),
    );
  });

  it('setState("blocked") triggers shake (no ring pulse)', () => {
    const entity = new EmployeeEntity('emp-1', 'Alice', MOTION);
    vi.clearAllMocks();

    entity.setState('blocked');

    expect(gsap.fromTo).toHaveBeenCalledWith(
      entity.container,
      expect.objectContaining({ x: expect.any(Number) }),
      expect.objectContaining({ duration: 0.08, yoyo: true, repeat: 5 }),
    );
  });

  it('setState("success") triggers pop animation on ring scale (x: 1.25)', () => {
    const entity = new EmployeeEntity('emp-1', 'Alice', MOTION);
    // biome-ignore lint/suspicious/noExplicitAny: mock object cast for test assertions
    const ring = entity.container.children[0] as any;
    vi.clearAllMocks();

    entity.setState('success');

    expect(gsap.fromTo).toHaveBeenCalledWith(
      ring.scale,
      expect.objectContaining({ x: 1, y: 1 }),
      expect.objectContaining({ x: 1.25, y: 1.25, ease: 'back.out(2)' }),
    );
  });

  it('setState("idle") and setState("paused") produce no ring pulse', () => {
    for (const state of ['idle', 'paused'] as const) {
      const entity = new EmployeeEntity(`emp-${state}`, 'Test', MOTION);
      // Start from another state to ensure idle/paused transitions are non-trivial
      entity.setState('thinking');
      vi.clearAllMocks();

      entity.setState(state);

      // No repeat: -1 pulse should be set for idle/paused
      const pulseCalls = vi.mocked(gsap.to).mock.calls.filter(
        ([, opts]) => (opts as Record<string, unknown>).repeat === -1,
      );
      expect(pulseCalls.length).toBe(0);
    }
  });

  it('sequential transition through all 12 states does not throw', () => {
    const entity = new EmployeeEntity('emp-seq', 'Seq', MOTION);
    expect(() => {
      for (const state of ALL_STATES) {
        entity.setState(state);
      }
    }).not.toThrow();
  });

  it('destroy() cleans up after new state transitions', () => {
    const entity = new EmployeeEntity('emp-1', 'Alice', MOTION);

    entity.setState('searching');
    entity.setState('waiting');
    entity.setState('reporting');

    expect(() => entity.destroy()).not.toThrow();
  });
});
