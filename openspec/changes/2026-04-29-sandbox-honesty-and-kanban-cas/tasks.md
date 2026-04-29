## Phase A - Sandbox honesty

- [x] Harden `builtin_tools.rs` write paths against symlink escape before `mkdir` or write.
- [x] Sanitize overbroad `workspace_root` rows and redact LLM-facing path errors.
- [x] Add read/write size limits and remove login-shell sourcing from bash execution.
- [x] Add deterministic scenarios for symlink escape, overbroad roots, oversized read, and oversized write.
- [x] Sync `openspec/specs/interaction-modes/spec.md`.

## Phase B - Tauri capability gate

- [x] Add main-window-only `offisim:fs-shell` and `offisim:agent-bridges` capability files.
- [x] Document the desktop capability convention in app-local CLAUDE guidance.

## Phase C - Harness self-attest guard

- [x] Remove the remaining self-attest assertions from harness scenarios.
- [x] Add load-time self-attest rejection to `scripts/harness-contract.mjs`.
- [x] Sync `packages/core/CLAUDE.md`.

## Phase D - Kanban atomicity

- [x] Add compare-and-update storage contract and use it in `KanbanRepo.transition`.
- [x] Add Rust SQL CAS to `transition_kanban_card`.
- [x] Add stale-transition deterministic scenario.
- [x] Sync `openspec/specs/kanban-data-pipeline/spec.md`.

## Phase E - Single sources of truth

- [x] Add `packages/shared-types/src/kanban-state-machine.json` and consume it from TypeScript.
- [x] Generate Rust transition constants from the JSON SSOT in `build.rs`.
- [x] Add harness contract cross-check for TypeScript/Rust transition tables.
- [x] Move desktop SQLite pool lookup/open helpers to one local-db module.
- [x] Reuse a shared path utility for Tauri runtime path joins.
- [x] Sync `openspec/specs/kanban-data-pipeline/spec.md`.

## Phase F - Hot-path efficiency

- [x] Manage a desktop SQLite pool in Tauri state and remove per-command close calls.
- [x] Stream-reduce soak reports with bounded sample failures and bounded latency storage.
- [x] Short-circuit PM heartbeat before DB scans when plan progress did not change.
- [x] Persist plan task rows and kanban rows in parallel batches.
- [x] Sync `openspec/specs/long-running-runtime/spec.md`.

## Phase G - Misc cleanup and RC verification

- [x] Fix misleading completion comment, stuck-task literals, and dead mode-kanban fixture fields.
- [x] Run all per-commit gates and commit each phase separately.
- [ ] Build release desktop app and run the seven Computer Use RC verification paths.
- [ ] Record R3 evidence in `Docs/04_runtime_experience/EXECUTION_REPORT_2026-04-29.md`.
