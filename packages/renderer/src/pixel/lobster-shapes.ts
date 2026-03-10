/**
 * Lobster pixel art shape data.
 *
 * Each export is a 2D grid of palette indices (see pixel-palette.ts).
 * Index 0 = transparent (skip). The lobster is front-facing (top-down view,
 * looking at the user). Body parts are separate grids for independent animation.
 *
 * Key palette indices used:
 *   8  = lobster-red (main body)
 *   9  = coral-orange (belly/highlights)
 *   12 = abyss (outlines, pupils)
 *   7  = pearl/white (eyes)
 *   11 = sea-blue (accessory lenses)
 *   14 = violet (beret)
 */

// Shorthand aliases for readability while editing grids
const _ = 0; // transparent
const R = 8; // lobster-red
const O = 9; // coral-orange
const D = 12; // abyss (dark outline / pupil)
const W = 7; // pearl white (eyes)
const B = 11; // sea-blue (glasses lenses)
const V = 14; // violet (beret)

// ---------------------------------------------------------------------------
// LOBSTER_BODY — main body + tail, ~12 wide x 10 tall
// Front-facing top-down view: rounded top (head), wider mid, tapers to tail
// ---------------------------------------------------------------------------
export const LOBSTER_BODY: readonly (readonly number[])[] = [
  //  0  1  2  3  4  5  6  7  8  9 10 11
  [_, _, _, D, D, D, D, D, D, _, _, _], // row 0: head outline top
  [_, _, D, R, R, R, R, R, R, D, _, _], // row 1: head fill
  [_, D, R, R, O, O, O, O, R, R, D, _], // row 2: head wider, inner highlight
  [_, D, R, O, O, O, O, O, O, R, D, _], // row 3: upper body with belly
  [D, R, R, O, O, O, O, O, O, R, R, D], // row 4: widest — full body
  [D, R, R, R, O, O, O, O, R, R, R, D], // row 5: mid body
  [_, D, R, R, R, R, R, R, R, R, D, _], // row 6: lower body narrowing
  [_, _, D, R, R, R, R, R, R, D, _, _], // row 7: tail start
  [_, _, _, D, R, R, R, R, D, _, _, _], // row 8: tail narrowing
  [_, _, _, _, D, D, D, D, _, _, _, _], // row 9: tail tip
] as const;

// ---------------------------------------------------------------------------
// LOBSTER_CLAW_L — left claw, 5×5, pincer shape (open V with filled base)
// The claw faces left — pincer opens to the left side
// ---------------------------------------------------------------------------
export const LOBSTER_CLAW_L: readonly (readonly number[])[] = [
  [D, _, _, _, _], // row 0: upper pincer tip
  [R, D, _, _, D], // row 1: upper pincer arm + lower tip
  [_, R, D, D, R], // row 2: pincer meet
  [_, _, R, R, _], // row 3: wrist
  [_, _, _, D, _], // row 4: arm joint
] as const;

// ---------------------------------------------------------------------------
// LOBSTER_CLAW_R — right claw, 5×5, horizontally mirrored from left
// The claw faces right — pincer opens to the right side
// ---------------------------------------------------------------------------
export const LOBSTER_CLAW_R: readonly (readonly number[])[] = [
  [_, _, _, _, D], // row 0: upper pincer tip (mirrored)
  [D, _, _, D, R], // row 1: upper pincer arm + lower tip (mirrored)
  [R, D, D, R, _], // row 2: pincer meet (mirrored)
  [_, R, R, _, _], // row 3: wrist (mirrored)
  [_, D, _, _, _], // row 4: arm joint (mirrored)
] as const;

// ---------------------------------------------------------------------------
// LOBSTER_EYES — both eyes together, 6×2
// Each eye: white sclera with dark pupil
// ---------------------------------------------------------------------------
export const LOBSTER_EYES: readonly (readonly number[])[] = [
  [_, W, D, _, W, D], // row 0: top of eyes (white + pupil)
  [_, W, W, _, W, W], // row 1: bottom of eyes (white)
] as const;

// ---------------------------------------------------------------------------
// LOBSTER_LEGS — 4 pairs of legs, 8×3
// Small line segments extending down from body
// ---------------------------------------------------------------------------
export const LOBSTER_LEGS: readonly (readonly number[])[] = [
  [R, _, R, _, _, R, _, R], // row 0: leg tops (4 pairs)
  [D, _, D, _, _, D, _, D], // row 1: leg middles
  [D, _, D, _, _, D, _, D], // row 2: leg tips
] as const;

// ---------------------------------------------------------------------------
// LOBSTER_ANTENNA_L — left antenna, 1×3, thin vertical line
// ---------------------------------------------------------------------------
export const LOBSTER_ANTENNA_L: readonly (readonly number[])[] = [
  [D], // row 0: tip
  [R], // row 1: mid
  [R], // row 2: base
] as const;

// ---------------------------------------------------------------------------
// LOBSTER_ANTENNA_R — right antenna, 1×3, thin vertical line
// ---------------------------------------------------------------------------
export const LOBSTER_ANTENNA_R: readonly (readonly number[])[] = [
  [D], // row 0: tip
  [R], // row 1: mid
  [R], // row 2: base
] as const;

// ===========================================================================
// Role accessories — optional overlays for different employee roles
// ===========================================================================

// ---------------------------------------------------------------------------
// ACCESSORY_GLASSES — developer role, 6×2
// Frames in abyss, lenses in sea-blue
// ---------------------------------------------------------------------------
export const ACCESSORY_GLASSES: readonly (readonly number[])[] = [
  [D, B, D, D, B, D], // row 0: lens frames top (two lenses with bridge)
  [D, D, D, D, D, D], // row 1: lens frames bottom
] as const;

// ---------------------------------------------------------------------------
// ACCESSORY_TIE — manager role, 2×4
// Tie body in lobster-red, knot in abyss
// ---------------------------------------------------------------------------
export const ACCESSORY_TIE: readonly (readonly number[])[] = [
  [D, D], // row 0: knot
  [R, R], // row 1: upper tie
  [R, R], // row 2: lower tie
  [_, R], // row 3: tie tip (off-center for style)
] as const;

// ---------------------------------------------------------------------------
// ACCESSORY_BERET — designer role, 5×3
// Main hat in violet
// ---------------------------------------------------------------------------
export const ACCESSORY_BERET: readonly (readonly number[])[] = [
  [_, _, V, _, _], // row 0: beret top (pom-pom)
  [_, V, V, V, _], // row 1: beret mid
  [V, V, V, V, V], // row 2: beret brim
] as const;
