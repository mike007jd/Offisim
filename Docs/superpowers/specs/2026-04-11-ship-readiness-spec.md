# Offisim Ship-Readiness Spec — 2026-04-11

> Top-level coordination spec for closing all fragile business surfaces before shipping.
> No new features. Convergence only. Source-cited from the 2026-04-11 5-agent code audit.
>
> **Revision (2026-04-11, later same day)**: Initial scope was wildly overestimated.
> Tracks 3 / 4 / 5 turned out to be **already implemented** when verified by reading the
> actual page files (SettingsPage, ActivityLogPage, MarketPage, SopViewSurface +
> SopDagCanvas + SopAddStepPopover + SopNodeContextMenu + `SopStep.position?` field).
> The first audit pass leaned on a stale memory entry (project_page_redesign_status, dated
> 2026-04-09) instead of reading current code — exactly the failure mode that
> `feedback_thorough_investigation.md` warns against. Lesson saved here so it does not
> happen again. Real remaining scope is now ~2-3 days, not ~3 weeks.

## Why This Spec Exists

The framework layer is solid (LangGraph kernel, ceremony orchestration, scene routing, dual
context, prefab spatial system, 6-format export, Hono platform). The user has explicitly
declared feature scope locked. What remains are **business edges that are half-built or
contradict each other**, which prevent the project from being credibly handed to alpha users.

This spec is the single source of truth for "what closing means". Each section below has a
matching child plan in `Docs/plans/2026-04-11-*.md` that is implementable task-by-task.

## Definition of "Deliverable"

Single phase: **own functionality complete and self-consistent**. Open source publication
and public platform deployment are explicitly out of scope for now — those concerns will
be revisited only after the work in this spec is finished.

Acceptance:
- `pnpm install && pnpm build` succeeds clean.
- `pnpm typecheck && pnpm lint && pnpm test` succeeds clean.
- Desktop Tauri build launches on macOS, web SPA serves on localhost.
- The 4 fullscreen workspaces (SOPs, Market, Activity Log, Settings) look intentional, not
  panel-stretched-to-fullscreen.
- SOP DAG editor allows creating, dragging, connecting, and persisting nodes.
- Marketplace browse → install employee → see employee in scene → run a task. End-to-end works.
- The 3 known visual bugs (employee clipping, chat tab obscured, studio zone move) are fixed.
- Install / publish flow is internally consistent: nothing is publishable that can't be
  installed, nothing is offered for install that doesn't actually materialize.
- Pre-commit hook runs `pnpm typecheck && pnpm lint && pnpm test` so accidental commits
  don't push broken code into the working tree.
- Repository 3-way drift is monitored by a parity test (no merge required).

Non-goals (intentional):
- GitHub Actions CI / hosted CI of any kind.
- Bundle size optimization beyond what is in the audit.
- E2E in CI (manual run is acceptable).
- Repository 3-way deduplication (parity test only).
- Channels integration (package already deleted as out-of-scope).
- Light mode (dark only, indefinitely).
- Studio / Office Editor / Company Editor consolidation.
- Platform public deployment.
- Open source publication / GitHub Release artifacts / signed binaries.
- README / CONTRIBUTING audit for external contributors.

## Scope: 7 Closure Tracks (3 of which are already done)

Each track is a child plan. Tracks are ordered by **dependency**, not difficulty.

### Track 0: Hygiene — Repo state cleanup (DONE in this spec session)
- Deleted `packages/channels` (user decision: contamination, not feature).
- Deleted 9 stale plans/specs from `Docs/plans/` and `Docs/superpowers/`.
- Deleted 15 stale memory files in `~/.claude/.../memory/`.
- Updated `MEMORY.md`, `CLAUDE.md`, `README.md` to remove channels references.
- After accepting this spec: run `pnpm install` to drop channels from `pnpm-lock.yaml`.

### Track 1: 3 known bugs
**Plan**: `Docs/plans/2026-04-11-known-bugs.md`
**Goal**: Fix the three user-visible bugs documented in
`memory/project_ui_ux_remaining_issues.md`.
**Why first**: They are small, isolated, user-visible, and fixing them first means subsequent
work happens on a less-noisy baseline.
**Estimated scope**: ~half day each, all three fit in one Plan execution session.

### Track 2: Install / Publish narrowing
**Plan**: `Docs/plans/2026-04-11-install-publish-narrowing.md`
**Goal**: Resolve the publish-vs-install contradiction by **narrowing scope**: PublishDialog
will only accept `employee`. Drop `sop` and `company_template` publish paths. Skill remains
embedded in employee config_json (no standalone skill table). Update `INSTALLABLE_KINDS` to
just `{employee}` for clarity.
**Why second**: Until this is resolved, the marketplace is misleading users about what they
can install. It also unblocks Track 5 (Market page rewrite) by locking the data contract.
**Estimated scope**: 1 day. Mostly deletion.

### ~~Track 3: SOP DAG editor V2~~ — DONE (verified 2026-04-11)
Plan `Docs/plans/2026-04-10-sop-dag-editor-v2.md` is **fully implemented**. Verified by
reading source:
- `shared-types/sop.ts:10` — `SopStep.position?: { x, y }` ✅
- `SopAddStepPopover.tsx` — full role selector + edit/add modes ✅
- `SopNodeContextMenu.tsx` — exists ✅
- `SopViewSurface.tsx` — `editMode` toggle, position bake on enter, `handleMoveStep`,
  `handleAutoLayout`, double-click add/edit, context menu, duplicate, delete ✅
- `SopDagCanvas.tsx` — ref-based interaction mode, node drag with offset preview,
  pointer capture, click guard, port drag connecting, ESC cancel, accessibility ✅

