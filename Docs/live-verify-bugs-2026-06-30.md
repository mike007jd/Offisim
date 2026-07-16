# Offisim Live Verify Bug Ledger - 2026-06-30

> **Historical evidence only (2026-07-16):** retained to preserve finding and
> fix provenance; statuses are not current release proof. Use the
> [current Codex-alignment tasks](./roadmap/2026-07-13-ui-ux-consistency-pass/tasks.md).

| ID | Severity | Surface / workflow | Repro steps | Evidence | Expected | Actual | Root cause | Fix plan | Regression oracle | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| BUG-LV-01 | P2 | Loops Library / Loops Editor draft authoring | In release app, create a New Loop, type an uncompiled draft prompt, go back to the library, then reopen the loop. | `SS-11`, `SS-12` | A user-authored draft remains visible in the library card and rehydrates in the editor until compiled or cleared. | The library card showed `No description yet.` and reopening the draft restored an empty editor. | `New Loop` persisted an empty definition, but the natural-language draft prompt only lived in local editor state until Compile + Save. | Fixed by persisting uncompiled draft prompt to `loop_definitions.summary` on Back, and hydrating the editor from summary when no current revision exists. Revision history and runtime execution remain untouched. | `SS-14`, `SS-15`, and fresh HOME rerun `SS-35` show the draft retained without compile. `pnpm validate`, `pnpm check:ui-hygiene`, `pnpm security:harness`, release build, and `git diff --check` passed after the fix. | FIXED |
