// ── Hair style draw functions ────────────────────────────────────────
// Each function draws a hair style onto a Graphics object.
// Head center is at (0, 0); headRadius comes from PUPPET.head.radius.

import { Graphics } from 'pixi.js';
import type { HairStyle } from './types.js';

/**
 * Draw hair onto the given Graphics object.
 * The head circle is centered at (0, 0) with the given radius.
 */
export function drawHair(g: Graphics, style: HairStyle, color: number, headRadius: number): void {
  HAIR_DRAWERS[style](g, color, headRadius);
}

type HairDrawFn = (g: Graphics, color: number, r: number) => void;

const HAIR_DRAWERS: Record<HairStyle, HairDrawFn> = {
  bald: _drawBald,
  short: _drawShort,
  long: _drawLong,
  ponytail: _drawPonytail,
  curly: _drawCurly,
  bob: _drawBob,
  spiky: _drawSpiky,
  braids: _drawBraids,
};

// ── bald ──────────────────────────────────────────────────────────────
function _drawBald(_g: Graphics, _color: number, _r: number): void {
  // No hair — do nothing
}

// ── short ─────────────────────────────────────────────────────────────
// Small rounded cap sitting on top of the head
function _drawShort(g: Graphics, color: number, r: number): void {
  const capH = r * 0.55;
  // Arc from left to right across the top of the head
  g.moveTo(-r * 0.9, -r * 0.2);
  g.bezierCurveTo(-r * 0.9, -r - capH, r * 0.9, -r - capH, r * 0.9, -r * 0.2);
  // Close across forehead
  g.bezierCurveTo(r * 0.7, -r * 0.4, -r * 0.7, -r * 0.4, -r * 0.9, -r * 0.2);
  g.fill(color);
}

// ── long ──────────────────────────────────────────────────────────────
// Flows down past shoulders with curved ends
function _drawLong(g: Graphics, color: number, r: number): void {
  const flowLen = r * 2.2; // how far below head center hair reaches
  // Left side
  g.moveTo(-r * 0.85, -r * 0.3);
  g.bezierCurveTo(-r * 1.1, -r * 1.2, r * 1.1, -r * 1.2, r * 0.85, -r * 0.3);
  // Right side flowing down
  g.bezierCurveTo(r * 1.05, r * 0.4, r * 0.9, flowLen, r * 0.5, flowLen + r * 0.3);
  // Bottom curve
  g.bezierCurveTo(0, flowLen + r * 0.5, 0, flowLen + r * 0.5, -r * 0.5, flowLen + r * 0.3);
  // Left side flowing back up
  g.bezierCurveTo(-r * 0.9, flowLen, -r * 1.05, r * 0.4, -r * 0.85, -r * 0.3);
  g.fill(color);
}

// ── ponytail ──────────────────────────────────────────────────────────
// Short on top + ponytail trailing to the right side
function _drawPonytail(g: Graphics, color: number, r: number): void {
  // Cap (similar to short)
  g.moveTo(-r * 0.9, -r * 0.15);
  g.bezierCurveTo(-r * 0.9, -r - r * 0.45, r * 0.9, -r - r * 0.45, r * 0.9, -r * 0.15);
  g.bezierCurveTo(r * 0.7, -r * 0.35, -r * 0.7, -r * 0.35, -r * 0.9, -r * 0.15);
  g.fill(color);

  // Ponytail — extending from right side of head, curving down
  const tailStartX = r * 0.6;
  const tailStartY = -r * 0.5;
  g.moveTo(tailStartX, tailStartY);
  g.bezierCurveTo(
    r * 1.6, -r * 0.8,
    r * 2.0, r * 0.2,
    r * 1.4, r * 1.5,
  );
  // Tail tip curves back slightly
  g.bezierCurveTo(r * 1.2, r * 1.8, r * 1.0, r * 1.3, r * 0.7, r * 0.3);
  g.bezierCurveTo(r * 0.8, -r * 0.1, r * 0.7, -r * 0.3, tailStartX, tailStartY);
  g.fill(color);
}

