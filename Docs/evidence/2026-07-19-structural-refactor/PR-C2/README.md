# PR-C2 verification evidence

## Scope and stacked base

- Branch: `refactor/C2-agent-host-command-runtime`
- Stacked base: `refactor/C1-agent-host-stream-core`
- Base revision: `e3d04183a8bf10a97a5ac779caed82883ab6f125`
- Merge status: not merged; merge remains reserved for explicit user approval.

## Plan deviation authorized by the user

The roadmap describes moving the Codex probe and the “corresponding Claude
section” into Rust `agent_host_runtime.rs`. Current production code has no
corresponding Rust Claude CLI probe: Claude executable discovery, credential
redaction, version/auth commands, JSON auth parsing, and status projection are
owned by `scripts/tauri-claude-agent-host.entry.mjs`, reached from Rust through
the trusted sidecar launcher.

Execution initially stopped under section 0.5. On 2026-07-19 the user explicitly
instructed execution to continue from current code facts and not stop again. The
authorized implementation therefore preserves the Claude JS sidecar boundary
byte-for-byte, centralizes only the Rust-owned Codex discovery/probe beside node
discovery, and shares the strict Rust status contract used to serialize Codex
and deserialize Claude. External CLI credentials, model choice, auth, and usage
remain CLI-owned; neither orchestration engine is represented as a Pi provider.

## Mechanical oracles

- `agent_host_commands!` generates the two command surfaces from one shared
  module; both original command-name sets compare exactly at 9/9.
- `check-agent-runtime-capabilities` reports all 30 gateway commands registered
  and allowlisted. No command or capability name changed.
- The Codex binary search, executable check, version probe, login probe, strings,
  candidate order, shell fallback, and canonicalization moved without semantic
  edits.
- The Claude entry source is unchanged. Its harness still proves executable
  override handling, status projection, login/version behavior, and credential
  redaction.
- Shared status-contract tests prove Codex still omits `sourceUrl`, while Claude
  still requires `sourceUrl` and rejects unknown fields.

## Deterministic gates

- `node scripts/prepare-desktop-cargo-test.mjs && cargo test --locked`:
  462 passed, 0 failed.
- `node scripts/release-gates.mjs --lane=rust`: 1/1 green.
- `node scripts/release-gates.mjs --lane=node`: exit 0; all release gates green.
- `pnpm harness:claude-agent-host`: passed.
- `pnpm harness:codex-app-server-contract`: passed.
- `pnpm check:agent-runtime-capabilities`: 30 commands registered and allowlisted.
- `git diff --check`: passed.

## Release app live verification

Exact artifact:

`/Users/haoshengli/worktrees/offisim-refactor-c/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`

- Built: 2026-07-19 00:46:25 NZST.
- Architecture: arm64.
- Bundle identifier: `com.offisim.desktop`.
- Signature: Developer ID Application, team `9MP925J67C`.
- Resolved process: PID 61213, exact executable under the artifact above.
- Resolved main window: `windowId=32669`, title `Offisim`, bounds
  `x=36 y=33 width=1440 height=889`.
- Computer Use opened Settings → AI Accounts, ran Refresh, and observed:
  - API engine: Up to date; configured provider available with 7 models.
  - Codex CLI: Ready; `codex-cli 0.144.5`; subscription included; no API cost.
  - Claude: Ready; `2.1.214 (Claude Code)`; subscription included; no API cost.
- Independent shell probes matched the UI: Codex and Claude auth checks both
  exited ready; bundled Node reported `v22.22.3`.
- The app was closed through Computer Use and PID 61213 exited.

Screenshots:

- [API engine status](settings-ai-accounts-three-engines.png)
- [Codex and Claude subscription status](settings-subscription-tools-ready.png)
