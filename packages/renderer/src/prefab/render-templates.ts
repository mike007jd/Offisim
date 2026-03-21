/**
 * GraphicsContext-based render template registry for prefabs.
 *
 * Key PixiJS 8 pattern:
 * - Templates produce `GraphicsContext` objects (NOT `Graphics`).
 * - At prefab creation, one context is built per state.
 * - At runtime, state changes swap `graphics.context = stateContexts.get(state)`
 *   — a cheap O(1) pointer assignment, no clear-and-rebuild.
 *
 * State-aware templates vary color/details per state string.
 * Stateless templates simply ignore the `state` parameter.
 */
import { GraphicsContext } from 'pixi.js';

// ── Public types ────────────────────────────────────────────────

/** A render template function builds a GraphicsContext for a given state. */
export type RenderTemplateFn = (
  params: Record<string, unknown>,
  state: string,
) => GraphicsContext;

// ── Registry ────────────────────────────────────────────────────

const TEMPLATE_REGISTRY = new Map<string, RenderTemplateFn>();

export function registerTemplate(name: string, fn: RenderTemplateFn): void {
  TEMPLATE_REGISTRY.set(name, fn);
}

export function getTemplate(name: string): RenderTemplateFn | undefined {
  return TEMPLATE_REGISTRY.get(name);
}

export function getAllTemplateNames(): string[] {
  return [...TEMPLATE_REGISTRY.keys()];
}

/** Pre-build GraphicsContexts for each state — one context per state entry. */
export function buildStateContexts(
  fn: RenderTemplateFn,
  params: Record<string, unknown>,
  states: string[],
): Map<string, GraphicsContext> {
  const map = new Map<string, GraphicsContext>();
  for (const state of states) {
    map.set(state, fn(params, state));
  }
  return map;
}

// ── Helpers ─────────────────────────────────────────────────────

/** Safely cast a param to number with fallback. */
function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' ? v : fallback;
}

// ── State-color maps ────────────────────────────────────────────

const MONITOR_SCREEN_COLORS: Record<string, number> = {
  empty:     0x1e293b,
  occupied:  0x334155,
  working:   0x22c55e, // green glow
  thinking:  0x3b82f6, // blue pulse
  searching: 0xf59e0b, // amber scan
  blocked:   0xef4444, // red warning
  idle:      0x334155,
};

const SERVER_LED_COLORS: Record<string, number> = {
  offline:     0x475569,
  idle:        0x22c55e,
  processing:  0x3b82f6,
  overloaded:  0xef4444,
  error:       0xef4444,
};

const BOOK_GLOW_COLORS: Record<string, number> = {
  empty:     0x8b6914,
  stocked:   0x8b6914,
  indexing:  0x3b82f6,
  ready:     0x22c55e,
  searching: 0xf59e0b,
  error:     0xef4444,
};

// ── Built-in templates ──────────────────────────────────────────
// Ported from shapes/furniture.ts draw* functions + floor-layer.ts
// All coordinates relative to (0,0) = center.

// workspace: desk ─────────────────────────────────────────────

function templateDesk(params: Record<string, unknown>, _state: string): GraphicsContext {
  const w = num(params, 'width', 50);
  const h = num(params, 'height', 28);
  const color = num(params, 'color', 0x5c4033);
  const legH = 4;
  const legW = 3;
  const topH = h - legH;

  const ctx = new GraphicsContext();
  // Desktop surface
  ctx.roundRect(-w / 2, -h / 2, w, topH, 3);
  ctx.fill(color);
  // Front legs
  ctx.rect(-w / 2 + 4, -h / 2 + topH, legW, legH);
  ctx.fill(color - 0x111111);
  ctx.rect(w / 2 - 4 - legW, -h / 2 + topH, legW, legH);
  ctx.fill(color - 0x111111);
  return ctx;
}

// workspace: monitor (state-aware) ────────────────────────────

function templateMonitor(params: Record<string, unknown>, state: string): GraphicsContext {
  const w = num(params, 'width', 22);
  const h = num(params, 'height', 18);
  const screenColor = MONITOR_SCREEN_COLORS[state] ?? 0x334155;

  const ctx = new GraphicsContext();
  // Screen bezel
  ctx.roundRect(-w / 2, -h / 2, w, h - 4, 2);
  ctx.fill(0x1e293b);
  // Screen content — color varies by state
  ctx.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 8, 1);
  ctx.fill(screenColor);
  // Stand
  ctx.rect(-3, h / 2 - 4, 6, 3);
  ctx.fill(0x64748b);
  // Base
  ctx.rect(-6, h / 2 - 1, 12, 2);
  ctx.fill(0x64748b);
  return ctx;
}

// workspace: chair ────────────────────────────────────────────

