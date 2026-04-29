## Why

Round 2 removed the obvious false-completion paths, but review found remaining places where runtime claims were stronger than reality: gateway file writes can follow symlinks outside a project root, desktop commands have no dedicated Tauri capability gate, several harness scenarios still assert their own mock text, kanban transitions can race, and TypeScript/Rust keep duplicate state-machine and database-open logic.

These gaps block `v1.1.0-rc.1` because they let the runtime report "sandboxed", "verified", or "transitioned" without a single source of truth or an atomic enforcement point.

## What Changes

- Harden desktop builtin fs/shell tools so project paths are canonicalized before writes, overbroad workspace roots are ignored, oversized file reads/writes are rejected, bash does not source login profiles, and LLM-facing errors do not leak host absolute paths.
- Add main-window-only Tauri capabilities for fs/shell tools and agent bridge commands.
- Reject self-attesting deterministic harness scenarios at load time and remove the remaining four self-attest assertions.
- Make kanban transitions compare-and-update on the current state across memory, db-local, and Tauri backends.
- Move kanban transition rules to a shared JSON source and generate Rust constants from it.
- Replace per-command SQLite pool open/close paths with managed desktop state and reduce hot-path memory/DB work in soak, heartbeat, and plan persistence.

## Impact

- Desktop security behaviour changes for `project_read_file`, `project_write_file`, and `bash_execute`.
- Harness contracts become stricter; scenarios with `finalOutputContains` equal to an LLM fixture response fail during load.
- Kanban transition callers now see stale-transition errors instead of last-write-wins updates.
- OpenSpec specs for interaction modes, kanban data pipeline, and long-running runtime gain new invariants needed for the RC tag gate.
