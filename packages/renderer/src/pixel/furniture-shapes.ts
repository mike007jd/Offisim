/**
 * Pixel art furniture shapes for the office scene.
 *
 * Each export is a 2D grid of palette indices (see pixel-palette.ts).
 * Index 0 = transparent (skip).
 *
 * Key palette indices used:
 *   3  = ocean-light (desk surface, chair seat)
 *   4  = shell (desk edges, chair back)
 *   11 = sea-blue (monitor screen)
 *   12 = abyss (desk legs, monitor frame, chair legs)
 */

// Shorthand aliases for readability
const _ = 0;  // transparent
const L = 3;  // ocean-light (surface/seat)
const S = 4;  // shell (edges/back)
const B = 11; // sea-blue (screen)
const D = 12; // abyss (dark: legs/frame)

// ---------------------------------------------------------------------------
// PIXEL_DESK — top-down view, 20×10
// Rectangular desk surface: darker edge (shell), lighter center (ocean-light),
// dark corner legs (abyss)
// ---------------------------------------------------------------------------
export const PIXEL_DESK: readonly (readonly number[])[] = [
  //  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19
  [_, D, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, D, _], // row 0: top edge with corner legs
  [D, S, S, L, L, L, L, L, L, L, L, L, L, L, L, L, L, S, S, D], // row 1: edge + inner surface
  [S, S, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, S, S], // row 2: surface
  [S, S, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, S, S], // row 3: surface
  [S, S, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, S, S], // row 4: surface center
  [S, S, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, S, S], // row 5: surface center
  [S, S, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, S, S], // row 6: surface
  [S, S, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, L, S, S], // row 7: surface
  [D, S, S, L, L, L, L, L, L, L, L, L, L, L, L, L, L, S, S, D], // row 8: edge + inner surface
  [_, D, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, D, _], // row 9: bottom edge with corner legs
] as const;

// ---------------------------------------------------------------------------
// PIXEL_MONITOR — front-facing monitor, 8×6
// Dark frame (abyss), blue screen (sea-blue), small stand at bottom (shell)
// ---------------------------------------------------------------------------
export const PIXEL_MONITOR: readonly (readonly number[])[] = [
  //  0  1  2  3  4  5  6  7
  [D, D, D, D, D, D, D, D], // row 0: top frame
  [D, B, B, B, B, B, B, D], // row 1: screen
  [D, B, B, B, B, B, B, D], // row 2: screen
  [D, B, B, B, B, B, B, D], // row 3: screen
  [D, D, D, D, D, D, D, D], // row 4: bottom frame
  [_, _, _, S, S, _, _, _], // row 5: stand
] as const;

// ---------------------------------------------------------------------------
// PIXEL_CHAIR — top-down office chair, 6×8
// Back rest at top (shell), seat cushion (ocean-light), base/legs (abyss)
// ---------------------------------------------------------------------------
export const PIXEL_CHAIR: readonly (readonly number[])[] = [
  //  0  1  2  3  4  5
  [_, S, S, S, S, _], // row 0: backrest top
  [S, S, S, S, S, S], // row 1: backrest full
  [S, S, S, S, S, S], // row 2: backrest bottom
  [_, L, L, L, L, _], // row 3: seat top
  [L, L, L, L, L, L], // row 4: seat full
  [L, L, L, L, L, L], // row 5: seat bottom
  [_, D, _, _, D, _], // row 6: legs/base
  [_, D, _, _, D, _], // row 7: legs/casters
] as const;
