# P3: MCP Full Experience Design — Desktop stdio Bridge + Audit + Permissions

> **Date**: 2026-03-12
> **Status**: Approved
> **Scope**: Production-grade MCP experience for AICS 1.0 Desktop runtime

---

## 1. Problem Statement

AICS has a functional MCP integration (McpToolExecutor, SdkClientFactory, BrowserMcpClientFactory, employee-node tool loop, 25+ tests). Three critical gaps remain for 1.0:

1. **Desktop stdio transport** — `BrowserMcpClientFactory` rejects stdio. Most MCP servers (filesystem, shell, GitHub CLI) use stdio. Desktop users cannot use them.
2. **No audit trail** — Tool calls execute silently. No DB record, no result event, no way to review what tools did.
3. **No permission model** — Every tool call auto-executes. No policy framework for requiring user approval on dangerous operations.
4. **Skill MCP dependencies** — Skills that need MCP servers have no way to declare or detect this requirement.

## 2. Design Principles

- **Rust owns processes, JS owns logic.** Rust spawns/kills/pipes child processes. JS makes all MCP protocol decisions through the existing `McpClientFactory` interface.
- **Zero core changes.** `McpToolExecutor`, `McpClientFactory`, `McpConnection` interfaces stay untouched. New capabilities enter via dependency injection.
- **Audit is mandatory, permissions are extensible.** P1 ships auto-approve + full audit. Permission policies are typed and wired but default to `auto`. P2 adds UI configuration.
- **Graceful degradation.** Browser keeps SSE-only. Desktop adds stdio. Missing MCP servers produce warnings, not errors.

## 3. System Architecture Overview

Five layers, bottom to top:

```
┌─────────────────────────────────────────────────┐
│  Layer 5: Skill Install — required_mcps detect  │
├─────────────────────────────────────────────────┤
│  Layer 4: Audit — tool_calls DB + events        │
├─────────────────────────────────────────────────┤
│  Layer 3: Core (UNCHANGED)                      │
│  McpToolExecutor · employee-node tool loop      │
├─────────────────────────────────────────────────┤
│  Layer 2: TauriMcpClientFactory (JS)            │
│  stdio → Tauri IPC · SSE → SDK direct           │
├─────────────────────────────────────────────────┤
│  Layer 1: Rust mcp_bridge Tauri Plugin          │
│  process spawn/kill · JSON-RPC framing          │
│  health monitor · exponential backoff reconnect │
└─────────────────────────────────────────────────┘
```

---

## 4. Layer 1: Rust `mcp_bridge` Tauri Plugin

### 4.1 File Structure

```
apps/desktop/src-tauri/
  Cargo.toml                          # +tokio, +serde_json
  src/
    lib.rs                            # register mcp_bridge plugin
    mcp_bridge/
      mod.rs                          # plugin registration
      process_manager.rs              # spawn/kill/pipe lifecycle
      jsonrpc_framer.rs               # stdin/stdout JSON-RPC framing
      health.rs                       # health monitor + reconnect state machine
      commands.rs                     # Tauri IPC command handlers
      types.rs                        # Rust-side types
```

### 4.2 Process Management

Each MCP stdio server maps to a `ManagedProcess`:

```rust
struct ManagedProcess {
    child: tokio::process::Child,
    stdin: tokio::io::BufWriter<ChildStdin>,
    stdout_rx: mpsc::Receiver<JsonRpcMessage>,
    config: McpProcessConfig,
    state: ProcessState,
    consecutive_failures: u32,
}

enum ProcessState {
    Starting,
    Ready,
    Unhealthy,
    Dead,
}
```

**State machine:**

```
Starting → Ready        (initialize response received)
Ready → Unhealthy       (health check timeout or consecutive call errors)
Unhealthy → Starting    (automatic reconnect attempt)
Unhealthy → Dead        (max_retries exceeded)
Ready → Dead            (process exited or manual kill)
Dead → Starting         (user-initiated reconnect)
```

**Constraints:**
- `tokio::process::Command` for async spawn (no Tauri main-thread blocking)
- Environment: inherit safe whitelist (`PATH`, `HOME`, `USER`, `LANG`, `TERM`) + merge `config.env` (config takes precedence)
- Graceful shutdown: `SIGTERM` + 5s timeout → `SIGKILL`

### 4.3 JSON-RPC Framing

