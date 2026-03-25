# Desktop Security Boundary Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the desktop security boundary so provider secrets and local MCP execution are controlled by Rust-side trusted state instead of frontend-owned storage and IPC payloads.

**Architecture:** Split provider configuration into non-secret UI settings plus Rust-managed secrets, replace direct MCP stdio spawning with a registered-server model, and tighten Tauri CSP/capabilities and MCP process management together. This keeps the desktop runtime powerful while cutting the current "WebView compromise -> native power" escalation path.

**Tech Stack:** Tauri 2, Rust, React 19, TypeScript, Vitest, Tokio, SQLite, GitHub Actions

---

## Chunk 1: Provider Secret Boundary

### Task 1: Add failing tests for non-secret provider persistence

**Files:**
- Modify: `packages/ui-office/src/lib/provider-config.ts`
- Create: `packages/ui-office/src/lib/__tests__/provider-config.test.ts`

- [ ] Step 1: Write failing tests proving saved desktop provider config does not persist `apiKey`
- [ ] Step 2: Run `pnpm --filter @aics/ui-office test -- provider-config.test.ts` and verify failure
- [ ] Step 3: Refactor provider-config helpers to separate persisted UI config from secret fields
- [ ] Step 4: Re-run the same test and verify pass

### Task 2: Wire desktop settings to secret commands

**Files:**
- Modify: `packages/ui-office/src/components/settings/SettingsDialog.tsx`
- Modify: `packages/ui-office/src/lib/provider-config.ts`
- Create: `packages/ui-office/src/lib/desktop-provider-secrets.ts`

- [ ] Step 1: Write failing tests for desktop settings save/load behavior with secret status
- [ ] Step 2: Run focused UI tests and verify failure
- [ ] Step 3: Add desktop secret helper module and update settings dialog to use it in Tauri mode
- [ ] Step 4: Re-run focused tests and verify pass

### Task 3: Move runtime secret resolution to Tauri initialization

**Files:**
- Modify: `apps/web/src/lib/tauri-runtime.ts`
- Modify: `apps/web/src/runtime/initialize-runtime.ts`
- Modify: `packages/ui-office/src/components/employees/TestChatTab.tsx`

- [ ] Step 1: Add failing tests around runtime/test-chat secret resolution path where practical
- [ ] Step 2: Run targeted tests and verify failure
- [ ] Step 3: Fetch desktop secrets through Tauri command instead of trusting UI config `apiKey`
- [ ] Step 4: Re-run targeted tests and verify pass

## Chunk 2: MCP Registration Boundary

### Task 4: Add failing tests for registered MCP configs

**Files:**
- Modify: `packages/ui-office/src/components/settings/McpConfigPanel.tsx`
- Modify: `apps/web/src/lib/tauri-mcp-client.ts`
- Create: frontend tests near changed modules

- [ ] Step 1: Write failing tests that stdio connections use `serverId` registration instead of raw command payloads
- [ ] Step 2: Run targeted tests and verify failure
- [ ] Step 3: Update frontend MCP config model and Tauri client calls to use registered server identifiers
- [ ] Step 4: Re-run targeted tests and verify pass

### Task 5: Implement Rust-side MCP registry and connection commands

**Files:**
- Modify: `apps/desktop/src-tauri/src/mcp_bridge/commands.rs`
- Modify: `apps/desktop/src-tauri/src/mcp_bridge/process_manager.rs`
- Modify: `apps/desktop/src-tauri/src/mcp_bridge/types.rs`
- Modify: `apps/desktop/src-tauri/src/mcp_bridge/error.rs`

- [ ] Step 1: Add failing Rust tests for registration validation and registered-server connection flow where practical
- [ ] Step 2: Run `cargo test` for the desktop crate and verify failure
- [ ] Step 3: Add MCP registration store, registered connect command, and validation gates
- [ ] Step 4: Re-run desktop Rust tests and verify pass

### Task 6: Harden MCP process management

**Files:**
- Modify: `apps/desktop/src-tauri/src/mcp_bridge/commands.rs`
- Modify: `apps/desktop/src-tauri/src/mcp_bridge/process_manager.rs`
- Modify: `apps/desktop/src-tauri/src/mcp_bridge/health.rs`
- Modify: `apps/desktop/src-tauri/src/mcp_bridge/jsonrpc_framer.rs`

- [ ] Step 1: Add failing Rust tests or reproducible assertions for per-server locking and bounded messaging where practical
- [ ] Step 2: Run `cargo test` and verify failure
- [ ] Step 3: Refactor registry locking, stderr draining, and channel sizing
- [ ] Step 4: Re-run `cargo test` and verify pass

## Chunk 3: Tauri Surface Reduction and CI

### Task 7: Tighten CSP and desktop capabilities

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src-tauri/capabilities/default.json`

- [ ] Step 1: Add or update tests/checks that lock expected desktop config values where practical
- [ ] Step 2: Run affected validation and verify failure if current config is too broad
- [ ] Step 3: Tighten CSP and capability scopes to match the new architecture
- [ ] Step 4: Re-run affected validation and verify pass

### Task 8: Add missing Rust verification to CI and improve release workflow

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release-desktop.yml`

- [ ] Step 1: Update CI to run Rust fmt, clippy, and cargo test for the desktop crate
- [ ] Step 2: Pin or improve obviously floating release workflow pieces where safe
- [ ] Step 3: Re-read workflow diffs against the design and keep scope limited to this security pass

## Chunk 4: End-to-End Verification

### Task 9: Run full verification for touched surfaces

**Files:**
- Modify: any file required by verification fixes

- [ ] Step 1: Run `pnpm lint`
- [ ] Step 2: Run `pnpm typecheck`
- [ ] Step 3: Run focused package tests for touched TS packages
- [ ] Step 4: Run desktop Rust tests: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- [ ] Step 5: Run affected builds: `pnpm --filter @aics/ui-office build`, `pnpm --filter @aics/web build`
- [ ] Step 6: Fix any verification failures before closing the task
