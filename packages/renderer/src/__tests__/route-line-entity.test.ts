import { describe, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => {
  class MockContainer {
    children: unknown[] = [];
    position = { set: vi.fn(), x: 0, y: 0 };
    scale = { set: vi.fn(), x: 1, y: 1 };
    visible = true;
    alpha = 1;
    addChild(c: unknown) { this.children.push(c); return c; }
    destroy() {}
  }
  class MockGraphics extends MockContainer {
    clear() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    stroke() { return this; }
  }
  return { Container: MockContainer, Graphics: MockGraphics };
});

vi.mock('gsap', () => ({
  default: {
    to: vi.fn(() => ({ kill: vi.fn(), vars: {} })),
  },
}));

import { RouteLineEntity } from '../entities/route-line-entity.js';
import { MOTION, MOTION_REDUCED } from '../tokens/motion.js';

describe('RouteLineEntity', () => {
  it('creates without error', () => {
    const line = new RouteLineEntity('tr-1', 0x60a5fa, MOTION);
    expect(line.taskRunId).toBe('tr-1');
    expect(line.container).toBeDefined();
  });

  it('setEndpoints draws line', () => {
    const line = new RouteLineEntity('tr-1', 0x60a5fa, MOTION);
    expect(() => line.setEndpoints(0, 0, 100, 100)).not.toThrow();
  });

  it('setColor updates without error', () => {
    const line = new RouteLineEntity('tr-1', 0x60a5fa, MOTION);
    line.setEndpoints(0, 0, 50, 50);
    expect(() => line.setColor(0xf87171)).not.toThrow();
  });

  it('destroy cleans up', () => {
    const line = new RouteLineEntity('tr-1', 0x60a5fa, MOTION);
    line.setEndpoints(0, 0, 50, 50);
    expect(() => line.destroy()).not.toThrow();
  });

  it('works with reduced motion (no dash animation)', () => {
    const line = new RouteLineEntity('tr-1', 0x60a5fa, MOTION_REDUCED);
    expect(() => line.setEndpoints(0, 0, 100, 100)).not.toThrow();
    line.destroy();
  });
});
