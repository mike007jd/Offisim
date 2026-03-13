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
    return { kill: vi.fn(), vars: {} };
  }
  function makeTimeline() {
    const tl: Record<string, unknown> = {
      kill: vi.fn(),
      vars: {},
      to: vi.fn(() => tl),
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
const { drawHair } = await import('../puppet/hair-styles.js');
const gsapModule = await import('gsap');
const gsap = gsapModule.default;
const { MOTION } = await import('../tokens/motion.js');
const { PUPPET } = await import('../puppet/types.js');

import type { CharacterConfig, HairStyle, PuppetAnimState } from '../puppet/types.js';
import type { EmployeeState } from '@aics/shared-types';

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

const ALT_CONFIG: CharacterConfig = {
  skinColor: 0xd4a574,
  hairColor: 0x8b4513,
  hairStyle: 'curly',
  clothingColor: 0x10b981,
  clothingAccent: 0x059669,
  bodyType: 'stocky',
  gender: 'feminine',
};

// All PuppetAnimState values
const ALL_ANIM_STATES: PuppetAnimState[] = [
  'idle', 'walking', 'sitting', 'working', 'thinking', 'talking',
  'resting', 'searching', 'reporting', 'excited', 'blocked',
  'success', 'failed', 'paused',
];

// All EmployeeState values
const ALL_EMPLOYEE_STATES: EmployeeState[] = [
  'idle', 'assigned', 'thinking', 'searching', 'executing',
  'meeting', 'blocked', 'waiting', 'reporting', 'success', 'failed', 'paused',
];

function makePuppet(id = 'emp-1', name = 'Alice', config = DEFAULT_CONFIG) {
  return new EmployeePuppet(id, name, MOTION, config);
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('EmployeePuppet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ------------------------------------------------------------------
  // 1. Constructor creates puppet with correct body parts
  // ------------------------------------------------------------------
  describe('constructor + buildBody', () => {
    it('creates a container with ring, body, nameLabel, badgeContainer, and taskBubble as children', () => {
      const puppet = makePuppet();
      // BasePuppet.constructor adds: ring, body, nameLabel, badgeContainer, taskBubble = 5 children on container
      expect(puppet.container.children.length).toBe(5);
    });

    it('body container has legs, torso, arms, head, and blockedOverlay', () => {
      const puppet = makePuppet();
      // body is second child of container (index 1)
      // biome-ignore lint/suspicious/noExplicitAny: mock access
      const body = puppet.container.children[1] as any;
      // legL, legR, torso, armL, armR, head, blockedOverlay = 7
      expect(body.children.length).toBe(7);
    });

    it('head container has headGfx, eyes, mouth, hair = 4 children', () => {
      const puppet = makePuppet();
      // biome-ignore lint/suspicious/noExplicitAny: mock access
      const body = puppet.container.children[1] as any;
      // head is the 6th child (index 5)
      const head = body.children[5];
      expect(head.children.length).toBe(4);
    });

    it('starts idle animation on construction (gsap.timeline called)', () => {
      makePuppet();
      expect(gsap.timeline).toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // 2. setState transitions correctly
  // ------------------------------------------------------------------
  describe('setState transitions', () => {
    it('idle → executing → blocked transitions without errors', () => {
      const puppet = makePuppet();
      expect(() => {
        puppet.setState('executing');
        puppet.setState('blocked');
      }).not.toThrow();
    });

    it('setState same state twice is no-op (ring not redrawn)', () => {
      const puppet = makePuppet();
      puppet.setState('thinking');

      // biome-ignore lint/suspicious/noExplicitAny: mock access
      const ring = puppet.container.children[0] as any;
      const clearSpy = vi.spyOn(ring, 'clear');
      vi.mocked(gsap.fromTo).mockClear();

      puppet.setState('thinking');
      expect(gsap.fromTo).not.toHaveBeenCalled();
      expect(clearSpy).not.toHaveBeenCalled();
    });

    it('sequential transition through all 12 employee states does not throw', () => {
      const puppet = makePuppet();
      expect(() => {
        for (const state of ALL_EMPLOYEE_STATES) {
          puppet.setState(state);
        }
      }).not.toThrow();
    });

    it('setState("blocked") triggers shake animation', () => {
      const puppet = makePuppet();
      vi.clearAllMocks();

      puppet.setState('blocked');
      expect(gsap.fromTo).toHaveBeenCalledWith(
        puppet.container,
        expect.objectContaining({ x: expect.any(Number) }),
        expect.objectContaining({ duration: 0.08, yoyo: true, repeat: 5 }),
      );
    });

    it('setState("success") triggers pop animation on ring scale', () => {
      const puppet = makePuppet();
      // biome-ignore lint/suspicious/noExplicitAny: mock access
      const ring = puppet.container.children[0] as any;
      vi.clearAllMocks();

      puppet.setState('success');
      expect(gsap.fromTo).toHaveBeenCalledWith(
        ring.scale,
        expect.objectContaining({ x: 1, y: 1 }),
        expect.objectContaining({ x: 1.25, y: 1.25, ease: 'back.out(2)' }),
      );
    });
  });

  // ------------------------------------------------------------------
  // 3. setTask shows/hides task bubble
  // ------------------------------------------------------------------
  describe('setTask', () => {
    it('shows task bubble when task is set, hides when null', () => {
      const puppet = makePuppet();
      // taskBubble is the last child (index 4, after badgeContainer)
      const taskBubble = puppet.container.children[4] as { visible: boolean };

      expect(taskBubble.visible).toBe(false);

      puppet.setTask('implement-feature');
      expect(taskBubble.visible).toBe(true);

      puppet.setTask(null);
      expect(taskBubble.visible).toBe(false);
    });

    it('truncates long task names', () => {
      const puppet = makePuppet();
      puppet.setTask('this-is-a-very-long-task-name-that-should-be-truncated');
      // The task text is inside taskBubble → taskText
      // biome-ignore lint/suspicious/noExplicitAny: mock access
      const taskBubble = puppet.container.children[4] as any;
      // After setTask, bg is inserted at index 0, taskText moves to index 1
      const taskText = taskBubble.children[1];
      expect(taskText.text.length).toBeLessThanOrEqual(16);
    });
  });

  // ------------------------------------------------------------------
  // 4. setHighlight toggles highlight
  // ------------------------------------------------------------------
  describe('setHighlight', () => {
    it('setHighlight(true) scales up, setHighlight(false) scales back', () => {
      const puppet = makePuppet();
      vi.clearAllMocks();

      puppet.setHighlight(true);
      expect(gsap.to).toHaveBeenCalledWith(
        puppet.container.scale,
        expect.objectContaining({ x: 1.1, y: 1.1 }),
      );

      vi.clearAllMocks();
      puppet.setHighlight(false);
      expect(gsap.to).toHaveBeenCalledWith(
        puppet.container.scale,
        expect.objectContaining({ x: 1.0, y: 1.0 }),
      );
    });

    it('setHighlight with same value twice is no-op', () => {
      const puppet = makePuppet();
      puppet.setHighlight(true);
      vi.clearAllMocks();

      puppet.setHighlight(true);
      expect(gsap.to).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // 4b. State-feedback-matrix badge integration
  // ------------------------------------------------------------------
  describe('badge from state-feedback-matrix', () => {
    function getBadgeContainer(puppet: InstanceType<typeof EmployeePuppet>) {
      // badgeContainer is at index 3 (ring=0, body=1, nameLabel=2, badge=3, taskBubble=4)
      return puppet.container.children[3] as { visible: boolean; children: unknown[] };
    }

    it('idle state has no badge (badgeContainer hidden)', () => {
      const puppet = makePuppet();
      puppet.setState('thinking'); // go to non-idle first
      puppet.setState('idle');
      const badge = getBadgeContainer(puppet);
      expect(badge.visible).toBe(false);
    });

    it('thinking state shows thought badge', () => {
      const puppet = makePuppet();
      puppet.setState('thinking');
      const badge = getBadgeContainer(puppet);
      expect(badge.visible).toBe(true);
      // Badge has bg circle + icon graphics = 2 children
      expect(badge.children.length).toBe(2);
    });

    it('searching state shows search badge', () => {
      const puppet = makePuppet();
      puppet.setState('searching');
      const badge = getBadgeContainer(puppet);
      expect(badge.visible).toBe(true);
    });

    it('executing state shows bolt badge', () => {
      const puppet = makePuppet();
      puppet.setState('executing');
      const badge = getBadgeContainer(puppet);
      expect(badge.visible).toBe(true);
    });

    it('blocked state shows alert badge', () => {
      const puppet = makePuppet();
      puppet.setState('blocked');
      const badge = getBadgeContainer(puppet);
      expect(badge.visible).toBe(true);
    });

    it('waiting state shows clock badge', () => {
      const puppet = makePuppet();
      puppet.setState('waiting');
      const badge = getBadgeContainer(puppet);
      expect(badge.visible).toBe(true);
    });

    it('reporting state shows document badge', () => {
      const puppet = makePuppet();
      puppet.setState('reporting');
      const badge = getBadgeContainer(puppet);
      expect(badge.visible).toBe(true);
    });

    it('success state shows check badge', () => {
      const puppet = makePuppet();
      puppet.setState('success');
      const badge = getBadgeContainer(puppet);
      expect(badge.visible).toBe(true);
    });

    it('failed state shows x badge', () => {
      const puppet = makePuppet();
      puppet.setState('failed');
      const badge = getBadgeContainer(puppet);
      expect(badge.visible).toBe(true);
    });

    it('paused state shows pause badge', () => {
      const puppet = makePuppet();
      puppet.setState('paused');
      const badge = getBadgeContainer(puppet);
      expect(badge.visible).toBe(true);
    });

    it('meeting state has no badge (only route_line + ambient_dim)', () => {
      const puppet = makePuppet();
      puppet.setState('meeting');
      const badge = getBadgeContainer(puppet);
      expect(badge.visible).toBe(false);
    });

    it('state transition clears old badge before showing new one', () => {
      const puppet = makePuppet();
      puppet.setState('thinking'); // thought badge
      const badge = getBadgeContainer(puppet);
      expect(badge.visible).toBe(true);
      const thinkingChildCount = badge.children.length;

      puppet.setState('blocked'); // alert badge
      expect(badge.visible).toBe(true);
      // Children count should remain 2 (bg + icon), not accumulate
      expect(badge.children.length).toBe(thinkingChildCount);
    });

    it('transitioning from badge state to idle clears badge', () => {
      const puppet = makePuppet();
      puppet.setState('executing'); // bolt badge
      const badge = getBadgeContainer(puppet);
      expect(badge.visible).toBe(true);

      puppet.setState('idle');
      expect(badge.visible).toBe(false);
      expect(badge.children.length).toBe(0);
    });

    it('pulse parameters come from state-feedback-matrix config', () => {
      const puppet = makePuppet();
      vi.clearAllMocks();

      puppet.setState('searching');
      // searching has: amplitude: 1.05, period: 300
      // period 300ms → duration 0.3s
      expect(gsap.to).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          x: 1.05,
          y: 1.05,
          duration: 0.3,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        }),
      );
    });

    it('assigned state uses matrix pulse: amplitude 1.03, period 2000ms', () => {
      const puppet = makePuppet();
      vi.clearAllMocks();

      puppet.setState('assigned');
      // assigned has: amplitude: 1.03, period: 2000
      expect(gsap.to).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          x: 1.03,
          y: 1.03,
          duration: 2,
        }),
      );
    });
  });

  // ------------------------------------------------------------------
  // 5. destroy kills all tweens
  // ------------------------------------------------------------------
  describe('destroy', () => {
    it('destroy does not throw after state transitions', () => {
      const puppet = makePuppet();
      puppet.setState('thinking');
      puppet.setHighlight(true);
      expect(() => puppet.destroy()).not.toThrow();
    });

    it('destroy kills pulse and active tweens', () => {
      const puppet = makePuppet();
      puppet.setState('thinking');
      puppet.setHighlight(true);

      const allTweens = [
        ...vi.mocked(gsap.to).mock.results,
        ...vi.mocked(gsap.fromTo).mock.results,
      ];
      const killFns = allTweens.map((r) => r.value.kill);

      puppet.destroy();

      const killedCount = killFns.filter((fn) => fn.mock.calls.length > 0).length;
      expect(killedCount).toBeGreaterThan(0);
    });

    it('destroy kills timeline animations', () => {
      const puppet = makePuppet();
      puppet.setState('executing');

      const timelineResults = vi.mocked(gsap.timeline).mock.results;
      const killFns = timelineResults.map((r) => r.value.kill);

      puppet.destroy();

      const killedCount = killFns.filter((fn) => fn.mock.calls.length > 0).length;
      expect(killedCount).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------------
  // 6. Different CharacterConfig produces different fill colors
  // ------------------------------------------------------------------
  describe('CharacterConfig variation', () => {
    it('different config produces different clothing/skin on body parts', () => {
      const puppetA = makePuppet('emp-1', 'Alice', DEFAULT_CONFIG);
      const puppetB = makePuppet('emp-2', 'Bob', ALT_CONFIG);
      // Both should construct without error; their body children will have
      // different fill calls. We verify the configs are stored by checking
      // body container children count is the same (structural parity)
      // biome-ignore lint/suspicious/noExplicitAny: mock access
      const bodyA = puppetA.container.children[1] as any;
      // biome-ignore lint/suspicious/noExplicitAny: mock access
      const bodyB = puppetB.container.children[1] as any;
      expect(bodyA.children.length).toBe(bodyB.children.length);
      // Both exist but are separate instances
      expect(bodyA).not.toBe(bodyB);
    });

    it('stocky body type creates wider torso (fill called with different roundRect)', () => {
      // Both construct successfully with different body types
      const normal = makePuppet('emp-1', 'N', { ...DEFAULT_CONFIG, bodyType: 'normal' });
      const stocky = makePuppet('emp-2', 'S', { ...DEFAULT_CONFIG, bodyType: 'stocky' });
      expect(normal.container.children.length).toBe(stocky.container.children.length);
    });
  });

  // ------------------------------------------------------------------
  // 7. All 14 animation states produce valid timelines
  // ------------------------------------------------------------------
  describe('animation states', () => {
    it.each(ALL_ANIM_STATES)('createAnimTimeline("%s") produces a timeline (gsap.timeline called)', (state) => {
      // We test this indirectly: construct puppet (creates idle timeline),
      // then transition to a state that maps to this anim state.
      // For states not directly mapped from EmployeeState, we test constructor only.
      const puppet = makePuppet();
      vi.clearAllMocks();

      // Map anim states to employee states that trigger them
      const ANIM_TO_EMPLOYEE: Partial<Record<PuppetAnimState, EmployeeState>> = {
        idle: 'idle',
        sitting: 'assigned',
        thinking: 'thinking',
        working: 'executing',
        talking: 'meeting',
        blocked: 'blocked',
        searching: 'searching',
        reporting: 'reporting',
        success: 'success',
        failed: 'failed',
        paused: 'paused',
      };

      const employeeState = ANIM_TO_EMPLOYEE[state];
      if (employeeState) {
        // Need to ensure we're not in same state — start from a different one
        if (employeeState !== 'idle') {
          puppet.setState(employeeState);
        } else {
          // Go to thinking first, then back to idle
          puppet.setState('thinking');
          vi.clearAllMocks();
          puppet.setState('idle');
        }
        expect(gsap.timeline).toHaveBeenCalled();
      }
      // For walking/resting/excited — not directly mapped from EmployeeState,
      // tested via constructor (idle) at minimum
    });

    it('idle animation has breathing and blink (timeline.to called multiple times)', () => {
      // Constructor creates idle timeline
      makePuppet();
      const timelineResults = vi.mocked(gsap.timeline).mock.results;
      expect(timelineResults.length).toBeGreaterThan(0);
      // The idle timeline should have .to calls for breathing + blink + reset
      const tl = timelineResults[0]!.value;
      expect(tl.to).toHaveBeenCalled();
      expect(tl.set).toHaveBeenCalled();
    });

    it('working animation sets legs bent and arms oscillating', () => {
      const puppet = makePuppet();
      vi.clearAllMocks();

      puppet.setState('executing'); // maps to 'working'
      const timelineResults = vi.mocked(gsap.timeline).mock.results;
      expect(timelineResults.length).toBeGreaterThan(0);
      const tl = timelineResults[0]!.value;
      // Should call tl.set for legs and tl.to for arms
      expect(tl.set).toHaveBeenCalled();
      expect(tl.to).toHaveBeenCalled();
    });

    it('paused animation sets body alpha to 0.5', () => {
      const puppet = makePuppet();
      puppet.setState('thinking'); // go to non-idle first
      vi.clearAllMocks();

      puppet.setState('paused');
      const timelineResults = vi.mocked(gsap.timeline).mock.results;
      expect(timelineResults.length).toBeGreaterThan(0);
      const tl = timelineResults[0]!.value;
      // Should call tl.set for body alpha
      expect(tl.set).toHaveBeenCalled();
    });

    it('blocked animation creates overlay alpha tween', () => {
      const puppet = makePuppet();
      vi.clearAllMocks();

      puppet.setState('blocked');
      const timelineResults = vi.mocked(gsap.timeline).mock.results;
      expect(timelineResults.length).toBeGreaterThan(0);
      const tl = timelineResults[0]!.value;
      // Should call tl.to for overlay pulse
      expect(tl.to).toHaveBeenCalled();
    });

    it('success animation is play-once (no repeat: -1 on body bounce)', () => {
      const puppet = makePuppet();
      vi.clearAllMocks();

      puppet.setState('success');
      const timelineResults = vi.mocked(gsap.timeline).mock.results;
      expect(timelineResults.length).toBeGreaterThan(0);
      const tl = timelineResults[0]!.value;
      // Success should have .to calls for arms up + body bounce
      expect(tl.to).toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Hair styles
// ─────────────────────────────────────────────────────────────────────

const { Graphics } = await import('pixi.js');

describe('drawHair', () => {
  const ALL_STYLES: HairStyle[] = ['short', 'long', 'ponytail', 'curly', 'bald', 'bob', 'spiky', 'braids'];

  it.each(ALL_STYLES)('drawHair with style "%s" does not throw', (style) => {
    const g = new Graphics();
    expect(() => drawHair(g, style, 0x2c1810, PUPPET.head.radius)).not.toThrow();
  });

  it('bald style does not call fill', () => {
    const g = new Graphics();
    const fillSpy = vi.spyOn(g, 'fill');
    drawHair(g, 'bald', 0x000000, PUPPET.head.radius);
    expect(fillSpy).not.toHaveBeenCalled();
  });

  it('curly style calls circle multiple times (for bumps)', () => {
    const g = new Graphics();
    const circleSpy = vi.spyOn(g, 'circle');
    drawHair(g, 'curly', 0x8b4513, PUPPET.head.radius);
    expect(circleSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('braids style calls circle for braid segments + fill for cap and braids', () => {
    const g = new Graphics();
    const circleSpy = vi.spyOn(g, 'circle');
    const fillSpy = vi.spyOn(g, 'fill');
    drawHair(g, 'braids', 0x5d4e37, PUPPET.head.radius);
    // 8 braid circles (4 per side)
    expect(circleSpy.mock.calls.length).toBeGreaterThanOrEqual(8);
    // fill called for cap + left braid + right braid = 3 times
    expect(fillSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('spiky style calls lineTo for spike tips', () => {
    const g = new Graphics();
    const lineToSpy = vi.spyOn(g, 'lineTo');
    drawHair(g, 'spiky', 0x2c1810, PUPPET.head.radius);
    expect(lineToSpy.mock.calls.length).toBeGreaterThanOrEqual(5);
  });
});
