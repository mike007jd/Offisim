# Tauri Release Verify - close-frontend-ux-debt

Date: 2026-05-02

Scope: Tauri release `.app` only, launched with `open -b com.offisim.desktop`.

## Result

PASS for the requested Tauri release package checks.

## Evidence

- `tauri-release-employee-brand-avatars.png`
  - Release app attached through Computer Use.
  - Company: `Live Verify - Contributor Avatars`.
  - Internal employee renders seed avatar.
  - Hermes external employee renders brand avatar.
  - External null-brand employee renders generic brand fallback, not DiceBear.

- `tauri-release-dashboard-deliverables.png`
  - Release app dashboard hydrates persisted deliverables.
  - Mixed contributor deliverable shows `Internal Analyst` + `Hermes Contractor`.
  - Legacy contributor deliverable lacking `isExternal/brandKey` still renders/loads instead of crashing.
  - External null-brand deliverable is present with `External Contractor`.

## Build Gates Run

- `pnpm --filter @offisim/ui-office build`
- `pnpm --filter @offisim/desktop build`
- `pnpm --filter @offisim/web build`
- `node scripts/verify-deliverable-contributor-roundtrip.mjs`

## Fix Applied During Verify

Initial release resume exposed a real bug: `TauriCheckpointSaver.loadLatest()` hydrated legacy `currentStepOutputs`, but the UI resume path goes through `resumePlan()` -> `getTuple()`, bypassing `loadLatest()`.

Fix: hydrate legacy checkpoint state at the `getTuple()` / `list()` deserialization boundary in `apps/web/src/lib/tauri-checkpoint.ts`.

After rebuild, release app showed `RESUME RESTORED` for a legacy checkpoint whose `currentStepOutputs[]` intentionally lacked `isExternal` / `brandKey`.

## Notes

- Existing unrelated WIP remains present in `apps/web/src/lib/tauri-skill-install-adapters.ts` and `packages/core/src/agents/boss-node.ts`; do not include those in this change commit.
- During resume verification, the cloned checkpoint continued into a real MiniMax runtime call and produced an extra `readme_summary_status.md` deliverable. This came from the live resume execution, not from contributor avatar seed data.
