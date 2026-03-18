import { Graphics } from 'pixi.js';

/**
 * Draw small desk items based on a deterministic seed.
 * Items: coffee cup, pencil holder, sticky note, small plant pot.
 */
export function drawDeskItems(g: Graphics, x: number, y: number, seed: number): void {
  const items = seed % 4;

  if (items === 0 || items === 3) {
    // Coffee cup
    drawCoffeeCup(g, x - 8, y - 2);
  }
  if (items === 1 || items === 3) {
    // Pencil holder
    drawPencilHolder(g, x + 10, y - 2);
  }
  if (items === 2) {
    // Sticky note
    drawStickyNote(g, x - 6, y + 2);
  }
}

function drawCoffeeCup(g: Graphics, x: number, y: number): void {
  // Cup body
  g.roundRect(x, y, 5, 6, 1);
  g.fill({ color: 0xeeeeee, alpha: 0.8 });
  g.stroke({ color: 0xcccccc, alpha: 0.5, width: 0.4 });
  // Handle
  g.moveTo(x + 5, y + 1.5);
  g.quadraticCurveTo(x + 8, y + 3, x + 5, y + 4.5);
  g.stroke({ color: 0xcccccc, alpha: 0.5, width: 0.4 });
  // Steam (two tiny curves)
  g.moveTo(x + 1.5, y - 1);
  g.quadraticCurveTo(x + 2.5, y - 3, x + 1.5, y - 4);
  g.stroke({ color: 0xffffff, alpha: 0.15, width: 0.4 });
  g.moveTo(x + 3.5, y - 0.5);
  g.quadraticCurveTo(x + 4.5, y - 2.5, x + 3.5, y - 3.5);
  g.stroke({ color: 0xffffff, alpha: 0.12, width: 0.4 });
}

function drawPencilHolder(g: Graphics, x: number, y: number): void {
  // Holder cylinder
  g.roundRect(x, y, 4, 7, 0.8);
  g.fill({ color: 0x6b7280, alpha: 0.7 });
  g.stroke({ color: 0x4b5563, alpha: 0.5, width: 0.3 });
  // Pencils sticking out
  g.moveTo(x + 1, y);
  g.lineTo(x + 0, y - 4);
  g.stroke({ color: 0xfbbf24, alpha: 0.7, width: 0.8 });
  g.moveTo(x + 2, y);
  g.lineTo(x + 2.5, y - 5);
  g.stroke({ color: 0x3b82f6, alpha: 0.6, width: 0.8 });
  g.moveTo(x + 3, y);
  g.lineTo(x + 3.5, y - 3.5);
  g.stroke({ color: 0xef4444, alpha: 0.5, width: 0.8 });
}

function drawStickyNote(g: Graphics, x: number, y: number): void {
  // Note body
  g.rect(x, y, 7, 6);
  g.fill({ color: 0xfef08a, alpha: 0.7 });
  // Fold corner
  g.moveTo(x + 5.5, y);
  g.lineTo(x + 7, y + 1.5);
  g.lineTo(x + 7, y);
  g.fill({ color: 0xfde047, alpha: 0.5 });
  // Text lines
  g.moveTo(x + 1, y + 2);
  g.lineTo(x + 5, y + 2);
  g.stroke({ color: 0x92400e, alpha: 0.25, width: 0.3 });
  g.moveTo(x + 1, y + 3.5);
  g.lineTo(x + 4, y + 3.5);
  g.stroke({ color: 0x92400e, alpha: 0.2, width: 0.3 });
}

/**
 * Draw simulated screen content on a monitor based on employee state.
 */
export function drawScreenContent(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  state: 'working' | 'thinking' | 'searching' | 'idle',
): void {
  // Screen background
  g.rect(x + 1, y + 1, w - 2, h - 2);
  g.fill({ color: 0x1a1a2e, alpha: 0.9 });

  switch (state) {
    case 'working': {
      // Code-like green text lines
      const lineColors = [0x4ade80, 0x86efac, 0x22c55e];
      for (let i = 0; i < 4; i++) {
        const lw = 3 + (((x * 7 + i * 13) % 5) * 1.5);
        g.moveTo(x + 3, y + 3 + i * 2.5);
        g.lineTo(x + 3 + lw, y + 3 + i * 2.5);
        g.stroke({ color: lineColors[i % 3], alpha: 0.5, width: 0.6 });
      }
      break;
    }
    case 'thinking': {
      // Yellow notepad / idea
      g.roundRect(x + 2, y + 2, w - 4, h - 4, 1);
      g.fill({ color: 0xfef3c7, alpha: 0.2 });
      g.moveTo(x + 3, y + 4);
      g.lineTo(x + w - 3, y + 4);
      g.stroke({ color: 0xfbbf24, alpha: 0.3, width: 0.4 });
      g.moveTo(x + 3, y + 6);
      g.lineTo(x + w - 5, y + 6);
      g.stroke({ color: 0xfbbf24, alpha: 0.25, width: 0.4 });
      break;
    }
    case 'searching': {
      // Browser-like blue/white
      g.rect(x + 2, y + 2, w - 4, 2);
      g.fill({ color: 0x3b82f6, alpha: 0.3 });
      for (let i = 0; i < 3; i++) {
        g.moveTo(x + 3, y + 5.5 + i * 2);
        g.lineTo(x + w - 4, y + 5.5 + i * 2);
        g.stroke({ color: 0x94a3b8, alpha: 0.2, width: 0.4 });
      }
      break;
    }
    case 'idle': {
      // Dimmed/screensaver
      g.circle(x + w / 2, y + h / 2, 2);
      g.fill({ color: 0x6366f1, alpha: 0.15 });
      break;
    }
  }
}
