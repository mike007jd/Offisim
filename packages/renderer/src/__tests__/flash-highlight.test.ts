// ── flash-highlight.test.ts ──────────────────────────────────────────────────
// Tests for BasePuppet.flashHighlight() (ANIM-015: task row ↔ world echo).

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock pixi.js (must be before imports) ──
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
    moveTo() { return this; }
    lineTo() { return this; }
    bezierCurveTo() { return this; }
    arc() { return this; }
    closePath() { return this; }
  }
  class MockText extends MockContainer {
    text = '';
    anchor = { set: vi.fn() };
    width = 40;
    height = 12;
    constructor(opts?: { text?: string; style?: unknown }) {
      super();
      if (opts?.text) this.text = opts.text;
    }
  }
  return { Container: MockContainer, Graphics: MockGraphics, Text: MockText };
});

// ── Mock gsap ──
vi.mock('gsap', () => {
  function makeTween() {
    return { kill: vi.fn(), vars: {}, eventCallback: vi.fn() };
  }
  function makeTimeline() {
    const tl: Record<string, unknown> = {
      kill: vi.fn(),
      vars: {},
      eventCallback: vi.fn(),
      to: vi.fn(() => tl),
      fromTo: vi.fn(() => tl),
      set: vi.fn(() => tl),
    };
    return tl;
  }
  return {
    default: {
      to: vi.fn(() => makeTween()),
      fromTo: vi.fn(() => makeTween()),
      timeline: vi.fn(() => makeTimeline()),
      set: vi.fn(() => makeTween()),
    },
  };
});

// ── Imports after mocks ──
const { EmployeePuppet } = await import('../puppet/employee-puppet.js');
const gsapModule = await import('gsap');
const gsap = gsapModule.default;
const { MOTION } = await import('../tokens/motion.js');

import type { CharacterConfig } from '../puppet/types.js';

// ── Test data ──

const DEFAULT_CONFIG: CharacterConfig = {
  skinColor: 0xf5d6b8,
  hairColor: 0x2c1810,
  hairStyle: 'short',
  clothingColor: 0x3b82f6,
  clothingAccent: 0x1d4ed8,
  bodyType: 'normal',
  gender: 'masculine',
};