function templateChair(params: Record<string, unknown>, _state: string): GraphicsContext {
  const w = num(params, 'width', 20);
  const h = num(params, 'height', 22);
  const color = num(params, 'color', 0x2d3748);

  const ctx = new GraphicsContext();
  // Seat
  ctx.roundRect(-w / 2, 0, w, h / 3, 3);
  ctx.fill(color);
  // Backrest
  ctx.roundRect(-w / 2 + 2, -h / 2, w - 4, h / 2, 4);
  ctx.fill(color);
  // Base/wheels
  ctx.rect(-w / 4, h / 3, w / 2, 2);
  ctx.fill(0x4a5568);
  return ctx;
}

// compute: server-rack (state-aware) ──────────────────────────

function templateServerRack(params: Record<string, unknown>, state: string): GraphicsContext {
  const w = num(params, 'width', 20);
  const h = num(params, 'height', 36);
  const color = num(params, 'color', 0x2a2a3a);
  const ledColor = SERVER_LED_COLORS[state] ?? 0x22c55e;

  const ctx = new GraphicsContext();
  // Cabinet body
  ctx.roundRect(-w / 2, -h / 2, w, h, 2);
  ctx.fill(color);
  // Front panel bezel
  ctx.roundRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 1);
  ctx.fill(0x1a1a2e);
  // Rack unit slots + LEDs
  const unitCount = 5;
  const unitGap = (h - 8) / (unitCount + 1);
  for (let i = 1; i <= unitCount; i++) {
    const uy = -h / 2 + 4 + unitGap * i;
    ctx.rect(-w / 2 + 3, uy, w - 6, 1);
    ctx.fill(0x333355);
    // LED — color varies by state
    ctx.circle(w / 2 - 5, uy - unitGap / 2, 1.5);
    ctx.fill(ledColor);
  }
  // Ventilation grille
  for (let i = 0; i < 3; i++) {
    ctx.rect(-w / 2 + 4 + i * 5, h / 2 - 6, 3, 3);
    ctx.fill(0x333355);
  }
  return ctx;
}

// knowledge: bookshelf (state-aware) ──────────────────────────

function templateBookshelf(params: Record<string, unknown>, state: string): GraphicsContext {
  const w = num(params, 'width', 30);
  const h = num(params, 'height', 40);
  const glowColor = BOOK_GLOW_COLORS[state] ?? 0x8b6914;

  const ctx = new GraphicsContext();
  // Frame — glow tint varies by state
  ctx.roundRect(-w / 2, -h / 2, w, h, 2);
  ctx.fill(glowColor);
  // Shelves
  const shelfCount = 3;
  const shelfGap = (h - 4) / (shelfCount + 1);
  for (let i = 1; i <= shelfCount; i++) {
    const sy = -h / 2 + 2 + shelfGap * i;
    ctx.rect(-w / 2 + 2, sy, w - 4, 2);
    ctx.fill(0x7a5c12);
  }
  // Book spines
  const bookColors = [0x3b82f6, 0xef4444, 0x10b981, 0xf59e0b, 0x8b5cf6, 0xec4899];
  for (let shelf = 0; shelf < shelfCount; shelf++) {
    const sy = -h / 2 + 4 + shelfGap * shelf;
    const bookW = 4;
    const bookH = shelfGap - 4;
    const booksPerShelf = Math.floor((w - 8) / (bookW + 1));
    for (let b = 0; b < booksPerShelf; b++) {
      const bx = -w / 2 + 4 + b * (bookW + 1);
      ctx.rect(bx, sy, bookW, bookH);
      ctx.fill(bookColors[(shelf * booksPerShelf + b) % bookColors.length]);
    }
  }
  return ctx;
}

// collaboration: meeting-table ────────────────────────────────

function templateMeetingTable(params: Record<string, unknown>, _state: string): GraphicsContext {
  const w = num(params, 'width', 100);
  const h = num(params, 'height', 60);
  const color = num(params, 'color', 0x4a3728);

  const ctx = new GraphicsContext();
  ctx.roundRect(-w / 2, -h / 2, w, h, 8);
  ctx.fill(color);
  return ctx;
}

// collaboration: sofa ─────────────────────────────────────────

function templateSofa(params: Record<string, unknown>, _state: string): GraphicsContext {
  const w = num(params, 'width', 44);
  const h = num(params, 'height', 22);
  const color = num(params, 'color', 0x6b21a8);

  const ctx = new GraphicsContext();
  // Seat
  ctx.roundRect(-w / 2, 0, w, h / 2, 4);
  ctx.fill(color);
  // Backrest
  ctx.roundRect(-w / 2, -h / 2, w, h / 2 + 2, 6);
  ctx.fill(color);
  // Armrests
  ctx.roundRect(-w / 2 - 4, -h / 4, 6, h / 2 + h / 4, 4);
  ctx.fill(color - 0x100010);
  ctx.roundRect(w / 2 - 2, -h / 4, 6, h / 2 + h / 4, 4);
  ctx.fill(color - 0x100010);
  return ctx;
}

// infrastructure: network-switch ──────────────────────────────

