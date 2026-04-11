# Zone ID Format Unification — 2026-04-11

Follow-up plan from the 2026-04-11 simplify review of commit `60ab0ab`
(B3 ship-blocker fix). The B3 fix distributed `matchZoneId` across 6
StudioState mutators to tolerate zone IDs drifting between
`companyId::slug` (DB format) and bare `slug` (template-mode). Functional,
but violates `feedback_prelaunch_drop_dirty_data` — normalize-on-load as a
distributed shim. The fix should happen at the ingestion boundary, and the
same `===` bug lives in 6 other places that the sprint didn't touch.

## Why this matters now

1. **6 untouched call sites do strict `zone.zoneId === zoneId` comparison.**
   They will silently miss zones under the same drift, surfacing as "furniture
   doesn't follow zone" / "employee walks to wrong zone" / "drag-end can't
   resolve target zone" class bugs, identical to B3. Current scene paths
   happen not to hit drift, but any new zone-creation path is a ticking bomb.

2. **The distributed `matchZoneId` is pre-launch technical debt.** Once we
   launch with real users, the saved data format is frozen and fixing the
   drift source becomes a migration problem instead of a delete problem.
   Fixing pre-launch is cheap. Fixing post-launch requires a data migration.

3. **The root cause is known and small** (see Investigation below). This is
   not an open-ended hunt.

## Investigation result (done)

**Root cause: `StudioPage.tsx:243,277` pass `''` (empty) as companyId to
`templateToZone`.** The guard in `zone-templates.ts:217-220` returns a bare
`t.slug` when companyId is empty, bypassing `normalizeZoneId`. When StudioState
later absorbs zones from DB (prefixed) and instances still hold bare-slug
references from the earlier template-mode, the two formats coexist in the
same store.

Source map:

| File:line | Call | zoneId format produced |
|---|---|---|
| `StudioPage.tsx:243` | `templateToZone(t, '')` — repos not yet available | **bare slug** ❌ |
| `StudioPage.tsx:258-261` | `zoneRows.map(hydrateZone)` or `templateToZone(t, companyId)` | prefixed ✅ |
| `StudioPage.tsx:277` | `templateToZone(t, '')` — blank create mode | **bare slug** ❌ |
| `useCompanyZones.ts:36` | `hydrateZone(row)` from DB | prefixed ✅ |
| `useCompanyZones.ts:40` | `templateToZone(t, activeCompanyId)` | prefixed ✅ |
| `useOfficeEditor.ts:169` | `loadZonesFromDb(dbZones)` from DB | prefixed ✅ |

The 2 bad call sites in StudioPage are both fallback branches for when there
is no runtime context yet (no repos, no company). These branches populate the
store with bare-slug zones; then the effect re-runs on `[companyId, repos]`
dep change and replaces the store — **but only the zones**, not the instances
the user may have already placed during the fallback window. Those instances
retain bare-slug zoneId references.

**Smoking gun**: `StudioPage.tsx:243-247` loads bare-slug zones + empty
instances. If the user never creates anything in fallback mode, no drift.
But if the effect re-fires with real repos and the user had created instances
in fallback mode, those instances carry a dangling bare-slug zoneId. The
re-fire at L258 replaces zones with prefixed format → drift.

The 6 other strict-equal call sites in rendering paths
(`Office3DView`, `Office2DView`, `office3d-shared`, `scene-nav`,
`useSceneOrchestrator`, and one residual inside `StudioState:273`) are
vulnerable to **any** producer that emits the wrong format, not just the
Studio preview-mode fallback.

## Approach

Two-track fix. Track A is the honest pre-launch fix — drop the dirty data
source entirely. Track B is the belt-and-braces defense for the rendering
layer.

## Tech Stack

- TypeScript strict mode, no new dependencies.
- Run `pnpm --filter @offisim/shared-types build` before
  `pnpm --filter @offisim/ui-office typecheck` after touching shared-types.

---

## Track A — Kill the drift source (critical)

### Task A.1: Delete the bare-slug fallback in StudioPage

- [ ] `StudioPage.tsx:243-247`: Replace the `if (!repos)` branch. Studio
      should not render usable state until runtime is ready. If repos isn't
      available yet, show a loading spinner and return early — do not
      populate the store with a format that will later drift.
- [ ] `StudioPage.tsx:277`: Same for "truly blank create mode". If there is
      no `companyId`, Studio is in a bad state — it needs a real company to
      resolve runtime. Either show a "pick a company first" gate or generate
      a stable placeholder companyId (e.g. `studio-preview`) and pass THAT
      to `templateToZone` so the format stays consistent.
- [ ] Decision: show a gate (preferred — honest about the precondition) OR
      use `'studio-preview'` sentinel companyId. Pick the gate unless the
      preview mode is load-bearing for the wizard.

### Task A.2: Drop the empty-companyId guard in templateToZone

