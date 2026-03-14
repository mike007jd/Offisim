# Phase 7B: Pixel Scene Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace the generic circle+rectangle office scene with distinctive pixel art — procedural lobster characters, tilemap floor, pixel furniture, and frame-based animation. The result is the visual identity of AICS.

**Architecture:** Pixel art is drawn via PixiJS `Graphics.rect()` calls with a pixel scale factor (`PX = 3` → each logical pixel = 3×3 screen pixels). Lobster shapes defined as 2D color grids. Body parts as separate Graphics for independent animation. Floor uses repeating 16×16 tile patterns. All existing event handling and state machine logic is preserved — only visual representation changes.

**Tech Stack:** PixiJS 8 Graphics API, GSAP 3, existing tokens + EventBus

---

## Key Design Decisions

1. **No sprites or textures** — All pixel art is procedurally drawn using `Graphics.rect()`. No external image files.
2. **Pixel scale factor `PX = 3`** — Each logical pixel = 3×3 screen pixels. A 16×16 lobster = 48×48 screen pixels (similar to current 24px radius circle avatars).
3. **Lobster as data grid** — Body shape defined as `number[][]` (color index arrays). Parameterized by hue (derived from employee ID hash).
4. **Separate body parts** — Claws, legs, and antennae are individual Graphics objects for GSAP animation without redrawing the whole body.
5. **Backward-compatible API** — `LobsterEntity` has the same public API as `EmployeeEntity` (`setState`, `setTask`, `setHighlight`, `destroy`). SceneManager requires minimal changes.
6. **Floor stays simple** — 16×16 pixel tiles drawn via Graphics, not a tilemap library. Simple enough for MVP.

---

## Dependency Graph

```
Task 1: Pixel drawing utility + pixel palette
  └─► Task 2: Lobster shape data (body, claws, legs, eyes)
        └─► Task 3: LobsterEntity class (replaces EmployeeEntity avatar)
              ├─► Task 4: Pixel floor tiles (replace FloorLayer)
              ├─► Task 5: Pixel furniture (desk + monitor)
              └─► Task 6: Lobster animation system (idle, work, think, error)
                    └─► Task 7: SceneManager integration + layout update
                          └─► Task 8: Tests + verification
```

Tasks 4-5 are independent of Task 6. All converge at Task 7.

---

## Task 1: Pixel Drawing Utility + Pixel Palette

**Files:**
- Create: `packages/renderer/src/pixel/draw-pixel-grid.ts`
- Create: `packages/renderer/src/pixel/pixel-palette.ts`
- Create: `packages/renderer/src/pixel/index.ts`

**Context:**
Core utility that turns a 2D array of color indices into Graphics.rect() calls. Shared by lobster, floor tiles, and furniture.

**`pixel-palette.ts`** — The shared pixel palette (indices → hex colors):

```typescript
/** Pixel scale: each logical pixel = PX × PX screen pixels */
export const PX = 3;

/**
 * Pixel palette — indexed colors for all pixel art.
 * Index 0 = transparent (skip).
 * Indices 1-16 are fixed palette slots.
 */
export const PIXEL_PALETTE: readonly number[] = [
  0x000000,   // 0: transparent (sentinel, not drawn)
  0x1a1c2c,   // 1: ocean-deep (darkest)
  0x333c57,   // 2: ocean-mid
  0x566c86,   // 3: ocean-light
  0x8b9bb4,   // 4: shell (light gray-blue)
  0xc0cbdc,   // 5: foam (lightest gray)
  0xf4f4f4,   // 6: sand (near-white)
  0xffffff,   // 7: pearl (white)
  0xe43b44,   // 8: lobster-red
  0xf77622,   // 9: coral-orange
  0x3e8948,   // 10: kelp-green
  0x3978a8,   // 11: sea-blue
  0x0e071b,   // 12: abyss (darkest shadow)
  0xfbbf24,   // 13: gold/warning
  0xa78bfa,   // 14: violet
  0xef4444,   // 15: error-red
  0x4ade80,   // 16: success-green
];
```

