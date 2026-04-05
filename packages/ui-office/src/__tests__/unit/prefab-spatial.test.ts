import { describe, expect, it } from 'vitest';
import {
  footprintsOverlap,
  getSpatialSpec,
  rotateLocalPoint,
  toWorldAnchor,
  toWorldFootprint,
} from '../../lib/prefab-spatial';

describe('rotateLocalPoint', () => {
  it('rotation 0 returns same point', () => {
    expect(rotateLocalPoint([1, 2], 0)).toEqual([1, 2]);
  });

  it('rotation 90: [1,2] → [2,-1]', () => {
    expect(rotateLocalPoint([1, 2], 90)).toEqual([2, -1]);
  });

  it('rotation 180: [1,2] → [-1,-2]', () => {
    expect(rotateLocalPoint([1, 2], 180)).toEqual([-1, -2]);
  });

  it('rotation 270: [1,2] → [-2,1]', () => {
    expect(rotateLocalPoint([1, 2], 270)).toEqual([-2, 1]);
  });
});

describe('toWorldAnchor', () => {
  it('rotation 0: offset applied directly', () => {
    const anchor = { offset: [0.5, 1.0] as const, facing: Math.PI };
    const result = toWorldAnchor(anchor, [10, 20], 0);
    expect(result.position[0]).toBeCloseTo(10.5);
    expect(result.position[1]).toBe(0);
    expect(result.position[2]).toBeCloseTo(21);
    expect(result.facing).toBeCloseTo(Math.PI);
  });

  it('rotation 90: offset rotated and facing adjusted', () => {
    const anchor = { offset: [0.5, 1.0] as const, facing: Math.PI };
    const result = toWorldAnchor(anchor, [10, 20], 90);
    expect(result.position[0]).toBeCloseTo(11);
    expect(result.position[1]).toBe(0);
    expect(result.position[2]).toBeCloseTo(19.5);
    expect(result.facing).toBeCloseTo(Math.PI - Math.PI / 2);
  });
});

describe('toWorldFootprint', () => {
  it('rotation 0: keeps halfW/halfD, adds padding', () => {
    const footprint = { halfW: 1.0, halfD: 0.5, padding: 0.1 };
    const result = toWorldFootprint(footprint, [5, 5], 0);
    expect(result.cx).toBeCloseTo(5);
    expect(result.cz).toBeCloseTo(5);
    expect(result.halfW).toBeCloseTo(1.1);
    expect(result.halfD).toBeCloseTo(0.6);
  });

  it('rotation 90: swaps halfW/halfD', () => {
    const footprint = { halfW: 1.0, halfD: 0.5, padding: 0.1 };
    const result = toWorldFootprint(footprint, [5, 5], 90);
    expect(result.cx).toBeCloseTo(5);
    expect(result.cz).toBeCloseTo(5);
    expect(result.halfW).toBeCloseTo(0.6);
    expect(result.halfD).toBeCloseTo(1.1);
  });
});

describe('footprintsOverlap', () => {
  it('overlapping footprints → true', () => {
    const a = { cx: 0, cz: 0, halfW: 1, halfD: 1 };
    const b = { cx: 0.5, cz: 0.5, halfW: 1, halfD: 1 };
    expect(footprintsOverlap(a, b)).toBe(true);
  });

  it('non-overlapping → false', () => {
    const a = { cx: 0, cz: 0, halfW: 1, halfD: 1 };
    const b = { cx: 5, cz: 5, halfW: 1, halfD: 1 };
    expect(footprintsOverlap(a, b)).toBe(false);
  });

  it('overlap on Z axis only → true', () => {
    const a = { cx: 0, cz: 0, halfW: 1, halfD: 2 };
    const b = { cx: 0.5, cz: 3, halfW: 1, halfD: 2 };
    expect(footprintsOverlap(a, b)).toBe(true);
  });

  it('touching exactly at edge → false (strict <, not <=)', () => {
    const a = { cx: 0, cz: 0, halfW: 1, halfD: 1 };
    const b = { cx: 2, cz: 0, halfW: 1, halfD: 1 };
    expect(footprintsOverlap(a, b)).toBe(false);
  });
});

describe('getSpatialSpec', () => {
  it('returns spec for workstation-standard with capacity 1', () => {
    const spec = getSpatialSpec('workstation-standard');
    expect(spec).toBeDefined();
    expect(spec!.capacity).toBe(1);
    expect(spec!.footprint.halfW).toBeCloseTo(1.2);
  });

  it('returns undefined for unknown prefab', () => {
    expect(getSpatialSpec('does-not-exist')).toBeUndefined();
  });

  it('returns spec for meeting-table-4 with capacity 4', () => {
    const spec = getSpatialSpec('meeting-table-4');
    expect(spec).toBeDefined();
    expect(spec!.capacity).toBe(4);
  });
});
