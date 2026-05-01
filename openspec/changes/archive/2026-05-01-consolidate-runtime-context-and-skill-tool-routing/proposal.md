## Why

Three independent backend gaps surfaced from doubled-bubble reverify (2026-05-01) + lingering T2.2/T2.4 debt are individually small but each requires backend / Rust / agent-layer touch (not UI). Bundling them into a single codex-driven change with one master live-verify gate at the end avoids the "ship code, forget to verify" pattern that left 6.9 / 6.11 / 3.5 unticked from `2026-04-26-consolidate-post-overhaul-runtime-followups`. The companion UI fix (T2.2 b chat outcome surfacing) is split into its own change `fix-skill-install-outcome-chat-surface`.

## What Changes

Three parallel backend streams, plus folded-in T2.4 verification:

- **Stream 1 — `sync_from_claude_code` boss routing (T2.2 c)**: tool registered at `packages/core/src/agents/skill-install-tools.ts:680`; resolver at `packages/core/src/skills/skill-source-resolvers/claude-code.ts:74` already throws `'sync_from_claude_code requires the desktop runtime.'` on web, but Web boss does not reliably route to the tool. Investigate boss prompt assembly + tool descriptor exposure; fix routing OR fall back to a typed `desktop-only-tool` error category that the boss surfaces clearly. Time-box investigation at 1h, fall back if blown.
- **Stream 2 — workspace_root binding gap**: release session reports `'no project workspace root is bound'` even when G1 capability `project-workspace-binding` shipped + a project with `workspace_root` is the active project. Diagnose layer-by-layer (Rust state → runtime context → project switch handler), fix the empty layer, and add observability event `workspace-binding.unavailable` so future regressions surface.
- **Stream 3 — boss employee-context visibility**: Boss in team chat says `"no employee database access"` while left-rail employee list shows Alex Chen + Maya Lin + Marcus Johnson. Trace the boss's system prompt assembly (NOT `employee-prompt-assembly.ts` — that's per-employee), confirm it queries `repos.employees.findByCompany(activeCompanyId)`, fix the gap, and add observability event `boss.employee-context.empty` (only when DB reports non-empty roster but prompt receives 0 — true regression signal).
- **Folded — T2.4 self-authoring live verify**: archive `2026-04-26-consolidate-post-overhaul-runtime-followups` task 6.9 / 6.11 unticked. Code already in. No new code; covered by Section 7 master live verify on release `.app`.

**Master live verify**: single release `.app` session covers all 3 streams + T2.4 happy/mismatch/error paths with `screencapture -l` evidence. Web verify (Stream 1) goes via Chrome devtools/playwright per CLAUDE.md feedback rule.

**Defer (separate change)**: T2.2 (a) chat panel "Attach file" affordance — design-heavy.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities

- `agent-mediated-skill-install`: adds Requirement that `sync_from_claude_code` SHALL be reachable from Web boss with a typed `desktop-only-tool` runtime guard surfacing a clear user-facing message.
- `project-workspace-binding`: adds Requirement that the active project's `workspace_root` SHALL reach the desktop builtin tool sandbox + observability event when the binding is missing.
- `employee-node-boundaries`: adds Requirement that the boss agent's system prompt SHALL include the active company's employee roster + observability event for true regression (DB non-empty, prompt empty).

## Impact

- **Code touched**:
  - `packages/core/src/agents/boss/` system-prompt assembly (Stream 1 tool list + Stream 3 employee roster — same file, must be co-merged)
  - `packages/core/src/agents/skill-install-tools.ts` + `packages/core/src/agents/skill-install/tool-defs.ts` (Stream 1 tool descriptor exposure)
  - `packages/core/src/skills/skill-source-resolvers/claude-code.ts` (Stream 1 typed error fallback)
  - `apps/desktop/src-tauri/src/builtin_tools.rs` (Stream 2 — possible Rust state plumbing)
  - `apps/web/src/lib/tauri-runtime.ts` (Stream 2 — possible IPC bridge)
  - `packages/core/src/runtime/runtime-context.ts` (Stream 2 — possible runtime context plumbing)
  - `packages/shared-types/src/events/` + `packages/core/src/events/` — new event factories for `workspace-binding.unavailable` (Stream 2) + `boss.employee-context.empty` (Stream 3)
- **APIs / data**: no schema change. Two new observability events (additive).
- **Risk surface**:
  - Streams 1 + 3 touch the same boss prompt assembly file — must be co-merged, not parallel-conflicting.
  - Stream 2 spans Rust + TS bridge layers; root cause may be in any of 3 layers; design.md holds diagnosis path with explicit time budget.
  - Stream 1 has documented fallback if 1h investigation insufficient.
- **Verification gate**: master live verify on release `.app` — Streams 1 (Web + desktop sides), 2, 3, plus T2.4 happy/mismatch/error. Codex-friendly script in tasks Section 7.
