## Why

Runtime routing debt has crossed from backlog hygiene into user-visible failure: project-bound file/shell tools still lose the active workspace root, Boss can see employees in UI but not in its team-chat prompt, and SDK lane activity still implied work that was not actually happening. This change closes the remaining runtime binding, routing, protocol-ledger, and archive debt as one complete production pass so Offisim 1.0 has one truthful execution model instead of scattered partial fixes.

## What Changes

- **D1 — Workspace root binding full path.** `activateProject()` emits a project-activated signal, synchronizes runtime context `activeProjectId`, and re-binds the desktop builtin tool sandbox to the newly active project's `workspace_root`. Rust-side `workspace_roots()` stops full-table scanning and resolves only the active project. Switching projects inside a session immediately moves `read_file` / `write_file` / `bash` to the new root and blocks the old root. The existing `tauri-skill-install-adapters.ts` `..` path-escape defense becomes a spec-protected invariant. Add deterministic harness scenario `switch-project-rebinds-workspace-root`.
- **D2 — Boss team-chat roster closure.** Preserve the in-progress Boss fixes already in the working tree: per-event-bus empty-roster suppression, internal-only skill-mutation employee selection, and defensive direct-reply override only for wrong-routed skill mutation. Fix the root cause by synchronizing runtime context `companyId` on active company changes so Boss prompt assembly uses the same roster the UI employee list shows. Add harness coverage for non-empty roster prompt assembly and multi-company isolation. Remove only D2/D3 backlog rows in `MEMORY.md` once the implementation proves them stale.
- **D3 — SDK lane activity honesty.** Offisim 1.0 SDK lanes remain text/reasoning-only and must not expose Offisim file, shell, memory, todo, skill, or MCP tools. Remove the placeholder “engine accepted task” event and keep `tauri-engine-adapters.ts` able to map trusted host tool lifecycle events only if a future legal sidecar emits them. Do not add replay or live evidence for SDK tool parity while no legal SDK tool path exists.
- **D4 — Protocol ledger drift closure.** Add decision/spec artifacts for MCP transport, LangGraph fork tracking, and provider-lane matrix. During implementation, document why Streamable HTTP is not migrated in this change, track the `tauri-checkpoint.ts` fork against upstream SqliteSaver and pnpm patches, update provider × lane evidence for verified and unverified providers, and sync `openspec/protocols-ledger.md` to those decisions.
- **D5 — Close `close-runtime-routing-and-workspace-debt`.** Finish its remaining release `.app` live verification tasks 13.1-13.4 with screenshot, IPC trace, and steps under that change's `.live-verify/`; complete 14.3 memory cleanup; run archive-gate three-way checks; then archive it.
- **D6 — Archive two completed backend changes.** Run archive-gate three-way checks and archive `2026-04-29-sandbox-honesty-and-kanban-cas` and `roadmap-debt-reconciliation`.
- **D7 — Residual cleanup.** Delete stale `.live-verify/runtime-context-and-tool-routing/` after confirming its owning change is already archived. Do not touch `.live-verify/fix-doubled-boss-bubble/`, which remains a separate frontend/UI reproduction scope.

## Capabilities

### New Capabilities

- `mcp-transport-decision`: Decision capability for MCP client transport posture, including current SDK documentation review, migration cost, and the explicit “not now / migrate when” rule.
- `langgraph-fork-tracking`: Decision and process capability for tracking Offisim's local LangGraph SqliteSaver fork, pnpm patches, upstream-diff checklist, and quarterly review cadence.
- `provider-lane-matrix`: Evidence capability for provider × lane support status, including verified, pending, and unsupported rows plus smoke-script entry points.

### Modified Capabilities

- `project-workspace-binding`: Active-project `workspace_root` SHALL be the only desktop builtin-tool sandbox root; project switches SHALL re-bind runtime context and Rust state immediately; path-escape defenses SHALL be preserved as normative behavior.
- `runtime-engine-adapter`: SDK lane activity SHALL stay truthful: no synthetic accepted-task row, no Offisim tool exposure in SDK lanes, and trusted host tool lifecycle events are mapped only when a legal sidecar actually emits them.
- `employee-node-boundaries`: Boss team-chat prompt assembly SHALL use the active company's current employee roster, keep per-bus empty-roster diagnostics isolated, exclude external employees from skill mutation routing, and only override direct replies for defensive skill-mutation recovery.

## Impact

- **Code surfaces to be changed later**: `apps/desktop/src-tauri/src/builtin_tools.rs`, `apps/desktop/src-tauri/src/claude_agent_host.rs`, `apps/desktop/src-tauri/resources/codex-agent-host.mjs`, `apps/web/src/lib/tauri-engine-adapters.ts`, `apps/web/src/lib/tauri-skill-install-adapters.ts`, `packages/core/src/services/project-service.ts`, `packages/core/src/agents/boss-node.ts`, runtime context wiring, harness scenarios, and activity event rendering.
- **OpenSpec / docs**: new change specs under this change; decision docs under `openspec/specs/`; updates to `openspec/protocols-ledger.md`; updates to `openspec/provider-lane-matrix.md`; archive-gate evidence for three older changes.
- **Validation**: deterministic harness for workspace rebind, Boss roster consistency, multi-company isolation, and truthful tool/write evidence; live verification for workspace file-tree behavior must use macOS Tauri release `.app`, not browser/dev webview. SDK tool parity replay is explicitly out of scope until the product boundary allows an SDK tool path.
- **Process risk**: this change intentionally includes implementation plus archive cleanup. Tasks must keep the archive work gated by live evidence and three-way checks so stale docs are not archived as truth.
- **Explicit exclusions**: no frontend UX debt from `close-frontend-ux-debt`; no doubled-boss-bubble work; no outcome-formatter work; no code implementation in the propose step.