**`draw-pixel-grid.ts`** — Core draw function:

```typescript
import { Graphics } from 'pixi.js';
import { PX, PIXEL_PALETTE } from './pixel-palette.js';

/**
 * Draw a pixel art grid onto a Graphics object.
 * Each cell in `grid[row][col]` is a palette index.
 * Index 0 = transparent (skip). Any other index → draw a PX×PX rect.
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
 * Generate a hue-shifted version of the lobster red for unique employee colors.
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
  // HSL(hue, 70%, 55%) → RGB
  return hslToHex(hue, 0.7, 0.55);
}

function hslToHex(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)      { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  const ri = Math.round((r + m) * 255);
  const gi = Math.round((g + m) * 255);
  const bi = Math.round((b + m) * 255);
  return (ri << 16) | (gi << 8) | bi;
}
```

**Tests:** `packages/renderer/src/__tests__/pixel-utils.test.ts`

```
- drawPixelGrid draws correct number of rects (count non-zero cells)
- drawPixelGrid skips index 0 (transparent)
- idToHue returns consistent color for same ID
- idToHue returns different colors for different IDs
- PX constant is 3
- PIXEL_PALETTE has 17 entries
```

**Commit:** `feat(renderer): pixel drawing utility + indexed palette`

---

## Task 2: Lobster Shape Data

**Files:**
- Create: `packages/renderer/src/pixel/lobster-shapes.ts`

**Context:**
Define the lobster's body parts as 2D pixel grids (number[][]). The lobster is 16×16 logical pixels (48×48 screen pixels at PX=3). Body parts are separate grids for animation:

- **body**: 10×8 main torso + tail
- **leftClaw**: 5×4 pincer shape
- **rightClaw**: 5×4 pincer shape (mirrored)
- **eyes**: 2×2 white dots with 1×1 black pupils
- **legs**: 4 pairs of 1px lines

Use palette index 8 (lobster-red) as the main body color, with index 12 (abyss) for outlines and index 9 (coral-orange) for belly/highlights.

The shape data is plain const arrays — no logic. Export:

```typescript
export const LOBSTER_BODY: number[][];      // 12×10 grid
export const LOBSTER_CLAW_L: number[][];    // 5×5 grid
export const LOBSTER_CLAW_R: number[][];    // 5×5 grid (mirrored)
export const LOBSTER_EYES: number[][];      // 4×2 grid (both eyes)
export const LOBSTER_LEGS: number[][];      // 8×3 grid (4 pairs)
export const LOBSTER_ANTENNA_L: number[][]; // 1×3 grid
export const LOBSTER_ANTENNA_R: number[][]; // 1×3 grid

// Role accessories (optional overlay)
export const ACCESSORY_GLASSES: number[][]; // 6×2 grid
export const ACCESSORY_TIE: number[][];    // 2×4 grid
export const ACCESSORY_BERET: number[][];  // 5×3 grid
```

**Design the lobster front-facing (looking at the user):**

```
     aa        (antennae)
    ●  ●       (eyes)
  ╔══════╗     (body top)
 ∂║ ○  ○ ║∂   (claws + eye area)
  ║      ║    (body middle)
  ║ ████ ║    (belly highlight)
  ╚══════╝    (body bottom + tail)
   ││  ││     (legs)
```

Each part grid is positioned relative to the body center. The `LobsterEntity` (Task 3) places them at the correct offsets.

**Tests:** `packages/renderer/src/__tests__/lobster-shapes.test.ts`

```
- LOBSTER_BODY has expected dimensions (12 rows × 10 cols)
- All grids use valid palette indices (0-16)
- Claw grids are mirror images of each other
- No empty grids (at least some non-zero pixels)
```

**Commit:** `feat(renderer): lobster pixel shape data — body, claws, legs, eyes, accessories`

---

## Task 3: LobsterEntity Class

**Files:**
- Create: `packages/renderer/src/entities/lobster-entity.ts`
- Modify: `packages/renderer/src/entities/employee-entity.ts` (keep but mark as legacy)

