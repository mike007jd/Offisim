import { describe, expect, it } from 'vitest';
import { SCENE_COLORS, STATE_COLORS } from '../tokens/colors.js';
import { LAYOUT } from '../tokens/layout.js';
import { MOTION, MOTION_REDUCED } from '../tokens/motion.js';

describe('tokens/colors', () => {
  it('has a color for all 12 employee states', () => {
    const states = [
      'idle',
      'assigned',
      'thinking',
      'searching',
      'executing',
      'meeting',
      'blocked',
      'waiting',
      'reporting',
      'success',
      'failed',
      'paused',
    ] as const;

    for (const s of states) {
      expect(STATE_COLORS[s]).toBeTypeOf('number');
      expect(STATE_COLORS[s]).toBeGreaterThan(0);
    }
  });

  it('scene colors are valid hex numbers', () => {
    for (const value of Object.values(SCENE_COLORS)) {
      expect(value).toBeTypeOf('number');
    }
  });
});

describe('tokens/motion', () => {
  it('MOTION has M0-M3 buckets', () => {
    expect(MOTION.M0.duration).toBe(0);
    expect(MOTION.M1.duration).toBe(0.6);
    expect(MOTION.M2.duration).toBe(0.4);
    expect(MOTION.M3.duration).toBe(0.3);
  });

  it('MOTION_REDUCED has zero or near-zero durations', () => {
    expect(MOTION_REDUCED.M0.duration).toBe(0);
    expect(MOTION_REDUCED.M1.duration).toBe(0);
    expect(MOTION_REDUCED.M2.duration).toBe(0);
    expect(MOTION_REDUCED.M3.duration).toBe(0.1);
  });
});

describe('tokens/layout', () => {
  it('floor dimensions are reasonable', () => {
    expect(LAYOUT.floor.width).toBeGreaterThan(0);
    expect(LAYOUT.floor.height).toBeGreaterThan(0);
  });

  it('desk fits within floor', () => {
    const totalDeskWidth = LAYOUT.desk.width * 2 + LAYOUT.desk.gap;
    expect(totalDeskWidth).toBeLessThan(LAYOUT.floor.width);
  });
});
