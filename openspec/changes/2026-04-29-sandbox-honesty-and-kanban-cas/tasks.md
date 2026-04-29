## Phase A - Sandbox honesty

- [ ] Harden `builtin_tools.rs` write paths against symlink escape before `mkdir` or write.
- [ ] Sanitize overbroad `workspace_root` rows and redact LLM-facing path errors.
- [ ] Add read/write size limits and remove login-shell sourcing from bash execution.
- [ ] Add deterministic scenarios for symlink escape, overbroad roots, oversized read, and oversized write.
- [ ] Sync `openspec/specs/interaction-modes/spec.md`.

## Phase B - Tauri capability gate

- [ ] Add main-window-only `offisim:fs-shell` and `offisim:agent-bridges` capability files.
- [ ] Document the desktop capability convention in app-local CLAUDE guidance.

## Phase C - Harness self-attest guard

- [ ] Remove the four remaining self-attest assertions from harness scenarios.
- [ ] Add load-time self-attest rejection to `scripts/harness-contract.mjs`.
- [ ] Sync `packages/core/CLAUDE.md`.

## Phase D - Kanban atomicity

- [ ] Add compare-and-update storage contract and use it in `KanbanRepo.transition`.
- [ ] Add Rust SQL CAS to `transition_kanban_card`.
- [ ] Add stale-transition deterministic scenario.
- [ ] Sync `openspec/specs/kanban-data-pipeline/spec.md`.

## Phase E - Single sources of truth

- [ ] Add `packages/shared-types/src/kanban-state-machine.json` and consume it from TypeScript.
- [ ] Generate Rust transition constants from the JSON SSOT in `build.rs`.
- [ ] Add harness contract cross-check for TypeScript/Rust transition tables.
- [ ] Move desktop SQLite pool lookup/open helpers to one local-db module.
- [ ] Reuse a shared path utility for Tauri runtime path joins.
- [ ] Sync `openspec/specs/kanban-data-pipeline/spec.md`.

## Phase F - Hot-path efficiency

- [ ] Manage a desktop SQLite pool in Tauri state and remove per-command close calls.
- [ ] Stream-reduce soak reports with bounded sample failures and bounded latency storage.
- [ ] Short-circuit PM heartbeat before DB scans when plan progress did not change.
- [ ] Persist plan task rows and kanban rows in parallel batches.
- [ ] Sync `openspec/specs/long-running-runtime/spec.md`.

## Phase G - Misc cleanup and RC verification

- [ ] Fix misleading completion comment, stuck-task literals, and dead mode-kanban fixture fields.
- [ ] Run all per-commit gates and commit each phase separately.
- [ ] Build release desktop app and run the seven Computer Use RC verification paths.
- [ ] Record R3 evidence in `Docs/04_runtime_experience/EXECUTION_REPORT_2026-04-29.md`.
