# Universal Work Dramaturgy Iteration Plan

> **Historical / superseded (2026-07-16):** completed iteration record. Use the
> [current Codex-alignment plan](./2026-07-13-ui-ux-consistency-pass/plan.md),
> [feature catalog](../FEATURES.md), and [Office art bible](../design/office-art-bible.md).

## Summary
- Objective: turn the GPT 5.5 Pro report into a deliverable Offisim iteration for a generic, fact-driven work theater.
- Decision: implement a vertical slice that promotes flow, artifacts, resources, and workload chips to deterministic dramaturgy signals, then render them in the existing 2D/3D Office scene.
- Why this direction: current beats, staging anchors, and single-actor workload aggregation are already correct; the gap is not more animation, it is richer generic work facts.
- Non-goals: no second runtime, no Offisim provider/model catalog, no task-specific animation scripts, no launcher/web product, no new UI framework.

## Source Truth
| claim | status | evidence | implication |
|---|---|---|---|
| `agent.run` is already a neutral event family. | TRUE | `packages/shared-types/src/events/agent-run.ts` | Keep using the existing event vocabulary; extend projection, not runtime ownership. |
| Beat composition is pure and fact-derived. | TRUE | `packages/shared-types/src/dramaturgy/beat-composer.ts` | Add visual signals as deterministic projection fields on beats. |
| One employee already collapses concurrent runs into one actor. | TRUE | `apps/desktop/renderer/src/assistant/runtime/conversation-run-projections.ts` | Upgrade the badge into workload chips without duplicating actors. |
| 2D and 3D share staging projection. | TRUE | `OfficeScene2D.tsx`, `OfficeScene3D.tsx`, `projectOfficeStaging` | Render new flow/resource/artifact overlays from the same beat truth in both modes. |
| Deliverables/artifact persistence exists separately. | TRUE | `desktop-agent-runtime.ts`, `useDeliverableRefresh`, `useDeliverables` | Scene artifact claim in this iteration is presentation-only; persistence remains the deliverables repo path. |

## Plan
- Phase 1: Universal signal contract
  - Change: extend `SceneBeat` with generic visual, flow, artifact, and resource intents derived from neutral events.
  - Oracle: `pnpm harness:beat-composer` proves tool failure, artifact, approval, and resource signals are deterministic.
  - Gate: `pnpm --filter @offisim/desktop-renderer typecheck`.
- Phase 2: Workload and scene rendering
  - Change: add workload chips to the single-actor projection; draw flow packets, artifact shelf, and resource markers in 2D/3D game views.
  - Oracle: `pnpm harness:conversation-run-controller`, `pnpm harness:office-projection`, `pnpm harness:dramaturgy-stress`.
  - Gate: renderer build plus release `.app` live check if the build succeeds.
- Phase 3: Documentation and release proof
  - Change: record the iteration contract and verification evidence.
  - Oracle: `pnpm validate`, GitNexus `detect_changes`, release `.app` Computer Use screenshot when available.

## Anti-overengineering Decisions
- KEEP: extend the existing beat/staging contract because it is already the shared 2D/3D source of truth.
- KEEP: use CSS/Canvas/Three overlays; no new animation or graph library.
- REMOVE: task-specific cases such as "code task walks to computer" because the report explicitly asks for generic work grammar.
- DEFER: real artifact claimed/read persistence; the current deliverables repo owns durable artifact state.
- DEFER: full explanation inspector; this slice exposes labels/tooltips and keeps the deeper source-event inspector as a later iteration.

## Test / Verification
- Current time baseline: 2026-07-01 15:49 NZST.
- GitNexus impact before edits: LOW for `composeBeats`, `projectOfficeStaging`, `projectEmployeeWorkloads`, `OfficeScene2D`, and `EmployeeUnit`.
- Main gates: `pnpm harness:beat-composer`, `pnpm harness:conversation-run-controller`, `pnpm harness:office-projection`, `pnpm harness:dramaturgy-stress`, renderer typecheck/build, `pnpm validate`, release `.app` live verification.
- Completed gates:
  - `pnpm harness:beat-composer` passed 37/37.
  - `pnpm harness:conversation-run-controller` passed 15/15.
  - `pnpm harness:scene-staging` passed 34/34.
  - `pnpm harness:office-projection` passed 12/12.
  - `pnpm harness:dramaturgy-stress` passed 13/13.
  - `pnpm --filter @offisim/shared-types typecheck` and `build` passed.
  - `pnpm --filter @offisim/desktop-renderer typecheck` and `build` passed.
  - `pnpm validate` passed after pinning child process PATH to Corepack `pnpm@10.15.1`.
  - `pnpm --filter @offisim/desktop build` produced `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`.
  - Computer Use attached the release app at pid 1043, windowId 95141, title `Offisim`; 3D and 2D Office game views rendered and switched successfully.
- Final GitNexus `detect_changes(scope: all)` risk is HIGH because the worktree still includes pre-existing Loops/AGENTS/CLAUDE changes outside this iteration. The expected dramaturgy impact is OfficeStage, OfficeScene2D/3D, beat composer, and employee workload projection.

## Next Loop
- Status: `verified-iteration-loop` execution complete for the vertical slice above.
- No remote push or deploy was performed.
