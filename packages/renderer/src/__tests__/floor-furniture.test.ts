import { describe, it, expect, vi } from 'vitest';

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
    circle() { return this; }
    roundRect() { return this; }
    rect() { return this; }
    fill(_c?: unknown) { return this; }
    stroke(_c?: unknown) { return this; }
    cut() { return this; }
  }
  return {
    Container: MockContainer,
    Graphics: MockGraphics,
    Text: class extends MockContainer { text = ''; anchor = { set: vi.fn() }; },
  };
});

vi.mock('gsap', () => ({
  default: {
    to: vi.fn(() => ({ kill: vi.fn(), vars: {} })),
    fromTo: vi.fn(() => ({ kill: vi.fn(), vars: {} })),
  },
}));

import { FLOOR_TILE_A, FLOOR_TILE_B } from '../pixel/floor-tiles.js';
import { PIXEL_DESK, PIXEL_MONITOR, PIXEL_CHAIR } from '../pixel/furniture-shapes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check every cell is a valid palette index (0-16) */
function allIndicesValid(grid: readonly (readonly number[])[]): boolean {
  return grid.every((row) =>
    row.every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= 16),
  );
}

/** Check if a grid contains at least one non-zero pixel */
function hasNonZeroPixel(grid: readonly (readonly number[])[]): boolean {
  return grid.some((row) => row.some((cell) => cell !== 0));
}

/** Check if a grid contains a specific palette index */
function containsIndex(grid: readonly (readonly number[])[], idx: number): boolean {
  return grid.some((row) => row.some((cell) => cell === idx));
}

// ---------------------------------------------------------------------------
// Floor tile tests
// ---------------------------------------------------------------------------

describe('FLOOR_TILE_A', () => {
  it('is 16×16 (16 rows, each with 16 cols)', () => {
    expect(FLOOR_TILE_A.length).toBe(16);
    for (const row of FLOOR_TILE_A) {
      expect(row.length).toBe(16);
    }
  });
});

describe('FLOOR_TILE_B', () => {
  it('is 16×16 (16 rows, each with 16 cols)', () => {
    expect(FLOOR_TILE_B.length).toBe(16);
    for (const row of FLOOR_TILE_B) {
      expect(row.length).toBe(16);
    }
  });
});

describe('Floor tiles — palette validity', () => {
  it('FLOOR_TILE_A uses only valid palette indices (0-16)', () => {
    expect(allIndicesValid(FLOOR_TILE_A)).toBe(true);
  });

  it('FLOOR_TILE_B uses only valid palette indices (0-16)', () => {
    expect(allIndicesValid(FLOOR_TILE_B)).toBe(true);
  });
});

describe('Floor tiles — non-empty', () => {
  it('FLOOR_TILE_A has non-zero pixels', () => {
    expect(hasNonZeroPixel(FLOOR_TILE_A)).toBe(true);
  });

  it('FLOOR_TILE_B has non-zero pixels', () => {
    expect(hasNonZeroPixel(FLOOR_TILE_B)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Furniture shape tests
// ---------------------------------------------------------------------------

describe('PIXEL_DESK', () => {
  it('has reasonable dimensions (at least 8 cols, at least 5 rows)', () => {
    expect(PIXEL_DESK.length).toBeGreaterThanOrEqual(5);
    const minCols = Math.min(...PIXEL_DESK.map((r) => r.length));
    expect(minCols).toBeGreaterThanOrEqual(8);
  });

  it('contains ocean-light (index 3) pixels for surface', () => {
    expect(containsIndex(PIXEL_DESK, 3)).toBe(true);
  });
});

describe('PIXEL_MONITOR', () => {
  it('has reasonable dimensions (at least 4 cols, at least 3 rows)', () => {
    expect(PIXEL_MONITOR.length).toBeGreaterThanOrEqual(3);
    const minCols = Math.min(...PIXEL_MONITOR.map((r) => r.length));
    expect(minCols).toBeGreaterThanOrEqual(4);
  });

  it('contains sea-blue (index 11) pixels for screen', () => {
    expect(containsIndex(PIXEL_MONITOR, 11)).toBe(true);
  });
});

describe('PIXEL_CHAIR', () => {
  it('has reasonable dimensions (at least 4 cols, at least 4 rows)', () => {
    expect(PIXEL_CHAIR.length).toBeGreaterThanOrEqual(4);
    const minCols = Math.min(...PIXEL_CHAIR.map((r) => r.length));
    expect(minCols).toBeGreaterThanOrEqual(4);
  });
});

describe('All furniture shapes — palette validity', () => {
  it('PIXEL_DESK uses only valid palette indices (0-16)', () => {
    expect(allIndicesValid(PIXEL_DESK)).toBe(true);
  });

  it('PIXEL_MONITOR uses only valid palette indices (0-16)', () => {
    expect(allIndicesValid(PIXEL_MONITOR)).toBe(true);
  });

  it('PIXEL_CHAIR uses only valid palette indices (0-16)', () => {
    expect(allIndicesValid(PIXEL_CHAIR)).toBe(true);
  });
});
