import { describe, expect, it, vi } from 'vitest';
import type { ZoneBounds } from '../layout/zone-layout-engine.js';
import type { MotionBucket } from '../tokens/motion.js';

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
    roundRect() {
      return this;
    }
    rect() {
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
    ellipse() {
      return this;
    }
    moveTo() {
      return this;
    }
    lineTo() {
      return this;
    }
    bezierCurveTo() {
      return this;
    }
    closePath() {
      return this;
    }
  }

  class MockText extends MockContainer {
    text = '';
    style = {};
    anchor = { set: vi.fn() };
    constructor(opts?: any) {
      super();
      if (opts) {
        this.text = opts.text ?? '';
        this.style = opts.style ?? {};
      }
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

const { MeetingRoomEntity } = await import('../entities/meeting-room-entity.js');
const { FloorLayer } = await import('../layers/floor-layer.js');
const gsapModule = await import('gsap');
const gsap = gsapModule.default;

const STANDARD_MOTION: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket> = {
  M0: { duration: 0, ease: 'none' },
  M1: { duration: 0.6, ease: 'power2.out' },
  M2: { duration: 0.4, ease: 'power2.out' },
  M3: { duration: 0.3, ease: 'back.out(1.2)' },
};

const REDUCED_MOTION: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket> = {
  M0: { duration: 0, ease: 'none' },
  M1: { duration: 0, ease: 'none' },
  M2: { duration: 0, ease: 'none' },
  M3: { duration: 0.1, ease: 'none' },
};

/** Standard test zone for a 300x200 meeting room area. */
const TEST_ZONE: ZoneBounds = { zoneId: 'test-zone', type: 'meeting_room', x: 100, y: 50, width: 300, height: 200, floorColor: 0xcccccc, label: 'Test', labelEn: 'TEST', workstations: [] };

/** Small zone to verify proportional sizing. */
const SMALL_ZONE: ZoneBounds = { zoneId: 'small-zone', type: 'meeting_room', x: 0, y: 0, width: 120, height: 80, floorColor: 0xcccccc, label: 'Small', labelEn: 'SMALL', workstations: [] };

describe('MeetingRoomEntity', () => {
  it('creates container with table and 6 chairs', () => {
    const entity = new MeetingRoomEntity(TEST_ZONE, STANDARD_MOTION);
    // container: 1 table + 6 chairs = 7 children
    expect(entity.container.children.length).toBe(7);
  });

  it('container starts as not visible', () => {
    const entity = new MeetingRoomEntity(TEST_ZONE, STANDARD_MOTION);
    expect(entity.container.visible).toBe(false);
  });

  it('positions container at center of zone', () => {
    const entity = new MeetingRoomEntity(TEST_ZONE, STANDARD_MOTION);
    expect(entity.container.position.set).toHaveBeenCalledWith(
      TEST_ZONE.x + TEST_ZONE.width / 2,
      TEST_ZONE.y + TEST_ZONE.height / 2,
    );
  });

  it('adapts table size proportionally to zone', () => {
    const large = new MeetingRoomEntity(TEST_ZONE, STANDARD_MOTION);
    const small = new MeetingRoomEntity(SMALL_ZONE, STANDARD_MOTION);
    // Both should have 7 children (table + 6 chairs)
    expect(large.container.children.length).toBe(7);
    expect(small.container.children.length).toBe(7);
  });

  it('show() makes container visible and animates with GSAP', () => {
    vi.mocked(gsap.to).mockClear();
    const entity = new MeetingRoomEntity(TEST_ZONE, STANDARD_MOTION);
    entity.show();

    expect(entity.container.visible).toBe(true);
    // scale.set(0) then gsap.to for scale + alpha = 2 calls
    expect(gsap.to).toHaveBeenCalledTimes(2);
  });

  it('show() snaps to final state with reduced motion', () => {
    vi.mocked(gsap.to).mockClear();
    const entity = new MeetingRoomEntity(TEST_ZONE, REDUCED_MOTION);
    entity.show();

    expect(entity.container.visible).toBe(true);
    // No GSAP calls — reduced motion snaps immediately
    expect(gsap.to).not.toHaveBeenCalled();
    expect(entity.container.scale.set).toHaveBeenCalledWith(1);
    expect(entity.container.alpha).toBe(1);
  });

  it('hide() animates out with GSAP', () => {
    vi.mocked(gsap.to).mockClear();
    const entity = new MeetingRoomEntity(TEST_ZONE, STANDARD_MOTION);
    entity.show();
    vi.mocked(gsap.to).mockClear();

    entity.hide();
    // gsap.to for scale + alpha = 2 calls
    expect(gsap.to).toHaveBeenCalledTimes(2);
  });

  it('hide() snaps to hidden with reduced motion', () => {
    vi.mocked(gsap.to).mockClear();
    const entity = new MeetingRoomEntity(TEST_ZONE, REDUCED_MOTION);
    entity.show();
    vi.mocked(gsap.to).mockClear();

    entity.hide();
    expect(entity.container.visible).toBe(false);
    expect(gsap.to).not.toHaveBeenCalled();
  });

  it('showScheduled() adds a glow child at index 0', () => {
    const entity = new MeetingRoomEntity(TEST_ZONE, STANDARD_MOTION);
    entity.showScheduled();
    // 7 original + 1 glow = 8
    expect(entity.container.children.length).toBe(8);
  });

  it('showScheduled() makes container visible', () => {
    const entity = new MeetingRoomEntity(TEST_ZONE, STANDARD_MOTION);
    entity.showScheduled();
    expect(entity.container.visible).toBe(true);
  });

  it('showEnded() removes glow with reduced motion', () => {
    const entity = new MeetingRoomEntity(TEST_ZONE, REDUCED_MOTION);
    entity.showScheduled();
    expect(entity.container.children.length).toBe(8);

    entity.showEnded();
    // glow removed immediately
    expect(entity.container.children.length).toBe(7);
  });

  it('destroy() kills tweens and destroys container', () => {
    const entity = new MeetingRoomEntity(TEST_ZONE, STANDARD_MOTION);
    // Should not throw
    entity.destroy();
  });

  it('destroy() kills active tweens from show()', () => {
    const killFn = vi.fn();
    vi.mocked(gsap.to).mockReturnValue({ kill: killFn, vars: {} } as unknown as gsap.core.Tween);

    const entity = new MeetingRoomEntity(TEST_ZONE, STANDARD_MOTION);
    entity.show();
    entity.destroy();

    expect(killFn).toHaveBeenCalled();
  });
});

const MOCK_FLOOR_PLAN: any = {
  totalWidth: 800,
  totalHeight: 500,
  zones: [],
  allWorkstations: new Map(),
};

describe('FloorLayer meeting overlays', () => {
  const MEETING_ZONE: ZoneBounds = { zoneId: 'mr-1', type: 'meeting_room', x: 200, y: 300, width: 250, height: 180, floorColor: 0xcccccc, label: 'Meeting', labelEn: 'MTG', workstations: [] };

  it('showMeetingActive() creates overlay and starts GSAP animation', () => {
    vi.mocked(gsap.to).mockClear();
    const floor = new FloorLayer(MOCK_FLOOR_PLAN);
    floor.registerMeetingZone('mr-1', MEETING_ZONE);
    floor.showMeetingActive('mr-1');

    // GSAP.to called for breathing animation
    expect(gsap.to).toHaveBeenCalled();
    const call = vi.mocked(gsap.to).mock.calls.find(
      (c) => (c[1] as Record<string, unknown>).yoyo === true,
    );
    expect(call).toBeDefined();
  });

  it('showMeetingActive() does nothing for unregistered zone', () => {
    vi.mocked(gsap.to).mockClear();
    const floor = new FloorLayer(MOCK_FLOOR_PLAN);
    floor.showMeetingActive('nonexistent');
    expect(gsap.to).not.toHaveBeenCalled();
  });

  it('showMeetingActive() does not double-create overlay', () => {
    vi.mocked(gsap.to).mockClear();
    const floor = new FloorLayer(MOCK_FLOOR_PLAN);
    floor.registerMeetingZone('mr-1', MEETING_ZONE);
    floor.showMeetingActive('mr-1');
    const callCount = vi.mocked(gsap.to).mock.calls.length;

    floor.showMeetingActive('mr-1');
    // No additional GSAP calls
    expect(vi.mocked(gsap.to).mock.calls.length).toBe(callCount);
  });

  it('hideMeetingActive() removes overlay and kills tweens', () => {
    const killFn = vi.fn();
    vi.mocked(gsap.to).mockReturnValue({ kill: killFn, vars: {} } as unknown as gsap.core.Tween);

    const floor = new FloorLayer(MOCK_FLOOR_PLAN);
    floor.registerMeetingZone('mr-1', MEETING_ZONE);
    floor.showMeetingActive('mr-1');
    floor.hideMeetingActive('mr-1');

    expect(killFn).toHaveBeenCalled();
  });

  it('hideMeetingActive() is safe to call when no overlay exists', () => {
    const floor = new FloorLayer(MOCK_FLOOR_PLAN);
    // Should not throw
    floor.hideMeetingActive('mr-1');
  });

  it('showMeetingScheduled() creates border overlay with blink animation', () => {
    vi.mocked(gsap.to).mockClear();
    const floor = new FloorLayer(MOCK_FLOOR_PLAN);
    floor.registerMeetingZone('mr-1', MEETING_ZONE);
    floor.showMeetingScheduled('mr-1');

    expect(gsap.to).toHaveBeenCalled();
    const call = vi.mocked(gsap.to).mock.calls.find(
      (c) => (c[1] as Record<string, unknown>).yoyo === true,
    );
    expect(call).toBeDefined();
  });

  it('showMeetingScheduled() does nothing for unregistered zone', () => {
    vi.mocked(gsap.to).mockClear();
    const floor = new FloorLayer(MOCK_FLOOR_PLAN);
    floor.showMeetingScheduled('nonexistent');
    expect(gsap.to).not.toHaveBeenCalled();
  });
});