function makePuppet() {
  return new EmployeePuppet('emp-flash', 'Flash', MOTION, DEFAULT_CONFIG);
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('BasePuppet.flashHighlight (ANIM-015)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flashHighlight() calls gsap.timeline() to create a new timeline', () => {
    const puppet = makePuppet();
    vi.clearAllMocks();

    puppet.flashHighlight();

    expect(gsap.timeline).toHaveBeenCalled();
  });

  it('flashHighlight() calls timeline.fromTo for scale pop', () => {
    const puppet = makePuppet();
    vi.clearAllMocks();

    puppet.flashHighlight();

    const tlResults = vi.mocked(gsap.timeline).mock.results;
    expect(tlResults.length).toBeGreaterThan(0);
    const tl = tlResults[0]!.value;

    // fromTo should be called at least once for the scale animation
    expect(tl.fromTo).toHaveBeenCalled();
  });

  it('flashHighlight() targets container.scale with max scale 1.15', () => {
    const puppet = makePuppet();
    vi.clearAllMocks();

    puppet.flashHighlight();

    const tlResults = vi.mocked(gsap.timeline).mock.results;
    const tl = tlResults[0]!.value;

    // The first fromTo on scale should go to 1.15
    // biome-ignore lint/suspicious/noExplicitAny: mock call args are untyped
    const fromToCalls: any[] = vi.mocked(tl.fromTo).mock.calls;
    const scalePopCall = fromToCalls.find(
      // biome-ignore lint/suspicious/noExplicitAny: mock call args are untyped
      (call: any) =>
        call[0] === puppet.container.scale &&
        typeof call[2] === 'object' &&
        (call[2] as Record<string, unknown>).x === 1.15,
    );
    expect(scalePopCall).toBeDefined();
  });

  it('flashHighlight() calls timeline.to for scale return and ring alpha', () => {
    const puppet = makePuppet();
    vi.clearAllMocks();

    puppet.flashHighlight();

    const tlResults = vi.mocked(gsap.timeline).mock.results;
    const tl = tlResults[0]!.value;

    // tl.to should be called for scale return + ring alpha tweens
    expect(tl.to).toHaveBeenCalled();
  });

  it('flashHighlight() does not throw when puppet is highlighted', () => {
    const puppet = makePuppet();
    puppet.setHighlight(true);
    vi.clearAllMocks();

    expect(() => puppet.flashHighlight()).not.toThrow();

    const tlResults = vi.mocked(gsap.timeline).mock.results;
    expect(tlResults.length).toBeGreaterThan(0);
  });

  it('flashHighlight() is non-blocking (fire-and-forget, no return value)', () => {
    const puppet = makePuppet();
    const result = puppet.flashHighlight();
    expect(result).toBeUndefined();
  });

  it('flashHighlight() can be called multiple times without error', () => {
    const puppet = makePuppet();

    expect(() => {
      puppet.flashHighlight();
      puppet.flashHighlight();
      puppet.flashHighlight();
    }).not.toThrow();
  });

  it('flashHighlight() targets scale starting from 1.0 (non-highlighted puppet)', () => {
    const puppet = makePuppet();
    // Puppet not highlighted — base scale should be 1.0
    vi.clearAllMocks();

    puppet.flashHighlight();

    const tlResults = vi.mocked(gsap.timeline).mock.results;
    const tl = tlResults[0]!.value;
    // biome-ignore lint/suspicious/noExplicitAny: mock call args are untyped
    const fromToCalls: any[] = vi.mocked(tl.fromTo).mock.calls;

    // The fromTo should start from x: 1.0 (not highlighted)
    // biome-ignore lint/suspicious/noExplicitAny: mock call args are untyped
    const startingFrom1 = fromToCalls.find((call: any) =>
      typeof call[1] === 'object' &&
      (call[1] as Record<string, unknown>).x === 1.0,
    );
    expect(startingFrom1).toBeDefined();
  });

  it('flashHighlight() targets scale starting from 1.1 (highlighted puppet)', () => {
    const puppet = makePuppet();
    puppet.setHighlight(true);
    vi.clearAllMocks();

    puppet.flashHighlight();

    const tlResults = vi.mocked(gsap.timeline).mock.results;
    const tl = tlResults[0]!.value;
    // biome-ignore lint/suspicious/noExplicitAny: mock call args are untyped
    const fromToCalls: any[] = vi.mocked(tl.fromTo).mock.calls;

    // The fromTo should start from x: 1.1 (highlighted)
    // biome-ignore lint/suspicious/noExplicitAny: mock call args are untyped
    const startingFrom11 = fromToCalls.find((call: any) =>
      typeof call[1] === 'object' &&
      (call[1] as Record<string, unknown>).x === 1.1,
    );
    expect(startingFrom11).toBeDefined();
  });

  it('flashHighlight() uses back.out ease for scale pop', () => {
    const puppet = makePuppet();
    vi.clearAllMocks();

    puppet.flashHighlight();

    const tlResults = vi.mocked(gsap.timeline).mock.results;
    const tl = tlResults[0]!.value;
    // biome-ignore lint/suspicious/noExplicitAny: mock call args are untyped
    const fromToCalls: any[] = vi.mocked(tl.fromTo).mock.calls;

    // biome-ignore lint/suspicious/noExplicitAny: mock call args are untyped
    const backEaseCall = fromToCalls.find((call: any) =>
      typeof call[2] === 'object' &&
      typeof (call[2] as Record<string, unknown>).ease === 'string' &&
      ((call[2] as Record<string, unknown>).ease as string).startsWith('back.out'),
    );
    expect(backEaseCall).toBeDefined();
  });

  it('flashHighlight() total duration is ~800ms (scale pop + return = 0.8s)', () => {
    const puppet = makePuppet();
    vi.clearAllMocks();

    puppet.flashHighlight();

    const tlResults = vi.mocked(gsap.timeline).mock.results;
    const tl = tlResults[0]!.value;

    // Sum durations from both fromTo (scale pop) and to (scale return) on container.scale
    // biome-ignore lint/suspicious/noExplicitAny: mock call args are untyped
    const fromToCalls: any[] = vi.mocked(tl.fromTo).mock.calls;
    // biome-ignore lint/suspicious/noExplicitAny: mock call args are untyped
    const toCalls: any[] = vi.mocked(tl.to).mock.calls;

    let totalScaleDuration = 0;

    for (const call of fromToCalls) {
      if (call[0] === puppet.container.scale) {
        const vars = call[2] as Record<string, unknown>;
        if (typeof vars?.duration === 'number') totalScaleDuration += vars.duration;
      }
    }
    for (const call of toCalls) {
      if (call[0] === puppet.container.scale) {
        const vars = call[1] as Record<string, unknown>;
        if (typeof vars?.duration === 'number') totalScaleDuration += vars.duration;
      }
    }

    // Scale pop (0.4s halfDur) + return (0.4s halfDur) = 0.8s total
    expect(totalScaleDuration).toBeCloseTo(0.8, 2);
  });
});