MCP stdio transport uses newline-delimited JSON (NDJSON), not LSP Content-Length headers.

**Read loop** (runs in dedicated tokio task per server):

```rust
async fn read_loop(stdout: ChildStdout, tx: mpsc::Sender<JsonRpcMessage>) {
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() { continue; }
        match serde_json::from_str::<JsonRpcMessage>(&line) {
            Ok(msg) => tx.send(msg).await?,
            Err(e) => { /* log malformed line, continue */ }
        }
    }
}
```

**Write**: serialize → `\n` → flush.

**Request-response correlation**: `HashMap<i64, oneshot::Sender<JsonRpcMessage>>` keyed by JSON-RPC `id`. Timeout via `tokio::time::timeout` at call site (default 30s for tool calls, 10s for initialize).

### 4.4 Health Monitor + Exponential Backoff Reconnection

```rust
struct HealthMonitor {
    interval: Duration,        // default 30s
    timeout: Duration,         // default 10s
    max_retries: u32,          // default 5
    base_delay: Duration,      // default 1s
    max_delay: Duration,       // default 60s
    jitter: bool,              // true, ±20% random jitter
}
```

**Health detection** (dual signal):
1. `child.try_wait()` — process liveness check
2. Tool call timeouts — if a call times out, increment `consecutive_failures`

No non-standard ping protocol. MCP spec does not define a ping method. Process liveness + call timeout is sufficient and spec-compliant.

**Reconnect sequence:**

```
Failure → wait 1s (±jitter) → retry 1
Failure → wait 2s (±jitter) → retry 2
Failure → wait 4s (±jitter) → retry 3
Failure → wait 8s (±jitter) → retry 4
Failure → wait 16s (±jitter) → retry 5
Failure → mark Dead, emit event to JS
```

Each reconnect performs full MCP `initialize` handshake (capability exchange) and re-discovers tool list (server may have updated).

### 4.5 IPC Commands

| Command | Signature | Description |
|---------|-----------|-------------|
| `mcp_spawn` | `(config: McpProcessConfig) → McpSpawnResult` | Spawn + initialize handshake, return tools |
| `mcp_call_tool` | `(server: String, tool: String, args: Value) → Value` | Send tools/call, await response |
| `mcp_kill` | `(server: String) → ()` | Graceful shutdown |
| `mcp_list_servers` | `() → Vec<McpServerStatus>` | All servers' current state |
| `mcp_reconnect` | `(server: String) → McpSpawnResult` | Manual reconnect trigger |

All commands are `#[tauri::command(async)]`. Errors return via Tauri's `Result<T, String>`.

---

## 5. Layer 2: TauriMcpClientFactory

### 5.1 File

```
apps/web/src/lib/tauri-mcp-client.ts   (NEW)
```

### 5.2 Implementation

```typescript
import { invoke } from '@tauri-apps/api/core';
import type { McpClientFactory, McpConnection, McpServerConfig, McpToolDef } from '@aics/core';

export class TauriMcpClientFactory implements McpClientFactory {
  async createClient(config: McpServerConfig): Promise<McpConnection> {
    if (config.transport === 'sse') {
      // SSE: reuse SDK's SSEClientTransport (tauri-plugin-cors-fetch handles CORS)
      return this.createSseClient(config);
    }

    // stdio: delegate to Rust mcp_bridge
    const result = await invoke<McpSpawnResult>('mcp_spawn', {
      config: {
        name: config.name,
        command: config.command!,
        args: config.args ?? [],
        env: config.env ?? {},
      },
    });

    return {
      config,
      tools: result.tools,
      callTool: (name, args) => invoke('mcp_call_tool', { server: config.name, tool: name, args }),
      close: () => invoke('mcp_kill', { server: config.name }),
    };
  }
}
```

### 5.3 Runtime Injection

In `AicsRuntimeProvider.tsx`:

```typescript
const clientFactory = isTauri()
  ? new TauriMcpClientFactory()
  : new BrowserMcpClientFactory();
```

### 5.4 Behavior Matrix

| Scenario | Browser | Desktop (Tauri) |
|----------|---------|-----------------|
| stdio MCP | ❌ throws | ✅ Rust spawn |
| SSE MCP | ✅ SDK direct | ✅ SDK direct (CORS via plugin) |
| Health monitoring | N/A | ✅ Rust health monitor |
| Auto-reconnect | N/A | ✅ Exponential backoff |

