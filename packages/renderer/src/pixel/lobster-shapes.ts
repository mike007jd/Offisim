/**
 * Lobster pixel art shape data — BIG front-facing lobster with raised claws.
 *
 * Each export is a 2D grid of palette indices (see pixel-palette.ts).
 * Index 0 = transparent (skip). The lobster faces the viewer (top-down,
 * head at top). Body parts are separate grids for independent animation.
 *
 * Proportions match a real lobster: HUGE claws (dominant feature),
 * narrow elongated body, segmented abdomen, fan-shaped tail.
 *
 * Key palette indices used:
 *   8  = lobster-red (main body / carapace)
 *   9  = coral-orange (belly / segment highlights)
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
// LOBSTER_BODY — narrow elongated: head + thorax + segmented abdomen + tail fan
// 10 wide × 22 tall. Narrow to emphasize the big claws above.
// ---------------------------------------------------------------------------
export const LOBSTER_BODY: readonly (readonly number[])[] = [
  //  0  1  2  3  4  5  6  7  8  9
  [_, _, _, D, D, D, D, _, _, _], // row  0: head crown
  [_, _, D, R, R, R, R, D, _, _], // row  1: head
  [_, D, R, R, O, O, R, R, D, _], // row  2: upper thorax
  [D, R, R, O, O, O, O, R, R, D], // row  3: thorax widest
  [D, R, R, O, O, O, O, R, R, D], // row  4: thorax
  [D, R, R, R, O, O, R, R, R, D], // row  5: thorax lower
  [_, D, R, R, R, R, R, R, D, _], // row  6: thorax base
  [_, _, D, D, R, R, D, D, _, _], // row  7: segment joint ──
  [_, _, D, R, O, O, R, D, _, _], // row  8: abdomen seg 1
  [_, _, D, R, R, R, R, D, _, _], // row  9: abdomen seg 1
  [_, _, _, D, R, R, D, _, _, _], // row 10: segment joint ──
  [_, _, D, R, O, O, R, D, _, _], // row 11: abdomen seg 2
  [_, _, D, R, R, R, R, D, _, _], // row 12: abdomen seg 2
  [_, _, _, D, R, R, D, _, _, _], // row 13: segment joint ──
  [_, _, _, D, R, R, D, _, _, _], // row 14: abdomen seg 3
  [_, _, _, D, R, R, D, _, _, _], // row 15: abdomen narrow
  [_, _, D, R, R, R, R, D, _, _], // row 16: tail start
  [_, D, R, R, R, R, R, R, D, _], // row 17: tail widening
  [D, R, R, R, D, D, R, R, R, D], // row 18: tail fan split
  [D, R, R, D, _, _, D, R, R, D], // row 19: tail fan open
  [D, R, D, _, _, _, _, D, R, D], // row 20: tail fan tips
  [_, D, _, _, _, _, _, _, D, _], // row 21: tail edge
] as const;

// ---------------------------------------------------------------------------
// LOBSTER_CLAW_L — left claw, 12×14, HUGE with pincer opening at top
// The two pincer fingers extend upward with a gap between them.
// Claw body (palm) is a large rounded shape below.
// Arm tapers to a joint at the bottom.
// ---------------------------------------------------------------------------
export const LOBSTER_CLAW_L: readonly (readonly number[])[] = [
  [_, _, D, D, _, _, _, _, _, _, _, _], // row  0: upper pincer tip
  [_, D, R, R, D, _, _, _, _, _, D, _], // row  1: upper pincer
  [D, R, R, R, D, _, _, _, D, R, R, D], // row  2: both pincer fingers
  [D, R, R, R, R, D, _, D, R, R, R, D], // row  3: pincers approaching
  [_, D, R, R, R, R, D, R, R, R, D, _], // row  4: V closing
  [_, _, D, R, R, R, R, R, R, D, _, _], // row  5: claw head (pincers merged)
  [_, D, R, R, R, R, R, R, R, R, D, _], // row  6: claw body widening
  [_, D, R, R, R, O, O, R, R, R, D, _], // row  7: claw body + highlight
  [_, D, R, R, R, O, O, R, R, R, D, _], // row  8: claw body + highlight
  [_, D, R, R, R, R, R, R, R, R, D, _], // row  9: claw body
  [_, _, D, R, R, R, R, R, R, D, _, _], // row 10: narrowing → arm
  [_, _, _, D, R, R, R, R, D, _, _, _], // row 11: arm
  [_, _, _, _, D, R, R, D, _, _, _, _], // row 12: arm narrow
  [_, _, _, _, _, D, D, _, _, _, _, _], // row 13: joint
] as const;

// ---------------------------------------------------------------------------
// LOBSTER_CLAW_R — right claw, 12×14, horizontally mirrored from left
// ---------------------------------------------------------------------------
export const LOBSTER_CLAW_R: readonly (readonly number[])[] = [
  [_, _, _, _, _, _, _, _, D, D, _, _], // row  0: (mirrored)
  [_, D, _, _, _, _, _, D, R, R, D, _], // row  1: (mirrored)
  [D, R, R, D, _, _, _, D, R, R, R, D], // row  2: (mirrored)
  [D, R, R, R, D, _, D, R, R, R, R, D], // row  3: (mirrored)
  [_, D, R, R, R, D, R, R, R, R, D, _], // row  4: (mirrored)
  [_, _, D, R, R, R, R, R, R, D, _, _], // row  5: (palindrome)
  [_, D, R, R, R, R, R, R, R, R, D, _], // row  6: (palindrome)
  [_, D, R, R, R, O, O, R, R, R, D, _], // row  7: (palindrome)
  [_, D, R, R, R, O, O, R, R, R, D, _], // row  8: (palindrome)
  [_, D, R, R, R, R, R, R, R, R, D, _], // row  9: (palindrome)
  [_, _, D, R, R, R, R, R, R, D, _, _], // row 10: (palindrome)
  [_, _, _, D, R, R, R, R, D, _, _, _], // row 11: (palindrome)
  [_, _, _, _, D, R, R, D, _, _, _, _], // row 12: (palindrome)
  [_, _, _, _, _, D, D, _, _, _, _, _], // row 13: (palindrome)
] as const;

// ---------------------------------------------------------------------------
// LOBSTER_EYES — both eyes on short stalks, 8×3
// Eyes sit just above the head. Each has dark outline + white center.
// ---------------------------------------------------------------------------
export const LOBSTER_EYES: readonly (readonly number[])[] = [
  [D, W, D, _, _, D, W, D], // row 0: eye bulbs (outline + white)
  [D, D, D, _, _, D, D, D], // row 1: eye base
  [_, R, _, _, _, _, R, _], // row 2: stalks connecting to head
] as const;

// ---------------------------------------------------------------------------
// LOBSTER_LEGS — 4 pairs of walking legs, 16×4
// Positioned behind body at thorax level; only parts extending beyond
// body width are visible. Outer legs are longer (more rows filled).
// ---------------------------------------------------------------------------
export const LOBSTER_LEGS: readonly (readonly number[])[] = [
  [R, _, R, _, R, _, R, _, _, R, _, R, _, R, _, R], // row 0: 8 legs (4 pairs)
  [D, _, D, _, D, _, D, _, _, D, _, D, _, D, _, D], // row 1: leg middles
  [D, _, _, _, D, _, _, _, _, _, _, D, _, _, _, D], // row 2: outer 2 pairs longer
  [_, _, _, _, D, _, _, _, _, _, _, D, _, _, _, _], // row 3: outermost pair tips
] as const;

// ---------------------------------------------------------------------------
// LOBSTER_ANTENNA_L — left antenna, 3×8, long curved line extending up-left
// Diagonal curve: tip at top-left, base at bottom-right (connects to head)
// ---------------------------------------------------------------------------
export const LOBSTER_ANTENNA_L: readonly (readonly number[])[] = [
  [D, _, _], // row 0: tip
  [D, _, _], // row 1
  [R, _, _], // row 2
  [R, D, _], // row 3: curve
  [_, R, _], // row 4
  [_, R, _], // row 5
  [_, R, D], // row 6: curve
  [_, _, R], // row 7: base (toward center)
] as const;

// ---------------------------------------------------------------------------
// LOBSTER_ANTENNA_R — right antenna, 3×8, horizontally mirrored from left
// Diagonal curve: tip at top-right, base at bottom-left
// ---------------------------------------------------------------------------
export const LOBSTER_ANTENNA_R: readonly (readonly number[])[] = [
  [_, _, D], // row 0: tip (mirrored)
  [_, _, D], // row 1
  [_, _, R], // row 2
  [_, D, R], // row 3: curve
  [_, R, _], // row 4: (palindrome)
  [_, R, _], // row 5: (palindrome)
  [D, R, _], // row 6: curve
  [R, _, _], // row 7: base (mirrored)
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
