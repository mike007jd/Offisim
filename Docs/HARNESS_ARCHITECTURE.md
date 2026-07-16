# Desktop AI Runtime Harness Architecture

Checked at: 2026-07-16 NZST

This document describes the current production gateway, engine hosts, and the
gates that prove them. Product/account/session/workspace decisions live in
[Engine-neutral AI Accounts](./architecture/2026-07-13-engine-neutral-ai-accounts.md).

## Production route

`apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts` owns the single
`DesktopAgentRuntimeGateway`. A Turn resolves one account, exact model, billing
mode, and backend-authorized effective task workspace, then routes to exactly
one complete adapter:

- **API** — shipped. The adapter uses the bundled host assembled from
  `scripts/tauri-pi-agent-host.entry.mjs` and
  `apps/desktop/src-tauri/src/pi_agent_host/`. Pi SDK types remain an internal
  implementation detail of this API lane.
- **Codex subscription** — shipped. The adapter uses
  `apps/desktop/src-tauri/src/codex_agent_host/` and the bundled official native
  `codex-app-server` sidecar.
- **Claude subscription** — shipped. The adapter uses
  `apps/desktop/src-tauri/src/claude_agent_host/` and the bundled official
  `@anthropic-ai/claude-agent-sdk` host.

All three shipped adapters enter through the neutral `agent_runtime_*` Tauri
commands and project neutral message, tool, approval, usage, and terminal events
to assistant-ui, activity telemetry, and Office dramaturgy. A run never mixes
engine lanes.

## Native state and credential boundary

Offisim keeps four layers separate:

1. Project folder catalog.
2. Offisim Conversation and run projection.
3. Native Agent Home / Session / Memory.
4. Effective task workspace for one Turn.

API credentials configured in Offisim are sealed behind the desktop secret
boundary. Subscription login, native sessions, compaction, and global memory
stay in the engine's own home. The renderer receives safe account/model status,
opaque native references, and provider-native Usage when available; it never
receives raw OAuth tokens or native session files.

## Validation

The retained runtime gates are responsibility-based:

- `pnpm harness:review-fixes` — production gateway, account/model truth,
  document truth, and product-surface guards.
- `pnpm harness:runtime-conformance` — engine-neutral execution contract.
- `pnpm harness:pi-agent-host` — current API-adapter host, execution target,
  usage, tools, delegation, and release resources.
- `pnpm harness:codex-app-server-contract` — native Codex artifact, protocol,
  account/model/Usage projection, stream, approval, Stop, and recovery contract.
- `pnpm harness:claude-agent-host` — native Claude account/model projection,
  stream, approval, Stop/recovery, workspace guard, secret isolation, and Usage
  contract.
- `pnpm harness:renderer-engine-authority` and
  `pnpm harness:execution-provenance` — one authoritative engine/account/model
  identity per Turn.
- `pnpm validate` — composes those gates with the rest of the product harnesses.

Release support still requires the exact current-worktree release `.app`, its
binary/sidecar hashes, matched window identity, and Computer Use interaction.
Dev webviews and localhost previews are not release evidence.

## Historical boundary

The removed `packages/core/src/pi-bridge` loop, vendored `packages/pi-ai` /
`packages/pi-agent`, `ProviderPane`, adapter-global model override, raw LLM
Tauri transport, and provider-profile editor must stay removed. This does not
ban complete engines or the safe exact model catalog; it prevents a second,
partial runtime path from bypassing the production gateway.