Recommended action: delete `Docs/plans/2026-04-10-sop-dag-editor-v2.md` after final
browser smoke test confirms it works as designed.

### ~~Track 4: Settings + Activity Log fullscreen rewrite~~ — ALREADY FULLSCREEN
Verified by reading source:
- `FullPageWorkspaceShell.tsx` — clean `fixed inset-0` + WorkspacePageHeader + children,
  no chrome / breadcrumb / tab pills / rounded container
- `SettingsPage.tsx` — clean `flex h-full` + SettingsTabNav (left) + SettingsContentArea
  (right). Capture-phase Escape → unsaved-changes guard
- `ActivityLogPage.tsx` — ToastBanner + ActivityFilterBar + Timeline (60% or 100%) +
  ActivityEventDetail (40% when selected), `min-h-0 flex-1` properly threaded

The 2026-04-10 cleanup commit removed ~4500 lines of old chrome and rebuilt these as
real fullscreen pages, directly addressing what the 2026-04-09 handoff spec asked for.
Memory was stale; current code is correct.

Recommended action: user runs `pnpm dev`, opens both pages, reports any visual problems
that warrant a polish-only follow-up plan. If "looks fine, ship it" → no further work.

### ~~Track 5: SOPs + Market fullscreen rewrite~~ — ALREADY FULLSCREEN
Verified by reading source:
- `MarketPage.tsx` — clean `flex h-full flex-col` + ToastBanner + MarketFilterBar
  (hidden in detail view) + content area with detail/error/empty/grid/manage states +
  PublishDialog
- `SopViewSurface.tsx` — `flex h-full` with SopSidebar (left) + SopLibraryBar +
  SopDagCanvas + SopNlCommandBar (right column), full V2 editor integrated

Same recommendation as Track 4: user smoke-tests, reports any polish needs.

Note: Track 5 still has the **install/publish contradiction** (sop & company_template
publishable but not installable) — that is now Track 2's job, not a UI rewrite.

### Track 6: Repository parity test
**Plan**: `Docs/plans/2026-04-11-repo-parity-test.md`
**Goal**: Add a single vitest spec that asserts all three repository implementations
(`drizzle-repositories`, `memory-repositories`, `tauri-repositories`) export the same set of
method names with the same arity. Does not merge them — just makes drift visible.
**Why sixth**: Cheap insurance. Can run in parallel with any track. Half day work.

### Track 7: Pre-commit hygiene
**Plan**: `Docs/plans/2026-04-11-precommit-hygiene.md`
**Goal**: Add husky pre-commit hook running `pnpm lint && pnpm typecheck`. Document opt-out
for committers who need to bypass for WIP. **Local only — not CI.**
**Why last**: Trivial after the others, ensures dev environment is clean.
**Estimated scope**: 1 hour.

## Execution Order and Parallelism

```
                 Track 0 (DONE — repo cleanup)
                       ↓
                 Tracks 3/4/5 (DONE — verified by source read)
                       ↓
          ┌────────────┴────────────┐
          ↓                         ↓
     Track 1 (bugs)         Track 6 (parity test)
       B1 ✅ done                   │
       B2 / B3 TBD                  │
          ↓                         │
     Track 2 (install narrow)       │
          ↓                         ↓
                   Track 7 (precommit)
                          ↓
                     Browser smoke
                  (verify pages OK)
                          ↓
              ─── Deliverable ───
```

Tracks 1, 6, and 7 are tactically independent and can interleave with the larger tracks.
The critical chain is **2 → 3 → 5**.

## Success Verification

After all tracks are merged:

1. `pnpm install && pnpm build` succeeds clean.
2. `pnpm typecheck && pnpm lint && pnpm test` succeeds clean.
3. `cd apps/web && pnpm test:e2e` succeeds clean.
4. `pnpm --filter @offisim/desktop dev` boots, app launches, can:
   - Create a company through the wizard
   - Open Office workspace, see employees move
   - Switch to SOPs workspace, create a new SOP via the editor (drag nodes, connect, save)
   - Switch to Market workspace, install an employee, return to Office and see them
   - Switch to Activity Log, see events in real time
   - Open Settings, change a provider preset, save without unsaved-changes panic
5. None of the 3 known bugs reproduce.
6. No `console.error` from regular use.
7. README quickstart actually works on a fresh clone (smoke check).

## Reference Files

| Plan | Lives at |
|------|----------|
| Track 1 | `Docs/plans/2026-04-11-known-bugs.md` |
| Track 2 | `Docs/plans/2026-04-11-install-publish-narrowing.md` |
| Track 3 | `Docs/plans/2026-04-10-sop-dag-editor-v2.md` (already exists) |
| Track 4 | `Docs/plans/2026-04-11-fullscreen-pages-batch-1.md` |
| Track 5 | `Docs/plans/2026-04-11-fullscreen-pages-batch-2.md` |
| Track 6 | `Docs/plans/2026-04-11-repo-parity-test.md` |
| Track 7 | `Docs/plans/2026-04-11-precommit-hygiene.md` |

## Source-of-Truth Documents

- `memory/audit_ship_readiness_2026_04_11.md` — code-cited current-state audit
- `Docs/superpowers/specs/2026-04-09-fullscreen-pages-handoff.md` — fullscreen pages business
  logic and design direction (input for Tracks 4 & 5)
- `Docs/superpowers/specs/2026-04-05-architecture-takeaways.md` — long-term reference for
  patterns being preserved
- `memory/project_ui_ux_remaining_issues.md` — bug details (input for Track 1)
- `CLAUDE.md` — project conventions (must be honored by every track)
- `memory/feedback_*.md` — long-term collaboration norms (must be honored by every track)
