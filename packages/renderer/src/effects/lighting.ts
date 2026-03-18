import { Graphics } from 'pixi.js';

/**
 * Draw a soft shadow ellipse beneath an entity for visual grounding.
 */
export function drawEntityShadow(g: Graphics, x: number, y: number, width: number): void {
  g.ellipse(x, y + 2, width * 0.45, width * 0.12);
  g.fill({ color: 0x000000, alpha: 0.12 });
}

/**
 * Draw subtle vignette darkening around zone edges for depth.
 */
export function drawZoneVignette(
  g: Graphics,
  zx: number,
  zy: number,
  zw: number,
  zh: number,
  alpha = 0.06,
): void {
  const inset = 8;
  // Top edge
  g.rect(zx, zy, zw, inset);
  g.fill({ color: 0x000000, alpha: alpha * 1.2 });
  // Bottom edge
  g.rect(zx, zy + zh - inset, zw, inset);
  g.fill({ color: 0x000000, alpha });
  // Left edge
  g.rect(zx, zy + inset, inset, zh - inset * 2);
  g.fill({ color: 0x000000, alpha: alpha * 0.8 });
  // Right edge
  g.rect(zx + zw - inset, zy + inset, inset, zh - inset * 2);
  g.fill({ color: 0x000000, alpha: alpha * 0.8 });
}

/**
 * Draw a faint colored glow circle simulating monitor light.
 */
export function drawMonitorGlow(g: Graphics, x: number, y: number, color = 0x4488cc): void {
  g.circle(x, y - 4, 18);
  g.fill({ color, alpha: 0.04 });
  g.circle(x, y - 4, 10);
  g.fill({ color, alpha: 0.06 });
}

/**
 * Draw a subtle grid pattern overlay on a zone for operational feel.
 */
export function drawZoneGrid(
  g: Graphics,
  zx: number,
  zy: number,
  zw: number,
  zh: number,
  spacing = 24,
  alpha = 0.03,
): void {
  for (let x = zx + spacing; x < zx + zw; x += spacing) {
    g.moveTo(x, zy);
    g.lineTo(x, zy + zh);
  }
  for (let y = zy + spacing; y < zy + zh; y += spacing) {
    g.moveTo(zx, y);
    g.lineTo(zx + zw, y);
  }
  g.stroke({ color: 0xffffff, alpha, width: 0.5 });
}