- [ ] `zone-templates.ts:217-220`: Once StudioPage stops passing `''`,
      the guard becomes dead. Remove the ternary, let `normalizeZoneId`
      handle it uniformly. If anyone ever passes `''` again, the resulting
      `::slug` zoneId will fail `extractZoneSlug` round-trip and surface
      the bug instead of silently producing bare slugs.
- [ ] Update the JSDoc to say the companyId parameter is required.
- [ ] Grep the monorepo for other `templateToZone(..., '')` callers
      (there should be none after A.1, but verify).

### Task A.3: Remove the distributed `matchZoneId` in StudioState

- [ ] Once Tracks A.1 and A.2 land, every zone in StudioState is prefixed.
      The `matchZoneId(targetId)` closure is no longer needed.
- [ ] Replace the 6 mutator call sites with direct `z.zoneId === zoneId`:
      `updateZonePosition` (:295-302), `updateZoneSize` (:318-326),
      `rotateZone` (:428-441), `removeZone` (:444-454),
      `swapZoneVariant` (:462-480), `updateZoneLabel` (:494-504).
- [ ] Delete the `matchZoneId` helper (`StudioState.tsx:17-26`) and the
      unused `extractZoneSlug` import.
- [ ] Keep the change-detection early returns (`if (zone.cx === newCx ...`)
      — those are separate, valid perf guards.

### Task A.4: Verify no data drift remains

- [ ] Test: start dev server, open Studio, switch company, move a zone,
      rename a zone, rotate a zone, save, reload. Reopen the company —
      positions/labels/rotations should persist. This was the original B3
      symptom.
- [ ] Test: Studio fallback path. With Task A.1 in place, trying to open
      Studio without a company should show the gate, not a broken editor.
- [ ] Run `pnpm --filter @offisim/ui-office test` — the existing
      `zone-persistence.test.ts` should still pass.

---

## Track B — Fix the 6 strict-equal rendering call sites

Track A closes the known drift source. Track B hardens the render layer
against any future producer that might emit the wrong format.

### Task B.1: Add `zoneIdsEqual` to shared-types

- [ ] `packages/shared-types/src/zone-resolution.ts`: add
      ```ts
      export function zoneIdsEqual(a: string, b: string): boolean {
        return a === b || extractZoneSlug(a) === extractZoneSlug(b);
      }
      ```
- [ ] Export from `packages/shared-types/src/index.ts`.
- [ ] `pnpm --filter @offisim/shared-types build`.

**Decision point**: if Track A lands cleanly and all zone producers are
verified prefix-emitting, `zoneIdsEqual` becomes paranoia-defense — only
triggered if a future bug re-introduces drift. That's fine; it's 3 lines
and catches the bug class cheaply. If you prefer to keep strict `===`
everywhere and rely on Track A alone, skip B entirely.

### Task B.2: Migrate the 6 call sites to `zoneIdsEqual`

- [ ] `Office3DView.tsx:221` — `zones.find((z) => zoneIdsEqual(z.zoneId, zoneId))`
- [ ] `Office2DView.tsx:613` — same
- [ ] `office3d-shared.ts:156` — same
- [ ] `useSceneOrchestrator.ts:80` — same
- [ ] `scene-nav.ts:156` — same
- [ ] `StudioState.tsx:273` (`updateZoneId` instance map lookup) — same
- [ ] Grep for any additional `zone.zoneId === zoneId` / `.zoneId === zoneId`
      patterns that this list may have missed.

### Task B.3: Verify

- [ ] Typecheck clean across ui-office.
- [ ] Scene smoke — open Office workspace, dispatch a task, watch an
      employee walk to their target zone. All 6 call sites are hit during
      normal ceremony orchestration, so a broken migration surfaces fast.

---

## Out of Scope

- Migrating existing saved data. There is no saved data yet — pre-launch.
  If Track A lands cleanly, in-memory state is the only concern, and that
  resets on every page load.
- A shared-types `Zone` type refactor to a branded type like
  `ZoneId = string & { __zoneId: true }`. Nice long-term but not the fix
  the B3 class bug needs.
- Fixing the 6 strict-equal call sites by promoting `matchZoneId` from
  StudioState into shared-types. Track B does this more properly with
  `zoneIdsEqual` living next to `normalizeZoneId` / `extractZoneSlug`.

## Verification gate

- [ ] Track A.1-A.4 all complete OR Track A.1 complete with an explicit
      gate-decision recorded.
- [ ] If Track B skipped, a one-line note in the final commit explaining
      why.
- [ ] `pnpm --filter @offisim/ui-office typecheck` clean.
- [ ] `pnpm --filter @offisim/ui-office test` all pass, including
      `zone-persistence.test.ts`.
- [ ] Manual smoke: Studio zone move / rename / rotate persists across
      reload on a real company.
- [ ] MEMORY.md Open Issues entry removed once Track A is done.

## Notes

The `feedback_prelaunch_drop_dirty_data` rule applies. We are pre-launch.
The right move is Track A — delete the drift source, not tolerate the
dirty data. Track B is optional hardening, not a substitute.
