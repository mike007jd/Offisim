# Track 1 — Known Visual Bugs Fix Plan

> Parent: `Docs/superpowers/specs/2026-04-11-ship-readiness-spec.md`
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the three user-visible bugs documented in `memory/project_ui_ux_remaining_issues.md`. These are small, isolated fixes intentionally batched first so subsequent ship-readiness tracks happen on a noise-free baseline.

**Architecture:** Each bug is a localized correction with a unit/integration test that reproduces the failure first. No refactors. No structural changes. If a bug turns out to need a refactor, escalate by writing a separate plan instead of expanding this one.

**Tech Stack:** TypeScript, Vitest, React (jsdom), Three.js (math only — no rendering in tests).

---

## Bug Inventory

| ID | Symptom | Suspected Location | Fix Class |
|----|---------|--------------------|-----------|
| B1 | Employees stand inside REST area furniture (clipping) | `seat-registry.ts:55-78` `ensureOutsideFootprint` + multi-furniture awareness | Logic + test |
| B2 | Right sidebar Chat/Tasks tabs are obscured at top | Parent layout container around `RightSidebar` in office shell | CSS/layout + test |
| B3 | Studio furniture does not follow when its zone moves | `StudioState.tsx:277-300` `updateZonePosition` zoneId format mismatch | Data normalization + test |

---

## Chunk 1: B1 — Employee Clipping Into REST Furniture

### Task 1.1: Reproduce with a failing unit test

**Files:**
- Modify: `packages/ui-office/src/__tests__/unit/seat-registry.test.ts` (or create if missing — verify first)

**Steps:**

- [ ] Read existing seat-registry tests to find or create the file
- [ ] Add a test `'rest seat is pushed outside multi-furniture footprint'` that:
  - Builds a `rest` zone with two `meeting_table` instances placed close together
  - Calls the seat-registry resolver for an employee in that zone
  - Asserts every returned seat position is **outside every furniture footprint** (not just its own anchor's footprint)
- [ ] Add a second test `'rest seat respects SEAT_CLEARANCE on all furniture'` covering single furniture case where the anchor is inside the footprint AABB
- [ ] Verify both tests **fail** before proceeding to Task 1.2

### Task 1.2: Fix the failing tests

**Files:**
- Modify: `packages/ui-office/src/lib/seat-registry.ts`

**Steps:**

- [ ] In `buildAnchoredSeats`, after `pushSeat`, run an additional pass: for each seat, check `isBlockedByFootprint(seat.position[0], seat.position[2], allOtherFootprints)` against **other** furniture in the same zone. If blocked, fall back to `buildRestFallbackSeats` for that slot.
- [ ] Verify `ensureOutsideFootprint` correctness: when `dx === 0 && dz === 0`, current code uses `Math.sign(0) = 0` which makes the push direction degenerate. Add explicit handling to push in `facing` direction.
- [ ] Run `pnpm --filter @offisim/ui-office test seat-registry` — both new tests must pass
- [ ] Run `pnpm --filter @offisim/ui-office test` — full suite still green

### Task 1.3: Browser verification

**Steps:**

- [ ] `pnpm dev` (web)
- [ ] Create a company with the default template, navigate to Office workspace
- [ ] Trigger ceremony idle → workers go to rest area
- [ ] Visual: no employee inside or on top of any furniture in the REST zone
- [ ] If still clipping, add the failing case to Task 1.1 tests and re-run

---

## Chunk 2: B2 — Right Sidebar Chat/Tasks Tab Top Obscured

### Task 2.1: Locate the parent container

**Files (read-only investigation):**
- Read: `packages/ui-office/src/components/layout/RightSidebar.tsx`
- Read: `packages/ui-office/src/components/office/OfficeWorkspaceShell.tsx`
- Read: `apps/web/src/components/office-shell/CollaborationRail.tsx`

**Steps:**

- [ ] Trace where `RightSidebar` is rendered. Find the parent's grid/flex container, padding, overflow, transform, and any sibling that could overlap.
- [ ] Open the page in browser DevTools, inspect the top of RightSidebar, identify which ancestor element causes the overflow/clipping (z-index conflict, negative margin, fixed-positioned sibling, header overlap).
- [ ] Document findings inline in this plan as a comment before proceeding to fix.

### Task 2.2: Apply minimal correction

**Files:**
- Modify: whichever parent file actually causes the problem (likely `OfficeWorkspaceShell.tsx` or `CollaborationRail.tsx`)

**Steps:**

- [ ] Make the smallest possible CSS/layout change that fixes the overlap. Avoid restructuring the layout.
- [ ] If the fix requires more than a 5-line change, **stop** and write a separate plan — that means it is not a bug, it is a layout debt.

### Task 2.3: Regression test

**Files:**
- Modify: `packages/ui-office/src/__tests__/unit/RightSidebar.test.tsx`

**Steps:**

- [ ] Add a render test that mounts `OfficeWorkspaceShell` (or its closest mountable ancestor of RightSidebar) in jsdom and asserts the RightSidebar tab list element's `getBoundingClientRect().top` is `>= 0` and not visually clipped by an ancestor with `overflow: hidden`. (jsdom limits — measure via `getComputedStyle` of the parent's `padding-top` if direct measurement is not reliable.)
- [ ] Run the test, verify it passes after the fix and would have failed before.

