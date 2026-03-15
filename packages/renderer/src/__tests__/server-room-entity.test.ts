import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock pixi.js — same pattern as library-zone-entity.test.ts
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
    clear() { return this; }
    circle() { return this; }
    rect() { return this; }
    roundRect() { return this; }
    fill() { return this; }
    stroke() { return this; }
    cut() { return this; }
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

const { ServerRoomEntity } = await import('../entities/server-room-entity.js');
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

const ZONE = { x: 100, y: 50, width: 250, height: 120 } as const;

describe('ServerRoomEntity', () => {
  beforeEach(() => {
    vi.mocked(gsap.to).mockClear();
  });

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('creates container with status light and connection text', () => {
      const entity = new ServerRoomEntity(ZONE, STANDARD_MOTION);
      // statusLight + connectionText = 2 children
      expect(entity.container.children.length).toBe(2);
    });

    it('positions status light at zone top-right corner', () => {
      const entity = new ServerRoomEntity(ZONE, STANDARD_MOTION);
      const light = entity.container.children[0] as unknown as { position: { set: ReturnType<typeof vi.fn> } };
      expect(light.position.set).toHaveBeenCalledWith(
        ZONE.x + ZONE.width - 30,
        ZONE.y + 10,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Server status
  // -----------------------------------------------------------------------
  describe('setServerStatus', () => {
    it('sets idle status without animation', () => {
      vi.mocked(gsap.to).mockClear();
      const entity = new ServerRoomEntity(ZONE, STANDARD_MOTION);
      entity.setServerStatus('idle');
      expect(gsap.to).not.toHaveBeenCalled();
    });

    it('sets active status with pulse animation', () => {
      vi.mocked(gsap.to).mockClear();
      const entity = new ServerRoomEntity(ZONE, STANDARD_MOTION);
      entity.setServerStatus('active');
      expect(gsap.to).toHaveBeenCalledTimes(1);
    });

    it('sets overloaded status with fast pulse animation', () => {
      vi.mocked(gsap.to).mockClear();
      const entity = new ServerRoomEntity(ZONE, STANDARD_MOTION);
      entity.setServerStatus('overloaded');
      expect(gsap.to).toHaveBeenCalledTimes(1);
    });

    it('sets error status without animation', () => {
      vi.mocked(gsap.to).mockClear();
      const entity = new ServerRoomEntity(ZONE, STANDARD_MOTION);
      entity.setServerStatus('error');
      expect(gsap.to).not.toHaveBeenCalled();
    });

    it('kills previous pulse tweens when status changes', () => {
      const killFn = vi.fn();
      vi.mocked(gsap.to).mockReturnValue({
        kill: killFn,
        vars: {},
      } as unknown as gsap.core.Tween);

      const entity = new ServerRoomEntity(ZONE, STANDARD_MOTION);
      entity.setServerStatus('active');
      expect(gsap.to).toHaveBeenCalledTimes(1);

      entity.setServerStatus('idle');
      expect(killFn).toHaveBeenCalled();
    });

    it('skips animation with reduced motion', () => {
      vi.mocked(gsap.to).mockClear();
      const entity = new ServerRoomEntity(ZONE, REDUCED_MOTION);
      entity.setServerStatus('active');
      expect(gsap.to).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Load pulse
  // -----------------------------------------------------------------------
  describe('showLoadPulse', () => {
    it('creates pulse bar and animates it', () => {
      vi.mocked(gsap.to).mockClear();
      const entity = new ServerRoomEntity(ZONE, STANDARD_MOTION);
      entity.showLoadPulse();

      // pulse bar added -> 3 children (light + text + loadPulse)
      expect(entity.container.children.length).toBe(3);
      expect(gsap.to).toHaveBeenCalledTimes(1);
    });

    it('cleans up previous pulse bar when called again', () => {
      const entity = new ServerRoomEntity(ZONE, STANDARD_MOTION);
      entity.showLoadPulse();
      expect(entity.container.children.length).toBe(3);

      entity.showLoadPulse();
      expect(entity.container.children.length).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Connection count
  // -----------------------------------------------------------------------
  describe('setConnectionCount', () => {
    it('displays formatted connection count', () => {
      const entity = new ServerRoomEntity(ZONE, STANDARD_MOTION);
      entity.setConnectionCount(42);

      const textChild = entity.container.children[1] as unknown as { text: string };
      expect(textChild.text).toBe('\u26A1 42 conn');
    });

    it('clears text when count is 0', () => {
      const entity = new ServerRoomEntity(ZONE, STANDARD_MOTION);
      entity.setConnectionCount(0);

      const textChild = entity.container.children[1] as unknown as { text: string };
      expect(textChild.text).toBe('');
    });

    it('clears text when count is negative', () => {
      const entity = new ServerRoomEntity(ZONE, STANDARD_MOTION);
      entity.setConnectionCount(-3);

      const textChild = entity.container.children[1] as unknown as { text: string };
      expect(textChild.text).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // Destroy
  // -----------------------------------------------------------------------
  describe('destroy', () => {
    it('does not throw on fresh entity', () => {
      const entity = new ServerRoomEntity(ZONE, STANDARD_MOTION);
      expect(() => entity.destroy()).not.toThrow();
    });

    it('kills active tweens', () => {
      const killFn = vi.fn();
      vi.mocked(gsap.to).mockReturnValue({
        kill: killFn,
        vars: {},
      } as unknown as gsap.core.Tween);

      const entity = new ServerRoomEntity(ZONE, STANDARD_MOTION);
      entity.setServerStatus('active');
      entity.showLoadPulse();
      entity.destroy();

      expect(killFn).toHaveBeenCalled();
    });

    it('removes load pulse on destroy', () => {
      const entity = new ServerRoomEntity(ZONE, STANDARD_MOTION);
      entity.showLoadPulse();
      expect(entity.container.children.length).toBe(3);
      entity.destroy();
    });
  });
});
