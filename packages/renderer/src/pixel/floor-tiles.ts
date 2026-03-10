/**
 * Floor tile patterns for checkerboard office floor.
 *
 * Each tile is a 16×16 grid of palette indices (see pixel-palette.ts).
 * Index 0 = transparent, 1 = ocean-deep, 2 = ocean-mid.
 * Grid accent: every 4th row/col intersection gets the alternate color,
 * creating a subtle embedded grid pattern.
 */

// Shorthand aliases
const A = 1; // ocean-deep
const B = 2; // ocean-mid

// ---------------------------------------------------------------------------
// Helper: generate a 16×16 tile with `base` fill and `accent` at grid points
// ---------------------------------------------------------------------------
function makeTile(base: number, accent: number): readonly (readonly number[])[] {
  const rows: number[][] = [];
  for (let r = 0; r < 16; r++) {
    const row: number[] = [];
    for (let c = 0; c < 16; c++) {
      // Place accent at every 4th row/col intersection (0, 4, 8, 12)
      if (r % 4 === 0 && c % 4 === 0) {
        row.push(accent);
      } else {
        row.push(base);
      }
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Floor tile A — base tile using ocean-deep (1) with subtle grid lines.
 * 16×16 grid of palette indices.
 * Grid intersections use ocean-mid (2) for subtle accent.
 */
export const FLOOR_TILE_A: readonly (readonly number[])[] = makeTile(A, B);

/**
 * Floor tile B — alternate tile, slightly lighter (ocean-mid 2 base) for checkerboard.
 * 16×16 grid of palette indices.
 * Grid intersections use ocean-deep (1) for subtle accent.
 */
export const FLOOR_TILE_B: readonly (readonly number[])[] = makeTile(B, A);
