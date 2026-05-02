# MCP Transport Decision

Last updated: 2026-05-02

## Current Decision

Offisim keeps the current MCP remote posture for this change: local/desktop MCP execution remains `stdio`-first, browser-stored remote entries may still record `sse`, and this change does not migrate runtime code to Streamable HTTP.

This is an intentional deferral, not an unresolved question. Current product work in `close-runtime-binding-and-routing-debt` is about local workspace/root binding, Boss roster correctness, SDK-lane activity truth, and archive cleanup. Changing the remote MCP transport would add server compatibility, auth, reconnect, and UI configuration scope without closing those user-visible defects.

## Context7 Snapshot

- Lookup date: 2026-05-02
- Library: `/modelcontextprotocol/typescript-sdk`
- Package name: `@modelcontextprotocol/sdk`
- Context7 result: the TypeScript SDK documents `StreamableHTTPClientTransport` as the modern remote client transport and shows an implementation pattern that tries Streamable HTTP first, then falls back to `SSEClientTransport` for legacy servers. SDK docs also state that server-side SSE transport is removed/deprecated in v2 while client-side SSE remains for legacy compatibility.

## Current Repo Posture

- Desktop MCP bridge (`apps/desktop/src-tauri/src/mcp_bridge/`) currently executes local MCP processes over JSON-RPC stdio.
- UI config still models MCP transport as `stdio | sse` in `packages/ui-office/src/components/settings/McpConfigPanel.tsx`.
- Desktop registered `sse` entries are refused at connect time today; only stdio is actually launched by the Rust bridge.
- `openspec/protocols-ledger.md` previously tracked MCP transport as drift because it still named SSE as the remote path without a durable migration rule.

## Streamable HTTP Migration Cost

Moving from the current posture to Streamable HTTP is not a rename:

- Client setup: add a new transport type (`http` or equivalent) through settings UI, browser persistence, desktop registry storage, runtime config loaders, and `McpToolExecutor` setup.
- Server expectations: modern servers should serve Streamable HTTP; legacy SSE servers still need compatibility or an explicit unsupported message.
- Auth: remote HTTP needs a stable place for bearer/API-key/header configuration and redaction. The current desktop MCP registry does not have a full remote secret model.
- Reconnect and health: stdio process restart rules do not map directly to remote HTTP session/reconnect behavior.
- Compatibility: existing saved `sse` entries must either be migrated, kept as legacy-client-only entries, or rejected with a clear reason.
- Verification: needs one modern Streamable HTTP MCP server and one legacy SSE server fixture/smoke path before product UI can advertise it.

## Rule

Do not migrate remote MCP transport in `close-runtime-binding-and-routing-debt`.

Migrate when one of these becomes true:

- Product needs to connect to a real remote MCP server that no longer supports SSE.
- Offisim commits to remote MCP as a first-class Settings surface with auth/header storage and live health semantics.
- `@modelcontextprotocol/sdk` client-side SSE support is removed or breaks against the target server set.

Until then:

- `stdio` remains the only desktop MCP bridge transport that can be treated as supported.
- `sse` remains legacy/config compatibility, not a production-supported desktop remote transport.
- Future UI should not advertise Streamable HTTP as complete until the auth/reconnect/server-compat work is done.
