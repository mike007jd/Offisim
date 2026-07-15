# Offisim = Pi Agent GUI + 3D Work Theater

Checked at: 2026-06-18 NZST
SDK registry check: `@earendil-works/pi-coding-agent@0.79.6` was the local pinned
version and npm `latest` at the time of this ADR (published 2026-06-16T22:03:33.475Z).
(Superseded — this is a historical runtime decision record; see
`Docs/HARNESS_ARCHITECTURE.md` for the current exact Pi pin.)

## Decision

Offisim has one active AI runtime: Pi Agent.

Offisim is the desktop GUI, assistant-ui chat surface, 3D work theater, company/project/thread data shell, and deliverable archive. Pi Agent owns real AI work: model/provider auth, model registry, session storage, compaction, tool loop, retry/stream/event protocol, and runtime execution.

## Product Boundary

- Renderer composer writes into the Offisim thread store.
- Tauri calls the Pi Agent Host.
- Pi Agent Host runs the official `@earendil-works/pi-coding-agent` SDK.
- Pi events are projected into assistant-ui messages, run-state telemetry, and 3D office animation.
- The active project `workspace_root` is passed as the Pi session cwd. Offisim does not wrap Pi's model/protocol/tool loop with a second agent harness.

## Current implementation addendum (2026-07-16 NZST)

- Ordinary turns continue the thread's recent Pi session. Interrupted-run Resume
  remains controller-owned under the same durable root: it opens a recorded Pi
  JSONL exactly, or starts a fresh replay only when no session file was recorded.
  Invalid recorded paths fail closed; Resume never guesses another session.
- Root and delegated worktrees follow Pi's own project-trust store. Prompt
  Enhance and collaboration remain in-memory utility sessions with project
  resource discovery disabled.
- A root discovery row is admitted before the visible user message or host work.
  Terminal settlement is controller-acknowledged: final chat/interaction state,
  child reconciliation, root terminal marker, then retained-stream release. Rust
  replay is bounded by both 4,096 events and 8 MiB while retaining the final event.

## Superseded Paths

These are no longer product routes:

- Offisim provider/model catalog
- `ProviderPane`
- provider freshness scripts/gates
- Claude Code SDK lane
- Codex sidecar lane
- OpenAI Agents SDK lane
- runtime provider profile UI as the primary AI mental model

Claude Code or Codex can only return later as a mutually exclusive full runtime engine with separate release `.app` evidence. They are not provider lanes inside Pi Agent.

## UI Rule

`Settings > Pi Agent` shows Pi auth/model/session status from Pi-owned storage. It exposes the Pi config folder, `auth.json` / `models.json` paths, a safe models.json summary, and a single advanced model override that is passed to Pi. Model configuration stays in Pi; Offisim does not maintain a parallel catalog.

The original 2026-06-18 UI decision showed one Pi Agent session moving through
states: thinking, reading, editing, running tools, blocked/error, done. The
current delegated run-tree projection is defined by
`Docs/DELEGATION_ARCHITECTURE.md`; current harness behavior is defined by
`Docs/HARNESS_ARCHITECTURE.md`.
