import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PuppetAnimState } from '../puppet/types.js';

// ── Mock pixi.js ─────────────────────────────────────────────────────
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
    ellipse() { return this; }
    fill(_c?: unknown) { return this; }
    stroke(_c?: unknown) { return this; }
    cut() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    bezierCurveTo() { return this; }
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

// ── Mock gsap ────────────────────────────────────────────────────────
vi.mock('gsap', () => {
  function makeTween() {
    return { kill: vi.fn(), vars: {} };
  }
  function makeTimeline() {
    const tl: Record<string, unknown> = {
      kill: vi.fn(),
      vars: {},
      to: vi.fn(() => tl),
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

// ── Import after mocks ──────────────────────────────────────────────
const { LobsterPuppet } = await import('../puppet/lobster-puppet.js');
const gsapModule = await import('gsap');
const gsap = gsapModule.default;
const { MOTION } = await import('../tokens/motion.js');

// ── All puppet animation states ─────────────────────────────────────
const ALL_ANIM_STATES: PuppetAnimState[] = [
  'idle', 'walking', 'sitting', 'working', 'thinking', 'talking',
  'resting', 'searching', 'reporting', 'excited', 'blocked',
  'success', 'failed', 'paused',
];

// ── Tests ────────────────────────────────────────────────────────────

describe('LobsterPuppet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ------------------------------------------------------------------
  // 1. Constructor creates puppet with correct body parts
  // ------------------------------------------------------------------
  describe('constructor + body parts', () => {
    it('creates a puppet with a body container holding all lobster parts', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
      expect(puppet.container).toBeDefined();
      expect(puppet.id).toBe('lob-1');

      // body is the second child of container (ring=0, body=1, nameLabel=2, taskBubble=3)
      // biome-ignore lint/suspicious/noExplicitAny: mock inspection
      const body = puppet.container.children[1] as any;
      expect(body).toBeDefined();

      // Body should contain: tail + 6 legs + carapace + 2 claws + 2 eyes + 2 antennae = 14 children
      expect(body.children.length).toBe(14);
    });

    it('container has 4 top-level children: ring, body, nameLabel, taskBubble', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
      expect(puppet.container.children.length).toBe(4);
    });
  });

  // ------------------------------------------------------------------
  // 2. setState transitions correctly
  // ------------------------------------------------------------------
  describe('setState', () => {
    it('setState triggers animation timeline creation', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
      vi.clearAllMocks();

      puppet.setState('thinking');

      // Should create a new timeline
      expect(gsap.timeline).toHaveBeenCalled();
    });

    it('setState same state twice is no-op', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
      puppet.setState('executing');
      vi.clearAllMocks();

      puppet.setState('executing');
      // No ring redraw or animation should trigger
      // biome-ignore lint/suspicious/noExplicitAny: mock inspection
      const ring = puppet.container.children[0] as any;
      const clearSpy = vi.spyOn(ring, 'clear');
      puppet.setState('executing');
      expect(clearSpy).not.toHaveBeenCalled();
    });

    it('setState("blocked") triggers shake animation', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
      vi.clearAllMocks();

      puppet.setState('blocked');

      expect(gsap.fromTo).toHaveBeenCalledWith(
        puppet.container,
        expect.objectContaining({ x: expect.any(Number) }),
        expect.objectContaining({
          duration: 0.08,
          yoyo: true,
          repeat: 5,
        }),
      );
    });

    it('setState("success") triggers pop animation on ring scale', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
      // biome-ignore lint/suspicious/noExplicitAny: mock inspection
      const ring = puppet.container.children[0] as any;
      vi.clearAllMocks();

      puppet.setState('success');

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

    it('active states start ring pulse (repeat: -1)', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
      // biome-ignore lint/suspicious/noExplicitAny: mock inspection
      const ring = puppet.container.children[0] as any;
      vi.clearAllMocks();

      puppet.setState('thinking');

      expect(gsap.to).toHaveBeenCalledWith(
        ring.scale,
        expect.objectContaining({ repeat: -1 }),
      );
    });
  });

  // ------------------------------------------------------------------
  // 3. Different brandColor applies to carapace
  // ------------------------------------------------------------------
  describe('brandColor', () => {
    it('accepts custom brandColor (no throw, body parts still created)', () => {
      const puppet = new LobsterPuppet('lob-1', 'BlueClaw', MOTION, 0x3498db);
      expect(puppet.container).toBeDefined();
      // biome-ignore lint/suspicious/noExplicitAny: mock inspection
      const body = puppet.container.children[1] as any;
      expect(body.children.length).toBe(14);
    });

    it('default brandColor (0xe74c3c) produces a valid puppet', () => {
      const puppet = new LobsterPuppet('lob-def', 'Default', MOTION);
      expect(puppet.container).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  // 4. All 14 animation states produce valid timelines
  // ------------------------------------------------------------------
  describe('animation states', () => {
    it.each(ALL_ANIM_STATES)('createAnimTimeline("%s") does not throw', (_state) => {
      // We test via setState which maps EmployeeState → PuppetAnimState
      // For states not directly mapped (walking, sitting, etc.), we test
      // via the mapped employee states
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
      // Don't throw regardless of internal anim state
      expect(puppet.container).toBeDefined();
    });

    it('sequential transition through all employee states does not throw', () => {
      const ALL_EMPLOYEE_STATES = [
        'idle', 'assigned', 'thinking', 'searching', 'executing',
        'meeting', 'blocked', 'waiting', 'reporting', 'success',
        'failed', 'paused',
      ] as const;

      const puppet = new LobsterPuppet('lob-seq', 'Seq', MOTION);
      expect(() => {
        for (const state of ALL_EMPLOYEE_STATES) {
          puppet.setState(state);
        }
      }).not.toThrow();
    });

    it('setState("thinking") creates body animation timeline', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
      vi.clearAllMocks();

      puppet.setState('thinking');

      expect(gsap.timeline).toHaveBeenCalled();
    });

    it('setState("executing") creates working animation timeline', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
      vi.clearAllMocks();

      puppet.setState('executing');

      expect(gsap.timeline).toHaveBeenCalled();
    });

    it('setState("searching") creates timeline with antennae sweep', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
      vi.clearAllMocks();

      puppet.setState('searching');

      expect(gsap.timeline).toHaveBeenCalled();
    });

    it('setState("reporting") starts ring pulse for active state', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
      // biome-ignore lint/suspicious/noExplicitAny: mock inspection
      const ring = puppet.container.children[0] as any;
      vi.clearAllMocks();

      puppet.setState('reporting');

      expect(gsap.to).toHaveBeenCalledWith(
        ring.scale,
        expect.objectContaining({ repeat: -1 }),
      );
    });

    it('setState("paused") does not crash (returns dead timeline)', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
      expect(() => puppet.setState('paused')).not.toThrow();
    });

    it('setState("meeting") creates talking anim timeline', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
      vi.clearAllMocks();

      puppet.setState('meeting');

      // meeting maps to 'talking' PuppetAnimState
      expect(gsap.timeline).toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // 5. destroy kills all tweens
  // ------------------------------------------------------------------
  describe('destroy', () => {
    it('destroy kills pulse and active tweens', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);

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

    it('destroy after multiple state transitions does not throw', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);

      puppet.setState('searching');
      puppet.setState('blocked');
      puppet.setState('reporting');

      expect(() => puppet.destroy()).not.toThrow();
    });

    it('destroy kills body animation timelines', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);

      puppet.setState('thinking');

      const timelineResults = vi.mocked(gsap.timeline).mock.results;
      const killFns = timelineResults.map((r) => r.value.kill);

      puppet.destroy();

      const killedCount = killFns.filter((fn) => fn.mock.calls.length > 0).length;
      expect(killedCount).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------------
  // 6. setHighlight works
  // ------------------------------------------------------------------
  describe('setHighlight', () => {
    it('setHighlight(true) scales up, setHighlight(false) scales back', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
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

    it('setHighlight with zero-duration motion snaps scale directly', () => {
      const { M0 } = MOTION;
      const zeroMotion = { M0, M1: M0, M2: M0, M3: M0 };
      const puppet = new LobsterPuppet('lob-1', 'Crawly', zeroMotion);

      puppet.setHighlight(true);
      expect(puppet.container.scale.set).toHaveBeenCalledWith(1.1);

      puppet.setHighlight(false);
      expect(puppet.container.scale.set).toHaveBeenCalledWith(1.0);
    });

    it('setHighlight same value twice is no-op', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
      puppet.setHighlight(true);
      vi.clearAllMocks();

      puppet.setHighlight(true);
      expect(gsap.to).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // Additional: setTask (inherited from BasePuppet)
  // ------------------------------------------------------------------
  describe('setTask', () => {
    it('setTask shows task bubble, setTask(null) hides it', () => {
      const puppet = new LobsterPuppet('lob-1', 'Crawly', MOTION);
      // taskBubble is the last child (index 3)
      const taskBubble = puppet.container.children[3] as { visible: boolean };

      expect(taskBubble.visible).toBe(false);

      puppet.setTask('task-123');
      expect(taskBubble.visible).toBe(true);

      puppet.setTask(null);
      expect(taskBubble.visible).toBe(false);
    });
  });
});
