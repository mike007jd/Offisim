# Desktop AI Runtime Harness Architecture

Checked at: 2026-07-17 NZST

This document describes the current production gateway, engine hosts, and the
gates that prove them. Product/account/session/workspace decisions live in
[Engine-neutral AI Accounts](./architecture/2026-07-13-engine-neutral-ai-accounts.md).

## Production route

`apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts` owns the single
`DesktopAgentRuntimeGateway`. A Turn resolves one engine lane and a
backend-authorized effective task workspace. Pi also resolves the selected API
account/model; external CLIs retain their own model choice. The gateway routes to
exactly one adapter:

- **API** — shipped. The adapter uses the bundled host assembled from
  `scripts/tauri-pi-agent-host.entry.mjs` and
  `apps/desktop/src-tauri/src/pi_agent_host/`. Pi SDK types remain an internal
  implementation detail of this API lane.
- **Codex CLI orchestration** — implemented. The adapter uses
  `apps/desktop/src-tauri/src/codex_agent_host/` to detect the user-installed CLI,
  start `codex app-server --stdio`, project its event stream, and support Stop and
  recovery. Offisim does not bundle a Codex binary.
- **Claude Code orchestration** — pending. No Settings card, label, or compatibility
  shim counts as support before its full adapter and release proof exist.

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

Pi provider keys entered in AI Accounts are written to Pi-owned
`~/.pi/agent/models.json`; only safe provider/model summaries return to the
renderer. External CLI login, model choice, native sessions, compaction, and
global memory stay in the CLI's own home. The renderer receives CLI
install/login/version status, opaque native references, task tokens, and duration;
it never receives raw credentials or native session files.

## Validation

The retained runtime gates are responsibility-based:

- `pnpm harness:review-fixes` — production gateway, account/model truth,
  document truth, and product-surface guards.
- `pnpm harness:runtime-conformance` — engine-neutral execution contract.
- `pnpm harness:pi-agent-host` — current API-adapter host, execution target,
  usage, tools, delegation, and release resources.
- `pnpm harness:codex-app-server-contract` — Codex CLI detection, PATH launch,
  app-server protocol, event stream, approval, Stop, recovery, and secret-isolation
  contract; it also prevents bundled-binary and account/model/Usage code from returning.
- `pnpm harness:renderer-engine-authority` and
  `pnpm harness:execution-provenance` — one authoritative engine/account/model
  identity per Turn.
- `pnpm validate` — composes those gates with the rest of the product harnesses.

Release support still requires the exact current-worktree release `.app`, its
binary hash, matched window identity, and Computer Use interaction.
Dev webviews and localhost previews are not release evidence.

## Historical boundary

The removed `packages/core/src/pi-bridge` loop, vendored `packages/pi-ai` /
`packages/pi-agent`, duplicate standalone `ProviderPane`, adapter-global model
override, and raw LLM Tauri transport must stay removed. Provider editing now
belongs inside AI Accounts and writes Pi's dynamic configuration; this prevents
a second runtime path without deleting the supported API configuration surface.
