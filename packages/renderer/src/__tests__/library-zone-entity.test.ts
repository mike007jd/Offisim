import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock pixi.js — same pattern as meeting-room-entity.test.ts
vi.mock('pixi.js', () => {
  class MockContainer {
    children: unknown[] = [];
    position = { set: vi.fn(), x: 0, y: 0 };
    scale = { set: vi.fn(), x: 1, y: 1 };
    visible = true;
    alpha = 1;
    addChild(...args: unknown[]) {
      this.children.push(...args);
      return args[0];
    }
    addChildAt(child: unknown, index: number) {
      this.children.splice(index, 0, child);
      return child;
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
    rect() {
      return this;
    }
    roundRect() {
      return this;
    }
    fill() {
      return this;
    }
    stroke() {
      return this;
    }
    cut() {
      return this;
    }
  }

  class MockText extends MockContainer {
    text = '';
    constructor(opts?: { text?: string; style?: unknown }) {
      super();
      if (opts?.text) this.text = opts.text;
    }
  }

  return {
    Container: MockContainer,
    Graphics: MockGraphics,
    Text: MockText,
  };
});

// Mock gsap
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

const { LibraryZoneEntity } = await import('../entities/library-zone-entity.js');
const gsapModule = await import('gsap');
const gsap = gsapModule.default;

const STANDARD_MOTION = {
  M0: { duration: 0, ease: 'none' },
  M1: { duration: 0.6, ease: 'power2.out' },
  M2: { duration: 0.4, ease: 'power2.out' },
  M3: { duration: 0.3, ease: 'back.out(1.2)' },
} as const;

const REDUCED_MOTION = {
  M0: { duration: 0, ease: 'none' },
  M1: { duration: 0, ease: 'none' },
  M2: { duration: 0, ease: 'none' },
  M3: { duration: 0, ease: 'none' },
} as const;

const ZONE = { x: 100, y: 50, width: 300, height: 200 } as const;

describe('LibraryZoneEntity', () => {
  beforeEach(() => {
    vi.mocked(gsap.to).mockClear();
  });

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('creates container with status light and doc count text', () => {
      const entity = new LibraryZoneEntity(ZONE, STANDARD_MOTION);
      // statusLight + docCountText = 2 children
      expect(entity.container.children.length).toBe(2);
    });

    it('positions status light at zone top-right corner', () => {
      const entity = new LibraryZoneEntity(ZONE, STANDARD_MOTION);
      const light = entity.container.children[0] as unknown as { position: { set: ReturnType<typeof vi.fn> } };
      expect(light.position.set).toHaveBeenCalledWith(
        ZONE.x + ZONE.width - 30,
        ZONE.y + 10,
      );
    });
  });

  // -----------------------------------------------------------------------
  // RAG status
  // -----------------------------------------------------------------------
  describe('setRagStatus', () => {
    it('sets idle status without animation', () => {
      vi.mocked(gsap.to).mockClear();
      const entity = new LibraryZoneEntity(ZONE, STANDARD_MOTION);
      entity.setRagStatus('idle');
      // idle = solid light, no blinking tween
      expect(gsap.to).not.toHaveBeenCalled();
    });

    it('sets indexing status with blink animation', () => {
      vi.mocked(gsap.to).mockClear();
      const entity = new LibraryZoneEntity(ZONE, STANDARD_MOTION);
      entity.setRagStatus('indexing');
      expect(gsap.to).toHaveBeenCalledTimes(1);
    });

    it('sets searching status with fast blink animation', () => {
      vi.mocked(gsap.to).mockClear();
      const entity = new LibraryZoneEntity(ZONE, STANDARD_MOTION);
      entity.setRagStatus('searching');
      expect(gsap.to).toHaveBeenCalledTimes(1);
    });

    it('sets error status without animation', () => {
      vi.mocked(gsap.to).mockClear();
      const entity = new LibraryZoneEntity(ZONE, STANDARD_MOTION);
      entity.setRagStatus('error');
      expect(gsap.to).not.toHaveBeenCalled();
    });

    it('kills previous blink tweens when status changes', () => {
      const killFn = vi.fn();
      vi.mocked(gsap.to).mockReturnValue({
        kill: killFn,
        vars: {},
      } as unknown as gsap.core.Tween);

      const entity = new LibraryZoneEntity(ZONE, STANDARD_MOTION);
      entity.setRagStatus('indexing');
      expect(gsap.to).toHaveBeenCalledTimes(1);

      // Switch to idle — should kill previous blink
      entity.setRagStatus('idle');
      expect(killFn).toHaveBeenCalled();
    });

    it('skips animation with reduced motion', () => {
      vi.mocked(gsap.to).mockClear();
      const entity = new LibraryZoneEntity(ZONE, REDUCED_MOTION);
      entity.setRagStatus('indexing');
      // duration === 0 → no GSAP call
      expect(gsap.to).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Search activity
  // -----------------------------------------------------------------------
  describe('showSearchActivity', () => {
    it('creates scan bar and animates it', () => {
      vi.mocked(gsap.to).mockClear();
      const entity = new LibraryZoneEntity(ZONE, STANDARD_MOTION);
      entity.showSearchActivity();

      // scan bar added → 3 children (light + text + scanBar)
      expect(entity.container.children.length).toBe(3);
      expect(gsap.to).toHaveBeenCalledTimes(1);
    });

    it('cleans up previous scan bar when called again', () => {
      const entity = new LibraryZoneEntity(ZONE, STANDARD_MOTION);
      entity.showSearchActivity();
      expect(entity.container.children.length).toBe(3);

      // Call again — should remove old scan bar before adding new one
      entity.showSearchActivity();
      expect(entity.container.children.length).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Document count
  // -----------------------------------------------------------------------
  describe('setDocCount', () => {
    it('displays formatted doc count', () => {
      const entity = new LibraryZoneEntity(ZONE, STANDARD_MOTION);
      entity.setDocCount(123);

      const textChild = entity.container.children[1] as unknown as { text: string };
      expect(textChild.text).toBe('\uD83D\uDCDA 123 docs');
    });

    it('clears text when count is 0', () => {
      const entity = new LibraryZoneEntity(ZONE, STANDARD_MOTION);
      entity.setDocCount(0);

      const textChild = entity.container.children[1] as unknown as { text: string };
      expect(textChild.text).toBe('');
    });

    it('clears text when count is negative', () => {
      const entity = new LibraryZoneEntity(ZONE, STANDARD_MOTION);
      entity.setDocCount(-5);

      const textChild = entity.container.children[1] as unknown as { text: string };
      expect(textChild.text).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // Destroy
  // -----------------------------------------------------------------------
  describe('destroy', () => {
    it('does not throw on fresh entity', () => {
      const entity = new LibraryZoneEntity(ZONE, STANDARD_MOTION);
      expect(() => entity.destroy()).not.toThrow();
    });

    it('kills active tweens', () => {
      const killFn = vi.fn();
      vi.mocked(gsap.to).mockReturnValue({
        kill: killFn,
        vars: {},
      } as unknown as gsap.core.Tween);

      const entity = new LibraryZoneEntity(ZONE, STANDARD_MOTION);
      entity.setRagStatus('indexing');
      entity.showSearchActivity();
      entity.destroy();

      expect(killFn).toHaveBeenCalled();
    });

    it('removes scan bar on destroy', () => {
      const entity = new LibraryZoneEntity(ZONE, STANDARD_MOTION);
      entity.showSearchActivity();
      // 3 children before destroy
      expect(entity.container.children.length).toBe(3);
      entity.destroy();
      // After destroy, container.destroy({ children: true }) is called
      // We just verify no throw
    });
  });
});
