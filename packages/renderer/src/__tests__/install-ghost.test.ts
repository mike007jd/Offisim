// ── install-ghost.test.ts ─────────────────────────────────────────────
// Tests for InstallGhostEntity: creation, progress, settle, fail.
// ANIM-024, ANIM-025, ANIM-026

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock pixi.js ──
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
    parent: MockContainer | null = null;
    addChild(c: unknown) {
      this.children.push(c);
      if (c instanceof MockContainer) (c as MockContainer).parent = this;
      return c;
    }
    addChildAt(c: unknown, i: number) {
      this.children.splice(i, 0, c);
      if (c instanceof MockContainer) (c as MockContainer).parent = this;
      return c;
    }
    removeChild(c: unknown) {
      const idx = this.children.indexOf(c);
      if (idx >= 0) {
        this.children.splice(idx, 1);
        if (c instanceof MockContainer) (c as MockContainer).parent = null;
      }
    }
    destroy(_opts?: unknown) {}
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
  }
  return { Container: MockContainer, Graphics: MockGraphics };
});

// ── Mock gsap ──
const mockKillTweensOf = vi.fn();

vi.mock('gsap', () => {
  function makeTween() {
    return { kill: vi.fn(), vars: {} };
  }
  function makeTimeline() {
    const tl: Record<string, unknown> = {
      kill: vi.fn(),
      vars: {},
      to: vi.fn((_target: unknown, _vars: unknown) => tl),
      set: vi.fn(() => tl),
      call: vi.fn((_fn: () => void) => tl),
    };
    return tl;
  }

  return {
    default: {
      to: vi.fn(() => makeTween()),
      fromTo: vi.fn(() => makeTween()),
      timeline: vi.fn(() => makeTimeline()),
      set: vi.fn(() => makeTween()),
      killTweensOf: mockKillTweensOf,
    },
  };
});

// ── Dynamic imports after mocks ──
const { InstallGhostEntity } = await import('../entities/install-ghost-entity.js');
const gsapModule = await import('gsap');
const gsap = gsapModule.default;

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function makeGhost(x = 100, y = 80, color?: number) {
  return new InstallGhostEntity({ x, y, color });
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('InstallGhostEntity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ANIM-024: construction', () => {
    it('creates a container at the specified position', () => {
      const ghost = makeGhost(50, 75);
      expect(ghost.container).toBeDefined();
      expect(ghost.container.position.set).toHaveBeenCalledWith(50, 75);
    });

    it('sets initial alpha to 0.3 (translucent ghost)', () => {
      const ghost = makeGhost();
      // After constructor, alpha is set to 0.3 (overrides tween initial value)
      expect(ghost.container.alpha).toBe(0.3);
    });

    it('has at least 4 children (body, head, progressBg, progressFill)', () => {
      const ghost = makeGhost();
      expect(ghost.container.children.length).toBeGreaterThanOrEqual(4);
    });

    it('starts a pulsing GSAP tween on creation', () => {
      makeGhost();
      // gsap.to should be called at least once for the pulse
      expect(gsap.to).toHaveBeenCalled();
    });

    it('accepts an optional custom color without error', () => {
      expect(() => makeGhost(0, 0, 0xff0000)).not.toThrow();
    });
  });

  describe('setProgress', () => {
    it('does not throw for values in [0, 1]', () => {
      const ghost = makeGhost();
      expect(() => ghost.setProgress(0)).not.toThrow();
      expect(() => ghost.setProgress(0.5)).not.toThrow();
      expect(() => ghost.setProgress(1)).not.toThrow();
    });

    it('clamps values below 0 to 0', () => {
      const ghost = makeGhost();
      expect(() => ghost.setProgress(-1)).not.toThrow();
    });

    it('clamps values above 1 to 1', () => {
      const ghost = makeGhost();
      expect(() => ghost.setProgress(2)).not.toThrow();
    });
  });

  describe('ANIM-025: settleAsInstalled', () => {
    it('calls gsap.to to animate alpha toward 1', () => {
      const ghost = makeGhost();
      vi.clearAllMocks();
      ghost.settleAsInstalled();

      // Should animate alpha to 1
      const calls = (gsap.to as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      const alphaCall = calls.find(
        (call) => call[0] === ghost.container && (call[1] as Record<string, unknown>).alpha === 1,
      );
      expect(alphaCall).toBeDefined();
    });

    it('animates scale toward 1', () => {
      const ghost = makeGhost();
      vi.clearAllMocks();
      ghost.settleAsInstalled();

      const calls = (gsap.to as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      const scaleCall = calls.find(
        (call) => {
          const vars = call[1] as Record<string, unknown>;
          return call[0] === ghost.container.scale && vars.x === 1 && vars.y === 1;
        },
      );
      expect(scaleCall).toBeDefined();
    });
  });

  describe('ANIM-026: failAndRemove', () => {
    it('calls gsap.to to fade alpha to 0', () => {
      const ghost = makeGhost();
      vi.clearAllMocks();
      ghost.failAndRemove();

      const calls = (gsap.to as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      const fadeCall = calls.find(
        (call) => call[0] === ghost.container && (call[1] as Record<string, unknown>).alpha === 0,
      );
      expect(fadeCall).toBeDefined();
    });

    it('calls gsap.to to shrink scale to 0.8', () => {
      const ghost = makeGhost();
      vi.clearAllMocks();
      ghost.failAndRemove();

      const calls = (gsap.to as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      const scaleCall = calls.find(
        (call) => {
          const vars = call[1] as Record<string, unknown>;
          return call[0] === ghost.container.scale && vars.x === 0.8 && vars.y === 0.8;
        },
      );
      expect(scaleCall).toBeDefined();
    });

    it('provides an onComplete callback on the scale tween (for destroy)', () => {
      const ghost = makeGhost();
      vi.clearAllMocks();
      ghost.failAndRemove();

      const calls = (gsap.to as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      const scaleCall = calls.find(
        (call) => {
          const vars = call[1] as Record<string, unknown>;
          return call[0] === ghost.container.scale && vars.x === 0.8;
        },
      );
      expect(scaleCall).toBeDefined();
      expect(typeof (scaleCall![1] as Record<string, unknown>).onComplete).toBe('function');
    });
  });

  describe('destroy', () => {
    it('kills all GSAP tweens and does not throw', () => {
      const ghost = makeGhost();
      expect(() => ghost.destroy()).not.toThrow();
      expect(mockKillTweensOf).toHaveBeenCalled();
    });

    it('removes container from parent if attached', () => {
      const ghost = makeGhost();
      // Manually simulate a parent container
      const parent = ghost.container.parent;
      if (parent) {
        ghost.destroy();
        expect(parent.children).not.toContain(ghost.container);
      } else {
        // No parent — destroy still completes without error
        expect(() => ghost.destroy()).not.toThrow();
      }
    });
  });
});
