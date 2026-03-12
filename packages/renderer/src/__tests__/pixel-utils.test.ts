import { describe, expect, it } from 'vitest';
import { PIXEL_PALETTE, PX, drawPixelGrid, idToHue } from '../pixel/index.js';

// ---------------------------------------------------------------------------
// Mock Graphics — tracks rect() and fill() calls
// ---------------------------------------------------------------------------
function createMockGraphics() {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    calls,
    rect(x: number, y: number, w: number, h: number) {
      calls.push({ method: 'rect', args: [x, y, w, h] });
      return this;
    },
    fill(color: number) {
      calls.push({ method: 'fill', args: [color] });
      return this;
    },
  };
}

// ---------------------------------------------------------------------------
// PX constant
// ---------------------------------------------------------------------------
describe('PX constant', () => {
  it('should be 3', () => {
    expect(PX).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// PIXEL_PALETTE
// ---------------------------------------------------------------------------
describe('PIXEL_PALETTE', () => {
  it('has 17 entries (indices 0-16)', () => {
    expect(PIXEL_PALETTE).toHaveLength(17);
  });

  it('index 0 is the transparent sentinel (0x000000)', () => {
    expect(PIXEL_PALETTE[0]).toBe(0x000000);
  });

  it('all entries are valid hex color numbers', () => {
    for (const color of PIXEL_PALETTE) {
      expect(color).toBeGreaterThanOrEqual(0x000000);
      expect(color).toBeLessThanOrEqual(0xffffff);
    }
  });
});

// ---------------------------------------------------------------------------
// drawPixelGrid
// ---------------------------------------------------------------------------
describe('drawPixelGrid', () => {
  it('draws correct number of rects for non-zero cells', () => {
    const grid = [
      [1, 0, 2],
      [0, 3, 0],
      [4, 5, 6],
    ];
    const mock = createMockGraphics();
    drawPixelGrid(mock as never, grid);

    const rectCalls = mock.calls.filter((c) => c.method === 'rect');
    const fillCalls = mock.calls.filter((c) => c.method === 'fill');

    // Non-zero cells: (0,0)=1, (0,2)=2, (1,1)=3, (2,0)=4, (2,1)=5, (2,2)=6 → 6
    expect(rectCalls).toHaveLength(6);
    expect(fillCalls).toHaveLength(6);
  });

  it('skips index 0 (transparent)', () => {
    const grid = [
      [0, 0],
      [0, 0],
    ];
    const mock = createMockGraphics();
    drawPixelGrid(mock as never, grid);

    expect(mock.calls).toHaveLength(0);
  });

  it('applies correct coordinates with default offset', () => {
    const grid = [[1, 2]];
    const mock = createMockGraphics();
    drawPixelGrid(mock as never, grid);

    const rectCalls = mock.calls.filter((c) => c.method === 'rect');
    // Cell (0,0): x = 0*PX = 0, y = 0*PX = 0
    expect(rectCalls[0]!.args).toEqual([0, 0, PX, PX]);
    // Cell (0,1): x = 1*PX = 3, y = 0*PX = 0
    expect(rectCalls[1]!.args).toEqual([PX, 0, PX, PX]);
  });

  it('applies custom offset correctly', () => {
    const grid = [[1]];
    const mock = createMockGraphics();
    drawPixelGrid(mock as never, grid, 10, 20);

    const rectCalls = mock.calls.filter((c) => c.method === 'rect');
    // Cell (0,0) with offset: x = 10 + 0*PX = 10, y = 20 + 0*PX = 20
    expect(rectCalls[0]!.args).toEqual([10, 20, PX, PX]);
  });

  it('uses the correct palette color for each index', () => {
    const grid = [[1, 8]];
    const mock = createMockGraphics();
    drawPixelGrid(mock as never, grid);

    const fillCalls = mock.calls.filter((c) => c.method === 'fill');
    expect(fillCalls[0]!.args[0]).toBe(PIXEL_PALETTE[1]); // ocean-deep
    expect(fillCalls[1]!.args[0]).toBe(PIXEL_PALETTE[8]); // lobster-red
  });

  it('skips out-of-range palette indices gracefully', () => {
    const grid = [[99]]; // index 99 doesn't exist
    const mock = createMockGraphics();
    drawPixelGrid(mock as never, grid);

    // Should skip because palette[99] is undefined
    expect(mock.calls).toHaveLength(0);
  });

  it('accepts a custom palette override', () => {
    const customPalette = [0x000000, 0xaabbcc];
    const grid = [[1]];
    const mock = createMockGraphics();
    drawPixelGrid(mock as never, grid, 0, 0, customPalette);

    const fillCalls = mock.calls.filter((c) => c.method === 'fill');
    expect(fillCalls[0]!.args[0]).toBe(0xaabbcc);
  });
});

// ---------------------------------------------------------------------------
// idToHue
// ---------------------------------------------------------------------------
describe('idToHue', () => {
  it('returns consistent color for the same ID (deterministic)', () => {
    const color1 = idToHue('employee-alice');
    const color2 = idToHue('employee-alice');
    expect(color1).toBe(color2);
  });

  it('returns different colors for different IDs', () => {
    const colorA = idToHue('alice');
    const colorB = idToHue('bob');
    expect(colorA).not.toBe(colorB);
  });

  it('returns a number in valid RGB range (0x000000 to 0xFFFFFF)', () => {
    const ids = ['a', 'test', 'employee-42', 'zzzz', ''];
    for (const id of ids) {
      const color = idToHue(id);
      expect(color).toBeGreaterThanOrEqual(0x000000);
      expect(color).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('returns an integer (no fractional bits)', () => {
    const color = idToHue('some-employee');
    expect(Number.isInteger(color)).toBe(true);
  });
});
