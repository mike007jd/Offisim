import type { Graphics } from 'pixi.js';
import { PIXEL_PALETTE, PX } from './pixel-palette.js';

/**
 * Draw a pixel art grid onto a Graphics object.
 * Each cell in `grid[row][col]` is a palette index.
 * Index 0 = transparent (skip). Any other index -> draw a PX*PX rect.
 *
 * @param g - Target Graphics object (will NOT be cleared)
 * @param grid - 2D array of palette indices
 * @param offsetX - Horizontal offset in screen pixels
 * @param offsetY - Vertical offset in screen pixels
 * @param palette - Custom palette override (default: PIXEL_PALETTE)
 */
export function drawPixelGrid(
  g: Graphics,
  grid: readonly (readonly number[])[],
  offsetX = 0,
  offsetY = 0,
  palette: readonly number[] = PIXEL_PALETTE,
): void {
  for (let row = 0; row < grid.length; row++) {
    const cols = grid[row]!;
    for (let col = 0; col < cols.length; col++) {
      const idx = cols[col]!;
      if (idx === 0) continue; // transparent
      const color = palette[idx];
      if (color === undefined) continue;
      g.rect(offsetX + col * PX, offsetY + row * PX, PX, PX);
      g.fill(color);
    }
  }
}

/**
 * Generate a hue-shifted color for unique employee colors.
 * Uses simple HSL rotation via RGB manipulation.
 * @param id - String to hash for color derivation
 * @returns Hex color number
 */
export function idToHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  // Map hash to hue [0, 360)
  const hue = ((hash % 360) + 360) % 360;
  // HSL(hue, 70%, 55%) -> RGB
  return hslToHex(hue, 0.7, 0.55);
}

function hslToHex(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const ri = Math.round((r + m) * 255);
  const gi = Math.round((g + m) * 255);
  const bi = Math.round((b + m) * 255);
  return (ri << 16) | (gi << 8) | bi;
}
