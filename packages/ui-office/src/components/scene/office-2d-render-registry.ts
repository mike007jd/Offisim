/**
 * office-2d-render-registry.ts — Maps prefab IDs and categories to canvas draw functions.
 *
 * Replaces the removed SVG prefab lookup tables with Canvas 2D API draw
 * functions that render simple silhouettes on a dark
 * background (#020617). Each draw function receives a canvas context,
 * center position, and rotation angle.
 */

// ── Type ────────────────────────────────────────────────────────────

/** Signature for a prefab canvas draw function. */
export type PrefabDrawFn = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotation: number,
) => void;

// ── Draw helpers ────────────────────────────────────────────────────

/** Apply rotation around (x, y), call `draw`, then restore. */
function withRotation(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotation: number,
  draw: () => void,
): void {
  ctx.save();
  ctx.translate(x, y);
  if (rotation !== 0) ctx.rotate((rotation * Math.PI) / 180);
  draw();
  ctx.restore();
}

// ── Draw functions ──────────────────────────────────────────────────

function drawWorkstation(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotation: number,
): void {
  withRotation(ctx, x, y, rotation, () => {
    // Desk surface
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-22, -18, 44, 36, 2);
    ctx.fill();
    ctx.stroke();

    // Inner area
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(-18, -14, 36, 28, 1);
    ctx.fill();

    // Divider lines
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(0, 18);
    ctx.moveTo(-22, 0);
    ctx.lineTo(22, 0);
    ctx.stroke();

    // Chair dots
    const chairs: [number, number][] = [
      [-10, -8],
      [10, -8],
      [-10, 8],
      [10, 8],
    ];
    for (const [cx, cy] of chairs) {
      ctx.fillStyle = '#334155';
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  });
}

function drawServerRack(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotation: number,
): void {
  withRotation(ctx, x, y, rotation, () => {
    // Rack body
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-18, -45, 36, 90, 3);
    ctx.fill();
    ctx.stroke();

    // Server units
    const rows = [-40, -29, -18, -7, 4, 15, 26, 37];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      ctx.fillStyle = '#020617';
      ctx.beginPath();
      ctx.roundRect(-14, row, 28, 9, 1);
      ctx.fill();

      // Status LED
      ctx.fillStyle = i % 3 === 0 ? '#fbbf24' : '#22c55e';
      ctx.beginPath();
      ctx.arc(10, row + 4, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawBookshelf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotation: number,
): void {
  const bookColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#a855f7', '#06b6d4'];

  withRotation(ctx, x, y, rotation, () => {
    // Shelf frame
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-25, -35, 50, 70, 3);
    ctx.fill();
    ctx.stroke();

    // Shelves and books
    for (let shelf = 0; shelf < 4; shelf++) {
      // Shelf line
      ctx.fillStyle = '#334155';
      ctx.fillRect(-23, -30 + shelf * 17, 46, 1);

      // Books
      for (let b = 0; b < 7; b++) {
        ctx.fillStyle = bookColors[(shelf * 7 + b) % bookColors.length] ?? '#64748b';
        ctx.beginPath();
        ctx.roundRect(-21 + b * 6.5, -28 + shelf * 17, 5, 14, 0.5);
        ctx.fill();
      }
    }
  });
}

function drawMeetingTable(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotation: number,
): void {
  withRotation(ctx, x, y, rotation, () => {
    // Table surface
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-100, -35, 200, 70, 20);
    ctx.fill();
    ctx.stroke();

    // Inner surface
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(-85, -25, 170, 50, 12);
    ctx.fill();

    // Chairs
    const chairPositions = [-60, -20, 20, 60];
    for (const cx of chairPositions) {
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      // Top chair
      ctx.beginPath();
      ctx.arc(cx, -55, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Bottom chair
      ctx.beginPath();
      ctx.arc(cx, 55, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  });
}

function drawSofa(ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number): void {
  withRotation(ctx, x, y, rotation, () => {
    // Seat body
    ctx.fillStyle = '#92400e';
    ctx.beginPath();
    ctx.moveTo(-50, -20);
    ctx.lineTo(50, -20);
    ctx.lineTo(50, 10);
    ctx.lineTo(30, 10);
    ctx.lineTo(30, -5);
    ctx.lineTo(-30, -5);
    ctx.lineTo(-30, 10);
    ctx.lineTo(-50, 10);
    ctx.closePath();
    ctx.fill();

    // Left armrest
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(-55, -20, 10, 30, 4);
    ctx.fill();

    // Right armrest
    ctx.beginPath();
    ctx.roundRect(45, -20, 10, 30, 4);
    ctx.fill();
  });
}

function drawPlant(ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number): void {
  withRotation(ctx, x, y, rotation, () => {
    // Pot
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 5, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Leaves
    ctx.fillStyle = '#10b981';
    for (let i = 0; i < 5; i++) {
      const angle = (i * 72 * Math.PI) / 180;
      ctx.save();
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-12, -18, 12, -18, 0, 0);
      ctx.fill();
      ctx.restore();
    }
  });
}

function drawCoffeeTable(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotation: number,
): void {
  withRotation(ctx, x, y, rotation, () => {
    // Outer circle
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner circle
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawVendingMachine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotation: number,
): void {
  withRotation(ctx, x, y, rotation, () => {
    // Machine body
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-16, -30, 32, 60, 4);
    ctx.fill();
    ctx.stroke();

    // Display window
    ctx.fillStyle = '#0ea5e9';
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.roundRect(-12, -26, 24, 25, 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Dispenser slot
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(-10, 5, 20, 8, 2);
    ctx.fill();
  });
}

function drawWhiteboard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotation: number,
): void {
  withRotation(ctx, x, y, rotation, () => {
    // Board surface
    ctx.fillStyle = '#e2e8f0';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-30, -20, 60, 40, 2);
    ctx.fill();
    ctx.stroke();

    // Text lines
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-25, -10);
    ctx.lineTo(10, -10);
    ctx.moveTo(-25, 0);
    ctx.lineTo(20, 0);
    ctx.moveTo(-25, 10);
    ctx.lineTo(5, 10);
    ctx.stroke();
  });
}

function drawGenericPrefab(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotation: number,
): void {
  withRotation(ctx, x, y, rotation, () => {
    ctx.fillStyle = 'rgba(100, 116, 139, 0.15)';
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-15, -15, 30, 30, 3);
    ctx.fill();
    ctx.stroke();
  });
}

