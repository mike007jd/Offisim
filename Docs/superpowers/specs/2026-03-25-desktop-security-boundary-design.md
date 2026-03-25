# Desktop Security Boundary Design

## Goal

Rebuild the Tauri desktop security boundary so Offisim keeps local-first power without leaving secrets, local process execution, and broad native capabilities exposed to arbitrary WebView code.

## Context

The current desktop runtime has four coupled weaknesses:

- provider API keys are persisted in browser-readable storage
- WebView code can create LLM gateways with raw secrets
- stdio MCP startup accepts arbitrary `command/args/env` directly from the frontend
- default Tauri permissions and CSP are broader than the product needs

This violates the repository constitution in two ways:

- permissions are not following least privilege
- dangerous local execution can be reached through frontend-controlled paths rather than explicit user-granted desktop configuration

## Non-Negotiable Outcomes

- API keys never persist in `localStorage` or any other JS-readable durable store
- desktop runtime may only execute MCP stdio servers that were explicitly registered by the user in desktop settings
- package manifests, deep links, remote content, and frontend state may reference registered MCP servers, but may not define new executable commands
- default Tauri capabilities must be reduced to the minimum required for the shipped desktop shell
- CSP must stop relying on `unsafe-inline` and `unsafe-eval`

## Architecture

### 1. Provider Config Split

Split provider configuration into two layers:

- non-secret provider settings:
  - `provider`
  - `model`
  - `baseURL`
  - `defaultHeaders`
  - subscription-only non-secret fields
- secret material:
  - `apiKey`

The non-secret layer remains available to the UI. The secret layer moves to Rust-managed desktop storage and is only fetched at runtime initialization time when a gateway needs it.

### 2. Desktop Secret Commands

Add Tauri commands for provider secret lifecycle:

- `provider_secret_status`
- `provider_secret_set`
- `provider_secret_get`
- `provider_secret_clear`

The frontend settings UI uses these commands in desktop mode. Browser mode keeps the existing browser-only flow because the browser build has no trusted OS-side secret store.

### 3. MCP Registration Boundary

Replace direct stdio spawning with a registered-server model.

New rule:

- frontend may submit MCP registration data through an explicit settings flow
- runtime connection uses a stable `server_id`
- Rust resolves `server_id` to the registered command definition and starts the process

This prevents arbitrary command execution from localStorage payloads, deep links, assets, or runtime-injected frontend code.

### 4. Rust MCP Runtime Hardening

The MCP bridge must also be made operationally safe:

- registry stores per-server handles behind independent async locks
- no global registry lock is held across tool-call or health-check awaits
- stderr is drained in a background task
- message channels become bounded
- registration-time validation rejects malformed or incomplete stdio definitions

### 5. Tauri Capability and CSP Reduction

Security posture changes:

- remove `unsafe-inline` and `unsafe-eval` from CSP
- remove broad frontend SQL write authority where possible
- narrow filesystem scope to explicit app-owned paths and user-approved flows
- keep local networking capability only if required by the desktop LLM path, and document why

## Compatibility Strategy

No long-term compatibility layer is required because the product is not launched yet.

A one-time best-effort cleanup is still useful:

- new desktop code should ignore legacy secret-bearing `localStorage` provider blobs
- once the new settings flow saves a provider, the frontend durable config must contain no `apiKey`
- existing MCP localStorage entries should be treated as display-only legacy data and not trusted as executable registration records

## Affected Areas

- `packages/ui-office/src/lib/provider-config.ts`
- `packages/ui-office/src/components/settings/SettingsDialog.tsx`
- `packages/ui-office/src/components/settings/McpConfigPanel.tsx`
- `packages/ui-office/src/components/employees/TestChatTab.tsx`
- `apps/web/src/lib/tauri-runtime.ts`
- `apps/web/src/runtime/AicsRuntimeProvider.tsx`
- `apps/web/src/lib/tauri-mcp-client.ts`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/mcp_bridge/*`
- `apps/desktop/src-tauri/capabilities/default.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `.github/workflows/ci.yml`
- `.github/workflows/release-desktop.yml`

## Testing Strategy

- add frontend tests for provider secret separation and desktop settings behavior
- add Rust tests for MCP registration validation and per-server registry behavior where practical
- run focused package tests for changed TS modules
- run repo lint and typecheck
- run affected builds

## Success Criteria

- desktop provider saves no API key to browser storage
- desktop runtime still initializes and can call the configured provider
- MCP stdio connection path no longer accepts raw commands from the runtime call site
- Tauri config is materially tighter than before
- validation passes for touched packages and desktop Rust code