// ── curly ─────────────────────────────────────────────────────────────
// Multiple small bumps/circles on top of head
function _drawCurly(g: Graphics, color: number, r: number): void {
  const bumpR = r * 0.38;
  // Ring of bumps around top of head
  const angles = [-2.6, -2.0, -1.4, -0.8, -0.2, 0.4];
  for (const angle of angles) {
    const bx = Math.cos(angle) * (r * 0.75);
    const by = Math.sin(angle) * (r * 0.75) - r * 0.3;
    g.circle(bx, by, bumpR);
  }
  g.fill(color);
}

// ── bob ───────────────────────────────────────────────────────────────
// Rounded shape framing face, chin-length
function _drawBob(g: Graphics, color: number, r: number): void {
  const chinY = r * 1.0;
  // Start from left, go over top, down right side to chin, across bottom, up left
  g.moveTo(-r * 1.05, 0);
  g.bezierCurveTo(-r * 1.1, -r * 1.0, r * 1.1, -r * 1.0, r * 1.05, 0);
  // Right side down to chin
  g.bezierCurveTo(r * 1.1, chinY * 0.6, r * 1.0, chinY, r * 0.6, chinY + r * 0.15);
  // Across bottom — slight inward curve (framing face)
  g.bezierCurveTo(r * 0.3, chinY + r * 0.05, -r * 0.3, chinY + r * 0.05, -r * 0.6, chinY + r * 0.15);
  // Left side back up
  g.bezierCurveTo(-r * 1.0, chinY, -r * 1.1, chinY * 0.6, -r * 1.05, 0);
  g.fill(color);
}

// ── spiky ─────────────────────────────────────────────────────────────
// Angular pointed shapes going upward
function _drawSpiky(g: Graphics, color: number, r: number): void {
  const spikeH = r * 0.9;
  const spikes = [
    { x: -r * 0.7, tipX: -r * 0.5 },
    { x: -r * 0.3, tipX: -r * 0.15 },
    { x: r * 0.1, tipX: r * 0.2 },
    { x: r * 0.45, tipX: r * 0.55 },
    { x: r * 0.8, tipX: r * 0.65 },
  ];
  for (const spike of spikes) {
    const baseY = -r * 0.5;
    g.moveTo(spike.x - r * 0.2, baseY);
    g.lineTo(spike.tipX, -r - spikeH);
    g.lineTo(spike.x + r * 0.2, baseY);
  }
  // Base cap connecting spikes
  g.moveTo(-r * 0.9, -r * 0.2);
  g.bezierCurveTo(-r * 0.9, -r * 0.8, r * 0.9, -r * 0.8, r * 0.9, -r * 0.2);
  g.bezierCurveTo(r * 0.7, -r * 0.4, -r * 0.7, -r * 0.4, -r * 0.9, -r * 0.2);
  g.fill(color);
}

// ── braids ────────────────────────────────────────────────────────────
// Two strands going down from sides of head
function _drawBraids(g: Graphics, color: number, r: number): void {
  // Top cap
  g.moveTo(-r * 0.85, -r * 0.15);
  g.bezierCurveTo(-r * 0.85, -r - r * 0.35, r * 0.85, -r - r * 0.35, r * 0.85, -r * 0.15);
  g.bezierCurveTo(r * 0.65, -r * 0.35, -r * 0.65, -r * 0.35, -r * 0.85, -r * 0.15);
  g.fill(color);

  // Left braid — series of small ovals going down
  const braidR = r * 0.22;
  const leftX = -r * 0.85;
  for (let i = 0; i < 4; i++) {
    const by = r * 0.1 + i * braidR * 1.6;
    const offset = i % 2 === 0 ? -braidR * 0.3 : braidR * 0.3;
    g.circle(leftX + offset, by, braidR);
  }
  g.fill(color);

  // Right braid
  const rightX = r * 0.85;
  for (let i = 0; i < 4; i++) {
    const by = r * 0.1 + i * braidR * 1.6;
    const offset = i % 2 === 0 ? braidR * 0.3 : -braidR * 0.3;
    g.circle(rightX + offset, by, braidR);
  }
  g.fill(color);
}
