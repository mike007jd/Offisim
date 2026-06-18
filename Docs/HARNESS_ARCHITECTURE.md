# Harness Architecture — Pi Agent Host

This document describes the current desktop AI execution path.

## Current Runtime

Offisim has one active AI runtime: Pi Agent.

The desktop renderer uses `apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts`
as a thin client. It sends user turns to the Tauri command
`pi_agent_execute`, receives Pi session events, and projects them into:

- assistant-ui message state
- run/tool telemetry
- 3D office work-state animation

The Tauri side lives in `apps/desktop/src-tauri/src/pi_agent_host.rs`. It starts
the bundled Node host `apps/desktop/src-tauri/resources/pi-agent-host.mjs`, binds
the active project workspace as the Pi session cwd, and forwards JSONL events to
the renderer.

The Node entrypoint is `scripts/tauri-pi-agent-host.entry.mjs`. It uses the
official `@earendil-works/pi-coding-agent` SDK:

- `AuthStorage.create()`
- `ModelRegistry.create()`
- `SessionManager`
- `createAgentSession`

Pi owns provider auth, model registry, sessions, compaction, tool loop,
streaming protocol, and retries. Offisim does not maintain a provider catalog or
parse model-provider SDK transports.

## Superseded Runtime

The old `packages/core/src/pi-bridge` loop and `packages/pi-ai` /
`packages/pi-agent` fork are historical migration code. They are not the
desktop main path and must not be reconnected to Settings or chat without a new
architecture decision.

The following paths are retired from product runtime:

- Offisim provider/model catalog
- `ProviderPane`
- Claude Code SDK sidecar
- Codex sidecar
- OpenAI Agents adapter
- Rust raw LLM transport commands

## Validation

Active runtime validation is:

- `pnpm harness:review-fixes` — keeps the old lanes/catalog removed
- `pnpm harness:pi-agent-host` — checks Pi SDK host wiring and release resources
- `pnpm validate` — combines typecheck, Pi-only guards, Studio placement, and Pi
  Agent Host checks

Release evidence still requires the current worktree release `.app` driven by
Computer Use when desktop behavior changes.