### 5.5 McpConfigPanel UI Fix

Disable stdio option in browser environment:

```typescript
<option value="stdio" disabled={!isTauri()}>
  Stdio (Local){!isTauri() && ' — Desktop only'}
</option>
```

---

## 6. Layer 3: Core (Unchanged)

No modifications to:
- `McpToolExecutor` interface or dispatch logic
- `McpClientFactory` / `McpConnection` / `McpToolDef` types
- Employee-node tool loop
- Existing MCP events (`mcp.server.connected`, `mcp.tool.called`)

All new capabilities enter through dependency injection (factory swap, repo injection).

---

## 7. Layer 4: Audit Model

### 7.1 Database Table

```sql
CREATE TABLE tool_calls (
  tool_call_id   TEXT PRIMARY KEY,
  thread_id      TEXT NOT NULL,
  task_run_id    TEXT,
  employee_id    TEXT NOT NULL,
  server_name    TEXT NOT NULL,
  tool_name      TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_json    TEXT,
  error          TEXT,
  latency_ms     INTEGER NOT NULL,
  approved_by    TEXT,                -- 'auto' | 'user' | null
  created_at     TEXT NOT NULL,

  FOREIGN KEY (thread_id) REFERENCES threads(thread_id)
);

CREATE INDEX idx_tool_calls_thread ON tool_calls(thread_id);
CREATE INDEX idx_tool_calls_employee ON tool_calls(employee_id);
```

### 7.2 Audit Write Point

Inside `McpToolExecutor.execute()`, after tool call completes (success or failure):

```typescript
try {
  await this.repos.toolCalls.create({
    tool_call_id: generateId('tc'),
    thread_id: this.threadId,
    task_run_id: call.taskRunId ?? null,
    employee_id: call.employeeId ?? 'unknown',
    server_name: serverName,
    tool_name: call.name,
    arguments_json: JSON.stringify(call.arguments),
    result_json: success ? JSON.stringify(result) : null,
    error: success ? null : errorMessage,
    latency_ms,
    approved_by: 'auto',
    created_at: new Date().toISOString(),
  });
} catch (dbError) {
  console.error('Failed to record tool call audit:', dbError);
  // Audit failure must not block tool execution
}
```

### 7.3 New Event

```typescript
// shared-types/src/events.ts
export interface McpToolResultPayload {
  readonly serverName: string;
  readonly toolName: string;
  readonly employeeId: string;
  readonly toolCallId: string;
  readonly success: boolean;
  readonly latencyMs: number;
  readonly error?: string;
}

// EventFamily += 'mcp.tool.result'
```

Existing `mcp.tool.called` fires before execution. New `mcp.tool.result` fires after. UI can pair them for "calling..." → "done/failed" transitions.

---

## 8. Layer 4b: Permission Model

### 8.1 Policy Types

```typescript
// packages/core/src/mcp/types.ts
export type ToolApprovalMode = 'auto' | 'ask_first_time' | 'always_ask';

export interface ToolPermissionPolicy {
  readonly defaultMode: ToolApprovalMode;
  readonly overrides: ReadonlyArray<{
    readonly pattern: string;           // glob: "fs_*", "shell_exec", "*"
    readonly mode: ToolApprovalMode;
  }>;
}
```

### 8.2 Execution Flow

```
LLM requests tool call
  → McpToolExecutor.execute()
    → resolve ToolPermissionPolicy for this tool
    → mode === 'auto'?
      YES → execute + audit
      NO  → emit 'mcp.tool.approval.requested'
           → UI shows confirmation dialog
           → User approves → execute + audit (approved_by: 'user')
           → User denies → return { success: false, error: 'User denied tool execution' }
```

### 8.3 P1 Scope

- `defaultMode: 'auto'`, no overrides
- All tools auto-execute with full audit
- `ToolPermissionPolicy` interface defined and wired
- `approved_by` field populated in audit table
- Approval events typed but not emitted:
  - `'mcp.tool.approval.requested'` (P2)
  - `'mcp.tool.approval.resolved'` (P2)

---

## 9. Layer 5: Skill `required_mcps` Detection

### 9.1 Manifest Extension

```typescript
// Skill manifest new field
interface SkillManifest {
  required_mcps?: ReadonlyArray<{
    name: string;                // e.g. "filesystem", "github"
    description: string;
    registry_url?: string;       // official setup guide URL
    transport: 'stdio' | 'sse' | 'either';
  }>;
}
```