### Task 2.4: Browser verification

**Steps:**

- [ ] `pnpm dev`, navigate to Office workspace
- [ ] Visual: Chat and Tasks tab labels are fully visible at the top of the right sidebar, no clipping
- [ ] Resize window to narrow viewport (≤1024px), tab labels still visible

---

## Chunk 3: B3 — Studio Furniture Does Not Follow Zone Move

### Task 3.1: Reproduce with a failing test

**Files:**
- Read first: `packages/ui-office/src/__tests__/unit/zone-persistence.test.ts` (already has an `updateZonePosition` test that passes — so the bug is data-format-dependent, not logic)
- Modify: `packages/ui-office/src/__tests__/unit/zone-persistence.test.ts`

**Steps:**

- [ ] Read the existing test at line ~96 to understand current coverage
- [ ] Add a new test `'updateZonePosition handles companyId-prefixed zoneId from DB'` that:
  - Sets up zones with `zoneId = 'company-abc::workspace-1'` (DB format)
  - Sets up instances with the same `zoneId = 'company-abc::workspace-1'` 
  - Calls `updateZonePosition('company-abc::workspace-1', 5, 7)`
  - Asserts both the zone AND the instances are moved by the dx/dz delta
- [ ] Add a second test `'updateZonePosition handles slug-only zoneId from local state'`:
  - Same as above but with `zoneId = 'workspace-1'`
  - Asserts the same outcome
- [ ] Add a third test `'updateZonePosition does not lose instances when DB load uses normalized zoneId but state uses slug'`:
  - This is the suspected real failure mode: zones loaded from DB have `'company-abc::workspace-1'`, instances loaded from DB have `'workspace-1'`, calls to `updateZonePosition` with one of them silently misses the other.
- [ ] Verify which of these fail to identify the root cause

### Task 3.2: Fix the format mismatch

**Files (likely candidates — investigate which is the actual leak):**
- `packages/ui-office/src/components/studio/StudioState.tsx` — `updateZonePosition`, `loadZonesFromDb`
- `packages/ui-office/src/lib/studio-persistence.ts` (if exists)
- Anywhere zones / instances are loaded from `studioRepo` / `prefabRepo`

**Steps:**

- [ ] Find where zones and instances are loaded into the store. Verify zoneId format on both sides.
- [ ] Pick **one canonical format** for in-memory state. Recommended: slug-only (without companyId prefix) since `companyId` is implicit per studio session.
- [ ] At the load boundary, normalize: strip `companyId::` prefix when reading from DB.
- [ ] At the save boundary, re-add the prefix using `templateToZone` / `normalizeZoneId`.
- [ ] Re-run Task 3.1 tests, all should pass.

### Task 3.3: Browser verification

**Steps:**

- [ ] `pnpm dev`, open Studio editor
- [ ] Place a few prefabs in a zone, save, reload
- [ ] Drag the zone to a new position
- [ ] Visual: all instances move with the zone, no orphans
- [ ] Save, reload, repeat the drag — instances must still follow

---

## Verification Gate (entire track)

Before marking this plan complete:

- [ ] `pnpm --filter @offisim/ui-office test` — full ui-office suite green
- [ ] `pnpm test` — full repo suite green
- [ ] `pnpm typecheck` — clean
- [ ] `pnpm lint` — clean
- [ ] All three browser verification steps (1.3, 2.4, 3.3) pass on actual `pnpm dev`
- [ ] Update `memory/project_ui_ux_remaining_issues.md` to remove the three bugs from the "未解决" section, leaving only the workspace-page rewrite item
- [ ] Commit message references this plan: `fix(ui): close 3 known bugs (B1 clip / B2 chat tab / B3 zone move) — Track 1 of ship-readiness spec`

## Out of Scope (do not expand here)

- Workspace page rewrites (Tracks 4 & 5)
- Studio / Office Editor unification (deferred)
- Repository deduplication (Track 6)
- Any new feature
- Any "while we're at it" cleanup of unrelated code
