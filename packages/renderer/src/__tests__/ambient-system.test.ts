import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock pixi.js
vi.mock('pixi.js', () => {
  class MockContainer {
    children: unknown[] = [];
    position = { set: vi.fn(), x: 0, y: 0 };
    scale = { set: vi.fn(), x: 1, y: 1 };
    visible = true;
    alpha = 1;
    x = 0;
    y = 0;
    addChild(c: unknown) {
      this.children.push(c);
      return c;
    }
    removeChild(c: unknown) {
      const idx = this.children.indexOf(c);
      if (idx >= 0) this.children.splice(idx, 1);
    }
    getChildByLabel(label: string) {
      return label === 'monitor' ? new MockContainer() : null;
    }
    destroy() {}
  }
  return { Container: MockContainer };
});

vi.mock('gsap', () => {
  function makeTween() {
    return { kill: vi.fn(), vars: {} };
  }
  function makeTimeline() {
    const tl = {
      kill: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
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

const { AmbientSystem } = await import('../animations/ambient-system.js');
const { Container } = await import('pixi.js');
const gsapModule = await import('gsap');
const gsap = gsapModule.default;

describe('AmbientSystem', () => {
  let system: InstanceType<typeof AmbientSystem>;

  beforeEach(() => {
    vi.clearAllMocks();
    system = new AmbientSystem();
  });

  describe('register/unregister', () => {
    it('registerDesk adds a target', () => {
      const container = new Container();
      system.registerDesk('desk-1', container);
      // Verify by starting — should create timeline since we have targets
      system.start();
      expect(gsap.timeline).toHaveBeenCalled();
    });

    it('unregisterDesk removes a target', () => {
      const container = new Container();
      system.registerDesk('desk-1', container);
      system.unregisterDesk('desk-1');
      // Start should not create timeline with zero targets
      system.start();
      expect(gsap.timeline).not.toHaveBeenCalled();
    });

    it('unregisterDesk is a no-op for unknown id', () => {
      expect(() => system.unregisterDesk('nonexistent')).not.toThrow();
    });
  });

  describe('start/stop', () => {
    it('start creates a GSAP timeline with registered desks', () => {
      system.registerDesk('desk-1', new Container());
      system.registerDesk('desk-2', new Container());
      system.start();

      expect(gsap.timeline).toHaveBeenCalledWith({ repeat: -1 });
    });

    it('start does nothing with zero targets', () => {
      system.start();
      expect(gsap.timeline).not.toHaveBeenCalled();
    });

    it('stop kills the timeline', () => {
      system.registerDesk('desk-1', new Container());
      system.start();

      const tl = vi.mocked(gsap.timeline).mock.results[0]!.value;
      system.stop();
      expect(tl.kill).toHaveBeenCalled();
    });

    it('stop is safe to call without start', () => {
      expect(() => system.stop()).not.toThrow();
    });

    it('start calls stop first to clean up previous timeline', () => {
      system.registerDesk('desk-1', new Container());
      system.start();

      const firstTl = vi.mocked(gsap.timeline).mock.results[0]!.value;
      system.start();
      expect(firstTl.kill).toHaveBeenCalled();
    });
  });

  describe('reduced motion', () => {
    it('setting reducedMotion to true pauses the timeline', () => {
      system.registerDesk('desk-1', new Container());
      system.start();

      const tl = vi.mocked(gsap.timeline).mock.results[0]!.value;
      system.reducedMotion = true;
      expect(tl.pause).toHaveBeenCalled();
    });

    it('setting reducedMotion to false resumes the timeline', () => {
      system.registerDesk('desk-1', new Container());
      system.start();

      const tl = vi.mocked(gsap.timeline).mock.results[0]!.value;
      system.reducedMotion = true;
      system.reducedMotion = false;
      expect(tl.resume).toHaveBeenCalled();
    });

    it('start does nothing when reducedMotion is true', () => {
      system.reducedMotion = true;
      system.registerDesk('desk-1', new Container());
      system.start();
      expect(gsap.timeline).not.toHaveBeenCalled();
    });

    it('resume does nothing when reducedMotion is true', () => {
      system.registerDesk('desk-1', new Container());
      system.start();

      const tl = vi.mocked(gsap.timeline).mock.results[0]!.value;
      system.reducedMotion = true;
      vi.clearAllMocks();

      system.resume();
      expect(tl.resume).not.toHaveBeenCalled();
    });

    it('reducedMotion getter returns the current value', () => {
      expect(system.reducedMotion).toBe(false);
      system.reducedMotion = true;
      expect(system.reducedMotion).toBe(true);
    });
  });

  describe('destroy', () => {
    it('destroy kills timeline and clears targets', () => {
      system.registerDesk('desk-1', new Container());
      system.registerDesk('desk-2', new Container());
      system.start();

      const tl = vi.mocked(gsap.timeline).mock.results[0]!.value;
      system.destroy();

      expect(tl.kill).toHaveBeenCalled();

      // After destroy, start should not create timeline (no targets)
      vi.clearAllMocks();
      system.start();
      expect(gsap.timeline).not.toHaveBeenCalled();
    });

    it('destroy is safe to call without start', () => {
      system.registerDesk('desk-1', new Container());
      expect(() => system.destroy()).not.toThrow();
    });
  });
});