**Context:**
`LobsterEntity` replaces `EmployeeEntity` as the visual representation of an employee. It has the **same public API** so SceneManager integration is minimal (Task 7).

**Structure:**

```typescript
export class LobsterEntity {
  readonly container: Container;
  readonly id: string;

  // Visual parts (separate Graphics for animation)
  private bodyGfx: Graphics;       // torso + tail
  private clawL: Graphics;         // left claw (rotates for animation)
  private clawR: Graphics;         // right claw (mirrored)
  private legsGfx: Graphics;       // 4 leg pairs
  private eyesGfx: Graphics;       // eyes with pupils
  private antennaL: Graphics;      // left antenna
  private antennaR: Graphics;      // right antenna
  private accessory: Graphics | null; // role accessory overlay

  // Existing from EmployeeEntity (preserved)
  private stateRing: Graphics;     // colored ring/glow under the lobster
  private label: Text;             // name label below
  private taskBubble: Container;   // task/tool overlay
  private taskText: Text;
  private taskBubbleBg: Graphics | null;

  // Animation state (preserved from EmployeeEntity)
  private state: EmployeeState;
  private highlighted: boolean;
  private pulseTween: gsap.core.Tween | null;
  private activeTweens: gsap.core.Tween[];
  private motion: Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>;

  // Color
  private readonly bodyColor: number;  // from idToHue(id)

  constructor(id: string, name: string, motion: MotionTokens)
  setState(next: EmployeeState): void    // same API as EmployeeEntity
  setTask(taskId: string | null): void   // same API
  setHighlight(on: boolean): void        // same API
  destroy(): void                         // same API

  // New: redraw body with custom color palette
  private drawBody(): void
  private drawClaws(): void
  private drawEyes(): void
  private drawLegs(): void
  private drawStateRing(color: number): void
}
```

**Constructor flow:**
1. Create Container
2. Derive bodyColor from `idToHue(id)` — each employee gets a unique lobster color
3. Create stateRing (pixel square border instead of circle ring)
4. Draw body parts using `drawPixelGrid()` with custom palette where index 8 → bodyColor
5. Create label + taskBubble (same as EmployeeEntity, but with pixel font style)

**State ring:** Instead of a circle ring, use a pixel-art square outline (2px border) that changes color with state. This gives the pixel aesthetic.

**Key differences from EmployeeEntity:**
- No circle avatar — replaced by lobster pixel art
- No initial letter — the lobster IS the avatar
- State ring is a square pixel border, not a circle
- Body color varies per employee (hue-shifted lobster-red)
- Label uses `fontFamily: 'Pixelify Sans'` instead of system-ui

**Tests:** `packages/renderer/src/__tests__/lobster-entity.test.ts`

```
- constructor creates container with expected children
- setState changes state ring color
- setState triggers animation (GSAP calls)
- setHighlight scales container
- setTask shows/hides task bubble
- destroy kills all tweens
- different IDs produce different body colors
```

**Commit:** `feat(renderer): LobsterEntity — procedural pixel lobster employee avatar`

---

## Task 4: Pixel Floor Tiles

**Files:**
- Create: `packages/renderer/src/pixel/floor-tiles.ts`
- Modify: `packages/renderer/src/layers/floor-layer.ts`

**Context:**
Replace the single roundRect floor with a tilemap-style pixel floor using 16×16 tiles.

**`floor-tiles.ts`** — Tile pattern data:

```typescript
// Two alternating tile patterns for a checkerboard floor
export const FLOOR_TILE_A: number[][]; // 16×16 grid (ocean-deep base + subtle pattern)
export const FLOOR_TILE_B: number[][]; // 16×16 grid (slightly different shade)
export const FLOOR_TILE_BORDER: number[][]; // Edge tile with wall indication
```

**FloorLayer changes:**
- `drawFloor()` → loops through grid positions, alternates tile A/B in checkerboard
- Floor size stays 800×500 but now divided into 16×PX = 48px tiles
- Grid: ~17×11 tiles
- Keep `getDeskPositions()` — desk positions don't change
- Remove `cornerRadius` (pixel art = sharp corners)