// ── Draw function registry ──────────────────────────────────────────

const DRAW_FUNCTIONS: Record<string, PrefabDrawFn> = {
  workstation: drawWorkstation,
  'server-rack': drawServerRack,
  bookshelf: drawBookshelf,
  'meeting-table': drawMeetingTable,
  sofa: drawSofa,
  plant: drawPlant,
  'coffee-table': drawCoffeeTable,
  'vending-machine': drawVendingMachine,
  whiteboard: drawWhiteboard,
  generic: drawGenericPrefab,
};

// ── Prefab ID → draw function key (mirrors PREFAB_SVG_MAP) ─────────

const PREFAB_DRAW_MAP: Record<string, string> = {
  'workstation-standard': 'workstation',
  'workstation-compact': 'workstation',
  'workstation-dual': 'workstation',
  'server-rack-2u': 'server-rack',
  'server-rack-4u': 'server-rack',
  'gpu-cluster': 'server-rack',
  'bookshelf-single': 'bookshelf',
  'bookshelf-double': 'bookshelf',
  'filing-cabinet': 'generic',
  whiteboard: 'whiteboard',
  'meeting-table-4': 'meeting-table',
  'meeting-table-8': 'meeting-table',
  'sofa-set': 'sofa',
  'standing-table': 'coffee-table',
  'network-switch': 'generic',
  'cable-tray': 'generic',
  'patch-panel': 'generic',
  'plant-small': 'plant',
  'plant-large': 'plant',
  'coffee-table': 'coffee-table',
  'vending-machine': 'vending-machine',
  'water-cooler': 'vending-machine',
  'reading-table': 'workstation',
  'chair-standalone': 'generic',
  'status-board': 'whiteboard',
};

// ── Category → draw function key (mirrors CATEGORY_SVG) ─────────────

const CATEGORY_DRAW_MAP: Record<string, string> = {
  workspace: 'workstation',
  compute: 'server-rack',
  knowledge: 'bookshelf',
  meeting: 'meeting-table',
  rest: 'sofa',
  decorative: 'plant',
  infrastructure: 'server-rack',
};

// ── Zone archetype → prefab type for fallback furniture ─────────────

export const ARCHETYPE_FALLBACK_MAP: Record<string, string> = {
  workspace: 'workstation',
  server: 'server-rack',
  meeting: 'meeting-table',
  library: 'bookshelf',
  rest: 'sofa',
};

// ── Zone archetype → catalog category (sibling of ARCHETYPE_FALLBACK_MAP) ──

export const ARCHETYPE_CATEGORY_MAP: Record<string, string> = {
  workspace: 'workspace',
  server: 'compute',
  meeting: 'meeting',
  library: 'knowledge',
  rest: 'rest',
};

export function archetypeToCategory(archetype: string): string {
  return ARCHETYPE_CATEGORY_MAP[archetype] ?? 'workspace';
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Resolve a prefab ID + category to a canvas draw function.
 *
 * Lookup order:
 * 1. PREFAB_DRAW_MAP[prefabId] → specific draw function
 * 2. CATEGORY_DRAW_MAP[category] → category fallback
 * 3. drawGenericPrefab → final fallback
 */
export function getPrefabDrawFn(prefabId: string, category: string): PrefabDrawFn {
  if (Object.prototype.hasOwnProperty.call(PREFAB_DRAW_MAP, prefabId)) {
    const byId = PREFAB_DRAW_MAP[prefabId];
    if (byId) {
      const fn = DRAW_FUNCTIONS[byId];
      if (fn) return fn;
    }
  }

  if (Object.prototype.hasOwnProperty.call(CATEGORY_DRAW_MAP, category)) {
    const byCat = CATEGORY_DRAW_MAP[category];
    if (byCat) {
      const fn = DRAW_FUNCTIONS[byCat];
      if (fn) return fn;
    }
  }

  return drawGenericPrefab;
}