### 9.2 Install-time Detection

In `skill-validator.ts`:

```typescript
if (skill.requiredMcps?.length) {
  for (const mcp of skill.requiredMcps) {
    if (!connectedServers.has(mcp.name)) {
      warnings.push({
        type: 'missing_mcp',
        detail: `Skill requires MCP server "${mcp.name}" (${mcp.description}). Configure in Settings → MCP Servers.`,
        severity: 'warning',
      });
    }
  }
}
```

Missing MCP is a **warning, not error** — consistent with `missing_bin` philosophy. Skill installs, related tools just won't be available until the MCP server is configured.

### 9.3 UI Guidance

Install result page renders MCP warnings with actionable links:

```
⚠️ This skill requires MCP server "github"
   Provides: repository search, PR creation, issue management
   [Configure in Settings →]  [View Setup Guide ↗]
```

---

## 10. File Inventory

### New Files (8)

| # | File | Layer |
|---|------|-------|
| 1 | `apps/desktop/src-tauri/src/mcp_bridge/mod.rs` | Rust |
| 2 | `apps/desktop/src-tauri/src/mcp_bridge/process_manager.rs` | Rust |
| 3 | `apps/desktop/src-tauri/src/mcp_bridge/jsonrpc_framer.rs` | Rust |
| 4 | `apps/desktop/src-tauri/src/mcp_bridge/health.rs` | Rust |
| 5 | `apps/desktop/src-tauri/src/mcp_bridge/commands.rs` | Rust |
| 6 | `apps/desktop/src-tauri/src/mcp_bridge/types.rs` | Rust |
| 7 | `apps/web/src/lib/tauri-mcp-client.ts` | JS |
| 8 | DB migration for `tool_calls` table | DB |

### Modified Files (8)

| # | File | Change |
|---|------|--------|
| 1 | `apps/desktop/src-tauri/Cargo.toml` | +tokio, +serde_json deps |
| 2 | `apps/desktop/src-tauri/src/lib.rs` | Register mcp_bridge plugin |
| 3 | `apps/web/src/runtime/AicsRuntimeProvider.tsx` | isTauri() factory swap |
| 4 | `apps/web/src/components/settings/McpConfigPanel.tsx` | Disable stdio in browser |
| 5 | `packages/shared-types/src/events.ts` | +McpToolResultPayload, +mcp.tool.result |
| 6 | `packages/core/src/events/event-factories.ts` | +mcpToolResult factory |
| 7 | `packages/core/src/mcp/mcp-tool-executor.ts` | Audit writes + permission check |
| 8 | `packages/core/src/mcp/types.ts` | +ToolApprovalMode, +ToolPermissionPolicy |

---

## 11. Testing Strategy

| Layer | Test Type | Coverage |
|-------|-----------|----------|
| Rust mcp_bridge | Rust unit tests (`#[cfg(test)]`) | process_manager mock, framer parsing, health state machine |
| TauriMcpClientFactory | Vitest unit (mock invoke) | stdio delegation, SSE passthrough, error propagation |
| Audit | Vitest unit + integration | DB writes on success/failure, audit-failure-doesn't-block |
| Permissions | Vitest unit | Policy resolution, auto-approve path, deny path |
| Skill detection | Vitest unit | missing_mcp warnings, connected servers pass |
| E2E | Manual (Tauri dev) | stdio server spawn → tool call → audit record → reconnect |

---

## 12. P1 vs P2 Scope Boundary

| Feature | P1 (this spec) | P2 (future) |
|---------|----------------|-------------|
| stdio transport | ✅ Full Rust bridge | — |
| SSE transport | ✅ Unchanged | — |
| Health monitor | ✅ Process liveness + call timeout | Configurable per-server thresholds |
| Reconnection | ✅ Exponential backoff, max 5 retries | User-configurable retry policy |
| Audit DB | ✅ tool_calls table, every call | Audit viewer UI, export, retention policy |
| Permission types | ✅ Defined | UI configuration panel |
| Permission enforcement | ✅ Auto-approve only | ask_first_time, always_ask modes |
| Approval UI | ❌ | Confirmation dialog, approval queue |
| required_mcps | ✅ Detection + warning | Auto-install suggestions |
| MCP server registry | ❌ | Marketplace MCP server listings |
