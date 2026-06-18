# Offisim = Pi Agent GUI + 3D Work Theater

Checked at: 2026-06-18 NZST
SDK registry check: `@earendil-works/pi-coding-agent@0.79.6` is the local pinned
version and npm `latest`; published 2026-06-16T22:03:33.475Z.

## Decision

Offisim has one active AI runtime: Pi Agent.

Offisim is the desktop GUI, assistant-ui chat surface, 3D work theater, company/project/thread data shell, and deliverable archive. Pi Agent owns real AI work: model/provider auth, model registry, session storage, compaction, tool loop, retry/stream/event protocol, and runtime execution.

## Product Boundary

- Renderer composer writes into the Offisim thread store.
- Tauri calls the Pi Agent Host.
- Pi Agent Host runs the official `@earendil-works/pi-coding-agent` SDK.
- Pi events are projected into assistant-ui messages, run-state telemetry, and 3D office animation.
- The active project `workspace_root` is passed as the Pi session cwd. Offisim does not wrap Pi's model/protocol/tool loop with a second agent harness.

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

The 3D office shows one Pi Agent session moving through states: thinking, reading, editing, running tools, blocked/error, done.
