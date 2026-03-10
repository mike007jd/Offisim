import { describe, it, expect, vi } from 'vitest';

// Mock pixi.js — same pattern as scene-manager.test.ts
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
    fill() { return this; }
    stroke() { return this; }
    cut() { return this; }
  }

  return {
    Container: MockContainer,
    Graphics: MockGraphics,
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

const { MeetingRoomEntity } = await import('../entities/meeting-room-entity.js');
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
  M3: { duration: 0.1, ease: 'none' },
} as const;

describe('MeetingRoomEntity', () => {
  it('creates container with table and 6 chairs', () => {
    const entity = new MeetingRoomEntity(STANDARD_MOTION);
    // container: 1 table + 6 chairs = 7 children
    expect(entity.container.children.length).toBe(7);
  });

  it('container starts as not visible', () => {
    const entity = new MeetingRoomEntity(STANDARD_MOTION);
    expect(entity.container.visible).toBe(false);
  });

  it('show() makes container visible and animates with GSAP', () => {
    vi.mocked(gsap.to).mockClear();
    const entity = new MeetingRoomEntity(STANDARD_MOTION);
    entity.show();

    expect(entity.container.visible).toBe(true);
    // scale.set(0) then gsap.to for scale + alpha = 2 calls
    expect(gsap.to).toHaveBeenCalledTimes(2);
  });

  it('show() snaps to final state with reduced motion', () => {
    vi.mocked(gsap.to).mockClear();
    const entity = new MeetingRoomEntity(REDUCED_MOTION);
    entity.show();

    expect(entity.container.visible).toBe(true);
    // No GSAP calls — reduced motion snaps immediately
    expect(gsap.to).not.toHaveBeenCalled();
    expect(entity.container.scale.set).toHaveBeenCalledWith(1);
    expect(entity.container.alpha).toBe(1);
  });

  it('hide() animates out with GSAP', () => {
    vi.mocked(gsap.to).mockClear();
    const entity = new MeetingRoomEntity(STANDARD_MOTION);
    entity.show();
    vi.mocked(gsap.to).mockClear();

    entity.hide();
    // gsap.to for scale + alpha = 2 calls
    expect(gsap.to).toHaveBeenCalledTimes(2);
  });

  it('hide() snaps to hidden with reduced motion', () => {
    vi.mocked(gsap.to).mockClear();
    const entity = new MeetingRoomEntity(REDUCED_MOTION);
    entity.show();
    vi.mocked(gsap.to).mockClear();

    entity.hide();
    expect(entity.container.visible).toBe(false);
    expect(gsap.to).not.toHaveBeenCalled();
  });

  it('destroy() kills tweens and destroys container', () => {
    const entity = new MeetingRoomEntity(STANDARD_MOTION);
    // Should not throw
    entity.destroy();
  });

  it('destroy() kills active tweens from show()', () => {
    const killFn = vi.fn();
    vi.mocked(gsap.to).mockReturnValue({ kill: killFn, vars: {} } as unknown as gsap.core.Tween);

    const entity = new MeetingRoomEntity(STANDARD_MOTION);
    entity.show();
    entity.destroy();

    expect(killFn).toHaveBeenCalled();
  });
});
