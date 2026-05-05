# Background verification — close-runtime-binding-and-routing-debt

Date: 2026-05-05

## Code evidence

- `packages/core/src/runtime/active-context-snapshot.ts` is the canonical session-start resolver for active project, company, employee, workspace root, and default provider/model.
- `packages/core/src/agents/employee-preflight.ts` resolves the active-context snapshot before gateway / SDK branching.
- Existing deterministic scenarios cover SDK tool omission, manager reroute events, and pm-planner sanitize-rebind events.
- `packages/ui-office/src/components/events/activity-log-grouping.ts` keeps the activity-feed collapse contract for 3+ same `(source, reason, taskRunId)` reroute events.

## Commands

- `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/core typecheck` passed before the release build.
- `pnpm --filter @offisim/ui-office typecheck` passed.
- `pnpm --filter @offisim/web typecheck` passed.
- `node scripts/harness-contract.mjs --force-build` passed: 54 scenarios, including `tool-kit-without-builtins-omits-fs-shell`, `manager-rerouted-event-fires`, and `sanitize-rebind-uses-recommended-order`.
- `pnpm --filter @offisim/ui-office build` passed.
- `pnpm --filter @offisim/desktop build` passed.
- `openspec validate close-runtime-binding-and-routing-debt --strict` passed.
- `git diff --check` passed.

## Release build

- App path: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- App timestamp: `2026-05-05T18:50:18+1200`
- Binary sha256: `dc1e7186a643838f6d8b68082024fc0efb78c5f5ec7ab5b32b0b296424fa5581`

## Release foreground verification follow-up

The foreground release checks listed here were completed later in
`.live-verify/close-runtime-binding-and-routing-debt/verify-record.md`:

- Runtime-context/tool-routing historical failure modes were replayed.
- SDK lane text-only boundary was checked in the release app.
- Manager and pm-planner reroute events plus activity-feed collapse were observed in the release app.

Remaining blockers are archive coupling with `fix-workspace-binding-and-employee-context-mismatch`
and the read-only global memory update gate.