**`drawDesks()` stays but uses pixel style:**
- Replace roundRect with pixel-art desk (defined in Task 5)
- For now, draw simple pixel rectangles (no cornerRadius)

**Tests:** Update existing floor tests if they check roundRect shapes.

**Commit:** `feat(renderer): pixel tilemap floor — 16×16 tile checkerboard`

---

## Task 5: Pixel Furniture

**Files:**
- Create: `packages/renderer/src/pixel/furniture-shapes.ts`
- Modify: `packages/renderer/src/layers/floor-layer.ts` (use new furniture shapes)

**Context:**
Define pixel art shapes for office furniture. Each piece is a small pixel grid drawn via `drawPixelGrid()`.

**Furniture shapes:**

```typescript
// Desk: 20×10 pixel grid (60×30 screen pixels at PX=3)
export const PIXEL_DESK: number[][];
// Monitor on desk: 8×6 pixel grid with screen glow
export const PIXEL_MONITOR: number[][];
// Chair: 6×8 pixel grid
export const PIXEL_CHAIR: number[][];
```

**FloorLayer integration:**
- Each desk position gets: desk + monitor on top + chair in front
- Desk is drawn as a flat surface with darker legs
- Monitor has a screen (sea-blue glow) on a stand
- Chair is a simple pixel shape

**Tests:** Verify furniture grids have expected dimensions, use valid palette indices.

**Commit:** `feat(renderer): pixel furniture — desk, monitor, chair procedural shapes`

---

## Task 6: Lobster Animation System

**Files:**
- Create: `packages/renderer/src/entities/lobster-animations.ts`
- Modify: `packages/renderer/src/entities/lobster-entity.ts` (wire animations)

**Context:**
Define GSAP-based animations for lobster body parts. Each animation is a factory function returning a GSAP timeline or tween.

**Animation types:**

1. **Idle bob** (continuous) — body bobs up/down 1 logical pixel (3 screen pixels)
   ```typescript
   gsap.to(bodyContainer, { y: '-=3', duration: M1.duration, ease: 'sine.inOut', yoyo: true, repeat: -1 })
   ```

2. **Claw wiggle** (continuous during active states) — claws rotate ±5°
   ```typescript
   gsap.to(clawL, { rotation: 0.08, duration: 0.4, ease: 'sine.inOut', yoyo: true, repeat: -1 })
   ```

3. **Thinking** — antennae wiggle faster, eyes look up (shift 1px)
   ```typescript
   // antenna wobble
   gsap.to(antennaL, { rotation: 0.15, duration: 0.3, yoyo: true, repeat: -1 })
   ```

4. **Error shake** — whole container shakes (reuse existing pattern from EmployeeEntity)

5. **Success pop** — scale bounce (reuse existing pattern)

6. **State transition** — ring color change with bounce (reuse existing pattern)

**`lobster-animations.ts`** — Factory functions:

```typescript
export function createIdleAnimation(body: Container, motion: MotionBucket): gsap.core.Tween
export function createClawWiggle(clawL: Graphics, clawR: Graphics, motion: MotionBucket): gsap.core.Timeline
export function createThinkingAnimation(antennaL: Graphics, antennaR: Graphics, eyes: Graphics): gsap.core.Timeline
export function createShakeAnimation(container: Container): gsap.core.Tween
export function createPopAnimation(ring: Graphics, motion: MotionBucket): gsap.core.Tween
```

**Integration with setState:**
- `idle` → idle bob only
- `thinking/searching` → idle bob + claw wiggle + thinking antenna wobble
- `executing` → idle bob + fast claw wiggle (working)
- `blocked/failed` → shake, stop other animations
- `success` → pop, then idle
- Other states → idle bob only, color change

**Tests:** `packages/renderer/src/__tests__/lobster-animations.test.ts`

```
- createIdleAnimation returns a GSAP tween with yoyo + repeat
- createClawWiggle returns a timeline
- animations respect reduced motion (duration 0)
- all factory functions accept motion tokens
```