function templateNetworkSwitch(params: Record<string, unknown>, _state: string): GraphicsContext {
  const w = num(params, 'width', 30);
  const h = num(params, 'height', 12);

  const ctx = new GraphicsContext();
  // Body
  ctx.roundRect(-w / 2, -h / 2, w, h, 2);
  ctx.fill(0x1a1a2e);
  // Port LEDs (row of small dots)
  for (let i = 0; i < 3; i++) {
    ctx.circle(-w / 2 + 8 + i * 9, 0, 2);
    ctx.fill(i === 2 ? 0xfbbf24 : 0x22c55e);
  }
  return ctx;
}

// infrastructure: cable-tray ──────────────────────────────────

function templateCableTray(params: Record<string, unknown>, _state: string): GraphicsContext {
  const w = num(params, 'width', 80);
  const h = num(params, 'height', 6);

  const ctx = new GraphicsContext();
  ctx.roundRect(-w / 2, -h / 2, w, h, 2);
  ctx.fill({ color: 0x3b3b55, alpha: 0.6 });
  return ctx;
}

// decorative: plant ───────────────────────────────────────────

function templatePlant(params: Record<string, unknown>, _state: string): GraphicsContext {
  const w = num(params, 'width', 14);
  const h = num(params, 'height', 22);
  const potW = w * 0.7;
  const potH = h * 0.35;

  const ctx = new GraphicsContext();
  // Pot
  ctx.roundRect(-potW / 2, h / 2 - potH, potW, potH, 2);
  ctx.fill(0xb45309);
  // Pot rim
  ctx.rect(-potW / 2 - 1, h / 2 - potH, potW + 2, 3);
  ctx.fill(0x92400e);
  // Leaves
  ctx.ellipse(0, -h / 6, w * 0.3, h * 0.35);
  ctx.fill(0x16a34a);
  ctx.ellipse(-w * 0.25, -h / 8, w * 0.25, h * 0.28);
  ctx.fill(0x15803d);
  ctx.ellipse(w * 0.25, -h / 8, w * 0.25, h * 0.28);
  ctx.fill(0x15803d);
  return ctx;
}

// decorative: coffee-table ────────────────────────────────────

function templateCoffeeTable(params: Record<string, unknown>, _state: string): GraphicsContext {
  const w = num(params, 'width', 24);
  const h = num(params, 'height', 16);
  const color = num(params, 'color', 0x78350f);

  const ctx = new GraphicsContext();
  ctx.roundRect(-w / 2, -h / 2, w, h, 6);
  ctx.fill(color);
  // Cup mark
  ctx.circle(4, 0, 3);
  ctx.fill(color + 0x111111);
  return ctx;
}

// decorative: vending-machine ─────────────────────────────────

function templateVendingMachine(params: Record<string, unknown>, _state: string): GraphicsContext {
  const w = num(params, 'width', 18);
  const h = num(params, 'height', 32);

  const ctx = new GraphicsContext();
  // Body
  ctx.roundRect(-w / 2, -h / 2, w, h, 3);
  ctx.fill(0x374151);
  // Display window
  ctx.roundRect(-w / 2 + 3, -h / 2 + 3, w - 6, h * 0.5, 2);
  ctx.fill(0x60a5fa);
  // Dispenser slot
  ctx.rect(-w / 2 + 4, h / 2 - 8, w - 8, 5);
  ctx.fill(0x1f2937);
  return ctx;
}

// decorative: reading-table ───────────────────────────────────

function templateReadingTable(params: Record<string, unknown>, _state: string): GraphicsContext {
  const w = num(params, 'width', 36);
  const h = num(params, 'height', 20);
  const color = num(params, 'color', 0x6b5b3a);

  const ctx = new GraphicsContext();
  ctx.roundRect(-w / 2, -h / 2, w, h, 4);
  ctx.fill(color);
  // Open book
  ctx.rect(-6, -3, 12, 6);
  ctx.fill(0xfef3c7);
  ctx.rect(-6, -3, 6, 6);
  ctx.fill(0xfde68a);
  return ctx;
}

// ── Registration ────────────────────────────────────────────────

/** All built-in template entries: [name, fn] */
const BUILT_IN_TEMPLATES: ReadonlyArray<[string, RenderTemplateFn]> = [
  // workspace
  ['desk', templateDesk],
  ['monitor', templateMonitor],
  ['chair', templateChair],
  // compute
  ['server-rack', templateServerRack],
  // knowledge
  ['bookshelf', templateBookshelf],
  // collaboration
  ['meeting-table', templateMeetingTable],
  ['sofa', templateSofa],
  // infrastructure
  ['network-switch', templateNetworkSwitch],
  ['cable-tray', templateCableTray],
  // decorative
  ['plant', templatePlant],
  ['coffee-table', templateCoffeeTable],
  ['vending-machine', templateVendingMachine],
  ['reading-table', templateReadingTable],
];

/** Register all built-in templates. Called once at module load. */
function registerBuiltIns(): void {
  for (const [name, fn] of BUILT_IN_TEMPLATES) {
    registerTemplate(name, fn);
  }
}

registerBuiltIns();
