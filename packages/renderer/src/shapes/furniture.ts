// ── Vector furniture drawing functions ──────────────────────────────
// Clean geometric shapes for office scene — NOT pixel art.
// All coordinates relative to (0,0) = center of the furniture piece.

import { Graphics } from 'pixi.js';

// ── Office furniture ─────────────────────────────────────────────

/** Office desk — rounded rectangle with legs */
export function drawDesk(g: Graphics, w = 50, h = 28, color = 0x5c4033): void {
  const legH = 4;
  const legW = 3;
  const topH = h - legH;

  // Desktop surface
  g.roundRect(-w / 2, -h / 2, w, topH, 3);
  g.fill(color);

  // Legs (2 front legs visible)
  g.rect(-w / 2 + 4, -h / 2 + topH, legW, legH);
  g.fill(color - 0x111111);
  g.rect(w / 2 - 4 - legW, -h / 2 + topH, legW, legH);
  g.fill(color - 0x111111);
}

/** Office chair — rounded back + seat */
export function drawChair(g: Graphics, w = 20, h = 22, color = 0x2d3748): void {
  // Seat
  g.roundRect(-w / 2, 0, w, h / 3, 3);
  g.fill(color);
  // Backrest
  g.roundRect(-w / 2 + 2, -h / 2, w - 4, h / 2, 4);
  g.fill(color);
  // Base/wheels (small line)
  g.rect(-w / 4, h / 3, w / 2, 2);
  g.fill(0x4a5568);
}

/** Computer monitor — screen + stand */
export function drawMonitor(g: Graphics, w = 22, h = 18): void {
  // Screen
  g.roundRect(-w / 2, -h / 2, w, h - 4, 2);
  g.fill(0x1e293b);
  // Screen content glow
  g.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 8, 1);
  g.fill(0x334155);
  // Stand
  g.rect(-3, h / 2 - 4, 6, 3);
  g.fill(0x64748b);
  // Base
  g.rect(-6, h / 2 - 1, 12, 2);
  g.fill(0x64748b);
}

// ── Library furniture ────────────────────────────────────────────

/** Bookshelf — tall rectangle with shelves and colored book spines */
export function drawBookshelf(g: Graphics, w = 30, h = 40): void {
  // Frame
  g.roundRect(-w / 2, -h / 2, w, h, 2);
  g.fill(0x8b6914);

  // Shelves (3 horizontal lines)
  const shelfCount = 3;
  const shelfGap = (h - 4) / (shelfCount + 1);
  for (let i = 1; i <= shelfCount; i++) {
    const sy = -h / 2 + 2 + shelfGap * i;
    g.rect(-w / 2 + 2, sy, w - 4, 2);
    g.fill(0x7a5c12);
  }

  // Book spines (colored rectangles on each shelf)
  const bookColors = [0x3b82f6, 0xef4444, 0x10b981, 0xf59e0b, 0x8b5cf6, 0xec4899];
  for (let shelf = 0; shelf < shelfCount; shelf++) {
    const sy = -h / 2 + 4 + shelfGap * shelf;
    const bookW = 4;
    const bookH = shelfGap - 4;
    const booksPerShelf = Math.floor((w - 8) / (bookW + 1));
    for (let b = 0; b < booksPerShelf; b++) {
      const bx = -w / 2 + 4 + b * (bookW + 1);
      g.rect(bx, sy, bookW, bookH);
      g.fill(bookColors[(shelf * booksPerShelf + b) % bookColors.length]);
    }
  }
}

/** Reading table — simple flat table */
export function drawReadingTable(g: Graphics, w = 36, h = 20, color = 0x6b5b3a): void {
  g.roundRect(-w / 2, -h / 2, w, h, 4);
  g.fill(color);
  // Open book on table
  g.rect(-6, -3, 12, 6);
  g.fill(0xfef3c7);
  g.rect(-6, -3, 6, 6);
  g.fill(0xfde68a);
}

// ── Rest area furniture ──────────────────────────────────────────

/** Sofa — rounded couch shape */
export function drawSofa(g: Graphics, w = 44, h = 22, color = 0x6b21a8): void {
  // Seat
  g.roundRect(-w / 2, 0, w, h / 2, 4);
  g.fill(color);
  // Backrest
  g.roundRect(-w / 2, -h / 2, w, h / 2 + 2, 6);
  g.fill(color);
  // Left armrest
  g.roundRect(-w / 2 - 4, -h / 4, 6, h / 2 + h / 4, 4);
  g.fill(color - 0x100010);
  // Right armrest
  g.roundRect(w / 2 - 2, -h / 4, 6, h / 2 + h / 4, 4);
  g.fill(color - 0x100010);
}

/** Coffee table — small round or square table */
export function drawCoffeeTable(g: Graphics, w = 24, h = 16, color = 0x78350f): void {
  g.roundRect(-w / 2, -h / 2, w, h, 6);
  g.fill(color);
  // Cup mark
  g.circle(4, 0, 3);
  g.fill(color + 0x111111);
}

/** Potted plant — pot + leaves */
export function drawPlant(g: Graphics, w = 14, h = 22): void {
  // Pot
  const potW = w * 0.7;
  const potH = h * 0.35;
  g.roundRect(-potW / 2, h / 2 - potH, potW, potH, 2);
  g.fill(0xb45309);
  // Pot rim
  g.rect(-potW / 2 - 1, h / 2 - potH, potW + 2, 3);
  g.fill(0x92400e);

  // Leaves — 3 oval shapes fanning out
  const leafColor = 0x16a34a;
  // Center leaf
  g.ellipse(0, -h / 6, w * 0.3, h * 0.35);
  g.fill(leafColor);
  // Left leaf
  g.ellipse(-w * 0.25, -h / 8, w * 0.25, h * 0.28);
  g.fill(0x15803d);
  // Right leaf
  g.ellipse(w * 0.25, -h / 8, w * 0.25, h * 0.28);
  g.fill(0x15803d);
}

/** Vending machine — tall rectangular machine */
export function drawVendingMachine(g: Graphics, w = 18, h = 32): void {
  // Body
  g.roundRect(-w / 2, -h / 2, w, h, 3);
  g.fill(0x374151);
  // Display window
  g.roundRect(-w / 2 + 3, -h / 2 + 3, w - 6, h * 0.5, 2);
  g.fill(0x60a5fa);
  // Dispenser slot
  g.rect(-w / 2 + 4, h / 2 - 8, w - 8, 5);
  g.fill(0x1f2937);
}