**Commit:** `feat(renderer): lobster animation system — idle, claw wiggle, think, shake, pop`

---

## Task 7: SceneManager Integration + Layout Update

**Files:**
- Modify: `packages/renderer/src/core/scene-manager.ts`
- Modify: `packages/renderer/src/tokens/layout.ts`
- Modify: `packages/renderer/src/index.ts`

**Context:**
Wire `LobsterEntity` into SceneManager, replacing `EmployeeEntity`. Update layout constants for the pixel aesthetic.

**SceneManager changes:**
1. Import `LobsterEntity` instead of `EmployeeEntity`
2. Replace `new EmployeeEntity(...)` with `new LobsterEntity(...)` in `mount()` and `addEmployee()`
3. `employeeEntities` map type → `Map<string, LobsterEntity>`
4. No other changes needed — LobsterEntity has the same API

**Layout updates:**
```typescript
export const LAYOUT = {
  floor: {
    width: 800,
    height: 500,
    padding: 40,
    cornerRadius: 0,  // pixel art: sharp corners
  },
  desk: {
    width: 60,   // 20 logical px × PX=3
    height: 30,  // 10 logical px × PX=3
    gap: 80,     // more space for lobsters
    cornerRadius: 0,
    borderWidth: 0,  // no stroke, pixel border is part of tile
  },
  employee: {       // now a lobster
    radius: 24,     // kept for positioning compatibility
    ringWidth: 3,   // pixel border width
    fontSize: 10,
    labelOffsetY: 30,
  },
  // ... taskBubble and meetingRoom stay similar
};
```

**Index exports:**
```typescript
export { LobsterEntity } from './entities/lobster-entity.js';
export { drawPixelGrid, idToHue } from './pixel/draw-pixel-grid.js';
export { PX, PIXEL_PALETTE } from './pixel/pixel-palette.js';
```

**Keep EmployeeEntity exported** as `LegacyEmployeeEntity` for backward compatibility during transition.

**Commit:** `feat(renderer): wire LobsterEntity into SceneManager — pixel lobsters replace circles`

---

## Task 8: Tests + Full Verification

**Run all tests:**
```bash
pnpm --filter @aics/renderer test
pnpm --filter @aics/core test
pnpm --filter @aics/install-core test
pnpm turbo run typecheck
pnpm --filter @aics/web build
```

**Expected test counts:**
- renderer: 37 existing + ~20 new (pixel utils, lobster shapes, lobster entity, animations) ≈ 57+
- core: 161 (unchanged)
- install-core: 193 (unchanged)

**Verify no regressions:**
- SceneManager lifecycle tests still pass
- Event handling tests still pass
- Token tests still pass

**Commit:** `chore: Phase 7B verification and polish`

---

## File Summary

### New files (7-8):
| File | Purpose |
|------|---------|
| `src/pixel/draw-pixel-grid.ts` | Core pixel drawing utility + hue generation |
| `src/pixel/pixel-palette.ts` | Indexed color palette + PX constant |
| `src/pixel/index.ts` | Barrel export |
| `src/pixel/lobster-shapes.ts` | 2D pixel grid data for lobster body parts |
| `src/pixel/floor-tiles.ts` | 16×16 floor tile patterns |
| `src/pixel/furniture-shapes.ts` | Pixel desk, monitor, chair shapes |
| `src/entities/lobster-entity.ts` | LobsterEntity class |
| `src/entities/lobster-animations.ts` | GSAP animation factories for lobster |

### Modified files (4):
| File | Change |
|------|--------|
| `src/core/scene-manager.ts` | Use LobsterEntity instead of EmployeeEntity |
| `src/layers/floor-layer.ts` | Pixel tilemap floor + pixel furniture |
| `src/tokens/layout.ts` | Updated dimensions for pixel aesthetic |
| `src/index.ts` | Export new pixel modules + LobsterEntity |

### Preserved (not deleted):
| File | Reason |
|------|--------|
| `src/entities/employee-entity.ts` | Legacy fallback, exported as LegacyEmployeeEntity |

### All work scoped to `packages/renderer/` — no other packages modified.
