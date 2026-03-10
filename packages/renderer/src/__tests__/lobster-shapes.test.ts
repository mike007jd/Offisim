import { describe, it, expect } from 'vitest';
import {
  LOBSTER_BODY,
  LOBSTER_CLAW_L,
  LOBSTER_CLAW_R,
  LOBSTER_EYES,
  LOBSTER_LEGS,
  LOBSTER_ANTENNA_L,
  LOBSTER_ANTENNA_R,
  ACCESSORY_GLASSES,
  ACCESSORY_TIE,
  ACCESSORY_BERET,
} from '../pixel/lobster-shapes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All grids keyed by name for iteration */
const ALL_GRIDS: Record<string, readonly (readonly number[])[]> = {
  LOBSTER_BODY,
  LOBSTER_CLAW_L,
  LOBSTER_CLAW_R,
  LOBSTER_EYES,
  LOBSTER_LEGS,
  LOBSTER_ANTENNA_L,
  LOBSTER_ANTENNA_R,
  ACCESSORY_GLASSES,
  ACCESSORY_TIE,
  ACCESSORY_BERET,
};

/** Check if a grid contains at least one non-zero pixel */
function hasNonZeroPixel(grid: readonly (readonly number[])[]): boolean {
  return grid.some((row) => row.some((cell) => cell !== 0));
}

/** Check if every cell in a grid is a valid palette index (0-16) */
function allIndicesValid(grid: readonly (readonly number[])[]): boolean {
  return grid.every((row) =>
    row.every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= 16),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Lobster shape exports', () => {
  it('all 10 exports exist and are arrays', () => {
    for (const [name, grid] of Object.entries(ALL_GRIDS)) {
      expect(Array.isArray(grid), `${name} should be an array`).toBe(true);
      expect(grid.length, `${name} should have at least 1 row`).toBeGreaterThan(0);
      // Each row is also an array
      for (const row of grid) {
        expect(Array.isArray(row), `${name} rows should be arrays`).toBe(true);
      }
    }
  });
});

describe('LOBSTER_BODY', () => {
  it('has reasonable dimensions (>= 8 rows, >= 6 cols)', () => {
    expect(LOBSTER_BODY.length).toBeGreaterThanOrEqual(8);
    const minCols = Math.min(...LOBSTER_BODY.map((r) => r.length));
    expect(minCols).toBeGreaterThanOrEqual(6);
  });
});

describe('LOBSTER_CLAW_L and LOBSTER_CLAW_R', () => {
  it('have the same dimensions', () => {
    expect(LOBSTER_CLAW_L.length).toBe(LOBSTER_CLAW_R.length);
    for (let r = 0; r < LOBSTER_CLAW_L.length; r++) {
      expect(
        LOBSTER_CLAW_L[r]!.length,
        `row ${r} column count should match`,
      ).toBe(LOBSTER_CLAW_R[r]!.length);
    }
  });

  it('LOBSTER_CLAW_R is a horizontal mirror of LOBSTER_CLAW_L', () => {
    for (let r = 0; r < LOBSTER_CLAW_L.length; r++) {
      const leftRow = LOBSTER_CLAW_L[r]!;
      const rightRow = LOBSTER_CLAW_R[r]!;
      const leftReversed = [...leftRow].reverse();
      expect(
        rightRow,
        `row ${r}: right claw should equal reversed left claw`,
      ).toEqual(leftReversed);
    }
  });
});

describe('Palette index validity', () => {
  it.each(Object.keys(ALL_GRIDS))(
    '%s uses only valid palette indices (0-16)',
    (name) => {
      const grid = ALL_GRIDS[name]!;
      expect(allIndicesValid(grid), `${name} has invalid palette index`).toBe(
        true,
      );
    },
  );
});

describe('Non-empty grids', () => {
  it.each(Object.keys(ALL_GRIDS))(
    '%s has at least one non-zero pixel',
    (name) => {
      const grid = ALL_GRIDS[name]!;
      expect(
        hasNonZeroPixel(grid),
        `${name} should not be completely empty`,
      ).toBe(true);
    },
  );
});

describe('LOBSTER_EYES', () => {
  it('contains at least one white pixel (index 7) for eye sclera', () => {
    const hasWhite = LOBSTER_EYES.some((row) => row.some((cell) => cell === 7));
    expect(hasWhite).toBe(true);
  });

  it('contains at least one dark pixel (index 12) for pupil', () => {
    const hasDark = LOBSTER_EYES.some((row) => row.some((cell) => cell === 12));
    expect(hasDark).toBe(true);
  });
});
