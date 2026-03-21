import { describe, expect, it } from 'vitest';
import { STATE_COLORS } from '../tokens/colors.js';
import {
  MOTION,
  MOTION_REDUCED,
  MOTION_TIER_A,
  MOTION_TIER_B,
  MOTION_TIER_C,
  getMotionForTier,
} from '../tokens/motion.js';

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

describe('Performance Tiers', () => {
  it('Tier A returns full motion', () => {
    expect(getMotionForTier('A')).toBe(MOTION_TIER_A);
  });

  it('Tier B has shortened durations', () => {
    expect(MOTION_TIER_B.M1.duration).toBe(0.2);
    expect(MOTION_TIER_B.M2.duration).toBe(0.15);
  });

  it('Tier C returns zero motion', () => {
    expect(getMotionForTier('C')).toBe(MOTION_TIER_C);
    expect(MOTION_TIER_C.M1.duration).toBe(0);
  });
});

describe('tokens/departments', () => {
  it('resolves known role slugs', async () => {
    const { resolveEmployeeDepartment } = await import('../tokens/departments.js');
    expect(resolveEmployeeDepartment('developer')).toBe('dev');
    expect(resolveEmployeeDepartment('pm')).toBe('product');
    expect(resolveEmployeeDepartment('designer')).toBe('art');
    expect(resolveEmployeeDepartment('unknown')).toBeNull();
  });
});
