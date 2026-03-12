# P3: MCP Full Experience Design — Desktop stdio Bridge + Audit + Permissions

> **Date**: 2026-03-12
> **Status**: Approved (rev 2 — post spec-review fixes)
> **Scope**: Production-grade MCP experience for AICS 1.0 Desktop runtime

---

## 1. Problem Statement

AICS has a functional MCP integration (McpToolExecutor, SdkClientFactory, BrowserMcpClientFactory, employee-node tool loop, 25+ tests). Four critical gaps remain for 1.0:

1. **Desktop stdio transport** — `BrowserMcpClientFactory` rejects stdio. Most MCP servers (filesystem, shell, GitHub CLI) use stdio. Desktop users cannot use them.
2. **No audit trail** — Tool calls execute silently. No DB record, no result event, no way to review what tools did.
3. **No permission model** — Every tool call auto-executes. No policy framework for requiring user approval on dangerous operations.
4. **Skill MCP dependencies** — Skills that need MCP servers have no way to declare or detect this requirement.

## 2. Design Principles

- **Rust owns processes, JS owns logic.** Rust spawns/kills/pipes child processes. JS makes all MCP protocol decisions through the existing `McpClientFactory` interface.
- **Zero core behavior changes.** `McpToolExecutor`, `McpClientFactory`, `McpConnection` interfaces and dispatch logic stay untouched. Type-only additions to `types.ts` are permitted. Audit is implemented via a decorator wrapper around `ToolExecutor`, not by modifying `McpToolExecutor` internals.
- **Audit is mandatory, permissions are extensible.** P1 ships auto-approve + full audit. Permission policies are typed and wired but default to `auto`. P2 adds UI configuration.
- **Graceful degradation.** Browser keeps SSE-only. Desktop adds stdio. Missing MCP servers produce warnings, not errors.

## 3. System Architecture Overview

Five layers, bottom to top:

```
┌──────────────────────────────────────────────────────┐
│  Layer 5: Skill Install — required_mcps detection    │
├──────────────────────────────────────────────────────┤
│  Layer 4: AuditingToolExecutor (decorator wrapper)   │
│  mcp_audit_log DB · mcp.tool.result event            │
├──────────────────────────────────────────────────────┤
│  Layer 3: Core (UNCHANGED behavior)                  │
│  McpToolExecutor · employee-node tool loop           │
├──────────────────────────────────────────────────────┤
│  Layer 2: TauriMcpClientFactory (JS)                 │
│  stdio → Tauri IPC · SSE → SDK direct (composition)  │
├──────────────────────────────────────────────────────┤
│  Layer 1: Rust mcp_bridge Tauri Plugin               │
│  process spawn/kill · JSON-RPC framing               │
│  health monitor · exponential backoff reconnect      │
└──────────────────────────────────────────────────────┘
```

---

## 4. Layer 1: Rust `mcp_bridge` Tauri Plugin

### 4.1 File Structure

```
apps/desktop/src-tauri/
  Cargo.toml                          # +tokio (features: ["process"]), +thiserror
  src/
    lib.rs                            # register mcp_bridge plugin via .plugin(mcp_bridge::init())
    mcp_bridge/
      mod.rs                          # pub fn init() -> TauriPlugin<Wry> { ... }
      process_manager.rs              # spawn/kill/pipe lifecycle
      jsonrpc_framer.rs               # stdin/stdout JSON-RPC framing
      health.rs                       # health monitor + reconnect state machine
      commands.rs                     # Tauri IPC command handlers
      types.rs                        # Rust-side types
      error.rs                        # thiserror enum for structured errors
```

### 4.2 Rust Types (`types.rs`)

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct McpProcessConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,  // merged with safe whitelist
}

#[derive(Debug, Clone, Serialize)]
pub struct McpSpawnResult {
    pub server_name: String,
    pub tools: Vec<McpToolInfo>,
    pub state: String,  // "ready"
}

#[derive(Debug, Clone, Serialize)]
pub struct McpToolInfo {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpServerStatus {
    pub name: String,
    pub state: String,       // "starting" | "ready" | "unhealthy" | "dead"
    pub tool_count: u32,
    pub consecutive_failures: u32,
    pub pid: Option<u32>,
}
```

### 4.3 Rust Error Types (`error.rs`)

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum McpBridgeError {
    #[error("Server '{0}' not found")]
    ServerNotFound(String),
    #[error("Server '{0}' is not ready (state: {1})")]
    ServerNotReady(String, String),
    #[error("Failed to spawn process: {0}")]
    SpawnFailed(String),
    #[error("Initialize handshake failed: {0}")]
    InitFailed(String),
    #[error("Tool call timed out after {0}ms")]
    CallTimeout(u64),
    #[error("JSON-RPC error: code={code}, message={message}")]
    JsonRpcError { code: i64, message: String },
    #[error("Process exited unexpectedly with code {0:?}")]
    ProcessExited(Option<i32>),
}

// Implement Into<tauri::ipc::InvokeError> for Tauri command returns
impl From<McpBridgeError> for tauri::ipc::InvokeError {
    fn from(e: McpBridgeError) -> Self {
        tauri::ipc::InvokeError::from(e.to_string())
    }
}
```

### 4.4 Plugin Registration

In `mod.rs`:

```rust
use tauri::{plugin::{Builder, TauriPlugin}, Wry};

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("mcp_bridge")
        .invoke_handler(tauri::generate_handler![
            commands::mcp_spawn,
            commands::mcp_call_tool,
            commands::mcp_kill,
            commands::mcp_list_servers,
            commands::mcp_reconnect,
        ])
        .setup(|app, _api| {
            app.manage(ProcessRegistry::new());
            Ok(())
        })
        .build()
}
```

In `lib.rs`:

```rust
mod mcp_bridge;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_cors_fetch::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(mcp_bridge::init())        // NEW
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 4.5 Process Management

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
- Environment whitelist: inherit `PATH`, `HOME`, `USER`, `LANG`, `TERM`, `SHELL`, `TMPDIR`, `LC_ALL`, `LC_CTYPE`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` + merge `config.env` (config keys take precedence over inherited)
- Graceful shutdown (cross-platform):
  - macOS/Linux: `SIGTERM` + 5s timeout → `SIGKILL`
  - Windows: `TerminateProcess` (no graceful equivalent; 1.0 targets macOS/Linux, Windows is best-effort)

### 4.6 JSON-RPC Framing

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
            Err(e) => { /* log malformed line, continue — don't kill process */ }
        }
    }
}
```

**Write**: serialize → `\n` → flush.

**Request-response correlation**: `HashMap<i64, oneshot::Sender<JsonRpcMessage>>` keyed by JSON-RPC `id`. Timeout via `tokio::time::timeout` at call site (default 30s for tool calls, 10s for initialize).

### 4.7 Health Monitor + Exponential Backoff Reconnection

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
1. `child.try_wait()` — process liveness check (periodic, every `interval`)
2. Tool call timeouts — if a call times out, increment `consecutive_failures`; 3 consecutive → Unhealthy

No non-standard ping protocol. MCP spec does not define a ping method. Process liveness + call timeout is sufficient and spec-compliant.

**Reconnect sequence:**

```
Failure → wait 1s (±jitter) → retry 1
Failure → wait 2s (±jitter) → retry 2
Failure → wait 4s (±jitter) → retry 3
Failure → wait 8s (±jitter) → retry 4
Failure → wait 16s (±jitter) → retry 5
Failure → mark Dead, emit event to JS via Tauri event
```

Each reconnect performs full MCP `initialize` handshake (capability exchange) and re-discovers tool list (server may have updated).

### 4.8 IPC Commands

| Command | Signature | Description |
|---------|-----------|-------------|
| `mcp_spawn` | `(config: McpProcessConfig) → Result<McpSpawnResult, McpBridgeError>` | Spawn + initialize handshake, return tools |
| `mcp_call_tool` | `(server: String, tool: String, args: Value) → Result<Value, McpBridgeError>` | Send tools/call, await response |
| `mcp_kill` | `(server: String) → Result<(), McpBridgeError>` | Graceful shutdown |
| `mcp_list_servers` | `() → Vec<McpServerStatus>` | All servers' current state |
| `mcp_reconnect` | `(server: String) → Result<McpSpawnResult, McpBridgeError>` | Manual reconnect trigger |

All commands are `#[tauri::command(async)]`.

---

## 5. Layer 2: TauriMcpClientFactory

### 5.1 File

```
apps/web/src/lib/tauri-mcp-client.ts   (NEW)
```

### 5.2 JS-side Types

```typescript
// Mirrors Rust types for Tauri IPC serialization
interface McpSpawnResult {
  server_name: string;
  tools: Array<{ name: string; description: string; input_schema: unknown }>;
  state: string;
}

interface McpServerStatus {
  name: string;
  state: 'starting' | 'ready' | 'unhealthy' | 'dead';
  tool_count: number;
  consecutive_failures: number;
  pid: number | null;
}
```

### 5.3 Implementation

SSE path is implemented via **composition** — an internal `BrowserMcpClientFactory` instance handles SSE connections. This avoids code duplication.

```typescript
import { invoke } from '@tauri-apps/api/core';
import type { McpClientFactory, McpConnection, McpServerConfig, McpToolDef } from '@aics/core';
import { BrowserMcpClientFactory } from './browser-mcp-client';

export class TauriMcpClientFactory implements McpClientFactory {
  private readonly sseFallback = new BrowserMcpClientFactory();

  async createClient(config: McpServerConfig): Promise<McpConnection> {
    if (config.transport === 'sse') {
      // SSE: delegate to BrowserMcpClientFactory (tauri-plugin-cors-fetch handles CORS)
      return this.sseFallback.createClient(config);
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

    const tools: McpToolDef[] = result.tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema,
    }));

    return {
      config,
      tools,
      callTool: (name, args) => invoke('mcp_call_tool', {
        server: config.name, tool: name, args,
      }),
      close: () => invoke('mcp_kill', { server: config.name }),
    };
  }
}
```

### 5.4 Runtime Injection

In `AicsRuntimeProvider.tsx`:

```typescript
import { isTauri } from './env';

const clientFactory = isTauri()
  ? new TauriMcpClientFactory()
  : new BrowserMcpClientFactory();

const mcpToolExecutor = new McpToolExecutor({
  eventBus,
  companyId: COMPANY_ID,
  clientFactory,
});
```

### 5.5 Behavior Matrix

| Scenario | Browser | Desktop (Tauri) |
|----------|---------|-----------------|
| stdio MCP | ❌ throws | ✅ Rust spawn |
| SSE MCP | ✅ SDK direct | ✅ SDK direct (via BrowserMcpClientFactory composition) |
| Health monitoring | N/A | ✅ Rust health monitor |
| Auto-reconnect | N/A | ✅ Exponential backoff |

### 5.6 McpConfigPanel UI Fix

Disable stdio option in browser environment:

```typescript
<option value="stdio" disabled={!isTauri()}>
  Stdio (Local){!isTauri() && ' — Desktop only'}
</option>
```

---

## 6. Layer 3: Core (Unchanged Behavior)

No modifications to behavior or interfaces:
- `McpToolExecutor` class — no new deps, no new methods
- `McpClientFactory` / `McpConnection` / `McpToolDef` interfaces — untouched
- `ToolExecutor` interface (`tool-executor.ts`) — untouched
- Employee-node tool loop — untouched
- Existing MCP events (`mcp.server.connected`, `mcp.tool.called`) — untouched

Type-only additions to `packages/core/src/mcp/types.ts` (see §8.1) and new event types in `shared-types` (see §7.3) are the only changes in core packages. These are additive and non-breaking.

---

## 7. Layer 4: Audit Model

### 7.1 Database Table — `mcp_audit_log` (NEW table, not modifying existing `tool_calls`)

The existing `tool_calls` table (schema.ts L254-274) tracks Rack/Slot tool execution with `task_run_id` FK → `task_runs`, `rack_id` FK → `racks`, `status`, `review_state` fields. This is a different domain (capability-based tool management).

MCP audit needs a separate table with different semantics:

**Migration file**: `packages/db-local/migrations/007_mcp_audit_log.sql`

```sql
CREATE TABLE IF NOT EXISTS mcp_audit_log (
  audit_id       TEXT PRIMARY KEY,
  thread_id      TEXT NOT NULL REFERENCES graph_threads(thread_id),
  task_run_id    TEXT REFERENCES task_runs(task_run_id) ON DELETE SET NULL,
  employee_id    TEXT NOT NULL,
  server_name    TEXT NOT NULL,
  tool_name      TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_json    TEXT,
  error          TEXT,
  latency_ms     INTEGER NOT NULL,
  approved_by    TEXT NOT NULL DEFAULT 'auto',  -- 'auto' | 'user'
  created_at     TEXT NOT NULL
);

CREATE INDEX idx_mcp_audit_thread ON mcp_audit_log(thread_id);
CREATE INDEX idx_mcp_audit_employee ON mcp_audit_log(employee_id);
CREATE INDEX idx_mcp_audit_server ON mcp_audit_log(server_name);
```

**Drizzle schema addition** in `packages/db-local/src/schema.ts`:

```typescript
export const mcpAuditLog = sqliteTable(
  'mcp_audit_log',
  {
    audit_id: text('audit_id').primaryKey(),
    thread_id: text('thread_id').notNull()
      .references(() => graphThreads.thread_id),
    task_run_id: text('task_run_id')
      .references(() => taskRuns.task_run_id, { onDelete: 'set null' }),
    employee_id: text('employee_id').notNull(),
    server_name: text('server_name').notNull(),
    tool_name: text('tool_name').notNull(),
    arguments_json: text('arguments_json').notNull(),
    result_json: text('result_json'),
    error: text('error'),
    latency_ms: integer('latency_ms').notNull(),
    approved_by: text('approved_by').notNull().default('auto'),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    index('idx_mcp_audit_thread').on(table.thread_id),
    index('idx_mcp_audit_employee').on(table.employee_id),
    index('idx_mcp_audit_server').on(table.server_name),
  ],
);
```

**Tauri migration**: `apps/desktop/src-tauri/migrations/007_mcp_audit_log.sql` (same SQL).

### 7.2 Repository Interface

In `packages/core/src/runtime/repositories.ts`:

```typescript
export interface McpAuditRow {
  audit_id: string;
  thread_id: string;
  task_run_id: string | null;
  employee_id: string;
  server_name: string;
  tool_name: string;
  arguments_json: string;
  result_json: string | null;
  error: string | null;
  latency_ms: number;
  approved_by: string;
  created_at: string;
}

export type NewMcpAudit = Omit<McpAuditRow, never>;  // all fields required on create

export interface McpAuditRepository {
  create(audit: NewMcpAudit): Promise<McpAuditRow>;
  listByThread(threadId: string): Promise<McpAuditRow[]>;
}
```

### 7.3 Audit Write Point — `AuditingToolExecutor` Decorator

Instead of modifying `McpToolExecutor` (which would require adding `repos`, `threadId` to its deps), we use a **decorator wrapper** that implements `ToolExecutor`:

**File**: `packages/core/src/mcp/auditing-tool-executor.ts` (NEW)

```typescript
import type { ToolExecutor, ToolCallRequest, ToolCallResponse, ToolDef } from '../runtime/tool-executor.js';
import type { McpAuditRepository } from '../runtime/repositories.js';
import type { EventBus } from '../events/event-bus.js';
import { generateId } from '../utils/generate-id.js';
import { mcpToolResult } from '../events/event-factories.js';

export class AuditingToolExecutor implements ToolExecutor {
  constructor(
    private readonly inner: ToolExecutor,
    private readonly auditRepo: McpAuditRepository,
    private readonly eventBus: EventBus,
    private readonly companyId: string,
    private readonly threadId: string,
  ) {}

  async listAvailable(companyId: string): Promise<ToolDef[]> {
    return this.inner.listAvailable(companyId);
  }

  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    const auditId = generateId('ma');
    const startedAt = Date.now();

    const response = await this.inner.execute(call);
    const latencyMs = Date.now() - startedAt;

    // Audit write — failure must not block tool result
    try {
      await this.auditRepo.create({
        audit_id: auditId,
        thread_id: this.threadId,
        task_run_id: null,  // extracted from call context if available
        employee_id: call.employeeId ?? 'unknown',
        server_name: this.resolveServerName(call.name),
        tool_name: call.name,
        arguments_json: JSON.stringify(call.arguments),
        result_json: response.success ? JSON.stringify(response.result) : null,
        error: response.success ? null : (response.error ?? null),
        latency_ms: latencyMs,
        approved_by: 'auto',
        created_at: new Date().toISOString(),
      });
    } catch (dbError) {
      console.error('Failed to record MCP audit:', dbError);
    }

    // Emit result event
    this.eventBus.emit(
      mcpToolResult(this.companyId, call.name, call.employeeId ?? 'unknown',
        auditId, response.success, latencyMs, response.error),
    );

    return response;
  }

  private resolveServerName(toolName: string): string {
    // McpToolExecutor maintains toolServerMap internally;
    // since we wrap ToolExecutor (not McpToolExecutor), we record the tool name.
    // If inner is McpToolExecutor, we can cast to access the server name.
    // Fallback: use tool name as identifier.
    return toolName;
  }
}
```

**Injection in `AicsRuntimeProvider.tsx`**:

```typescript
const mcpToolExecutor = new McpToolExecutor({ eventBus, companyId, clientFactory });

// Wrap with auditing decorator
const toolExecutor = new AuditingToolExecutor(
  mcpToolExecutor,
  repos.mcpAudit,
  eventBus,
  companyId,
  threadId,
);

// Pass toolExecutor (auditing wrapper) into RuntimeContext
```

This preserves `McpToolExecutor` exactly as-is. Audit is purely additive.

### 7.4 New Event

```typescript
// shared-types/src/events.ts — NEW
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

**Event factory** in `event-factories.ts`:

```typescript
export function mcpToolResult(
  companyId: string,
  toolName: string,
  employeeId: string,
  toolCallId: string,
  success: boolean,
  latencyMs: number,
  error?: string,
): AicsEvent<McpToolResultPayload> { ... }
```

Existing `mcp.tool.called` fires before execution. New `mcp.tool.result` fires after. UI can pair them for "calling..." → "done/failed" transitions.

---

## 8. Layer 4b: Permission Model

### 8.1 Policy Types

Added to `packages/core/src/mcp/types.ts` (type-only, no behavior change):

```typescript
export type ToolApprovalMode = 'auto' | 'ask_first_time' | 'always_ask';

export interface ToolPermissionPolicy {
  readonly defaultMode: ToolApprovalMode;
  readonly overrides: ReadonlyArray<{
    readonly pattern: string;           // glob: "fs_*", "shell_exec", "*"
    readonly mode: ToolApprovalMode;
  }>;
}
```

### 8.2 Execution Flow (P2 — defined here for architecture clarity)

```
LLM requests tool call
  → AuditingToolExecutor.execute()
    → resolve ToolPermissionPolicy for this tool
    → mode === 'auto'?
      YES → delegate to inner.execute() + audit
      NO  → emit 'mcp.tool.approval.requested'
           → UI shows confirmation dialog
           → User approves → execute + audit (approved_by: 'user')
           → User denies → return { success: false, error: 'User denied tool execution' }
```

### 8.3 P1 Scope

- `defaultMode: 'auto'`, no overrides
- All tools auto-execute with full audit
- `ToolPermissionPolicy` interface defined
- `approved_by` field populated in audit table ('auto' for all P1 calls)
- Approval events typed but not emitted:
  - `'mcp.tool.approval.requested'` (P2)
  - `'mcp.tool.approval.resolved'` (P2)

---

## 9. Layer 5: Skill `required_mcps` Detection

### 9.1 OpenClaw YAML Frontmatter Extension

Skills declare MCP requirements in YAML frontmatter:

```yaml
---
name: GitHub Assistant
description: Manages PRs and issues
required-mcps:
  - name: github
    description: GitHub API access via MCP
    transport: stdio
    registry-url: https://github.com/modelcontextprotocol/servers/tree/main/src/github
  - name: filesystem
    description: Local file read/write
    transport: stdio
---

[skill instructions here]
```

### 9.2 ParsedSkill Type Extension

In `packages/install-core/src/openclaw/types.ts`:

```typescript
export interface RequiredMcp {
  readonly name: string;
  readonly description: string;
  readonly transport: 'stdio' | 'sse' | 'either';
  readonly registryUrl?: string;
}

// Add to SkillRequirements:
export interface SkillRequirements {
  readonly bins: readonly string[];
  readonly env: readonly string[];
  readonly config: readonly string[];
  readonly mcps: readonly RequiredMcp[];  // NEW
}
```

### 9.3 Parser Update

In `packages/install-core/src/openclaw/skill-parser.ts`, extract `required-mcps` from frontmatter into `requirements.mcps`.

### 9.4 skill-to-manifest Mapping

In `packages/install-core/src/openclaw/skill-to-manifest.ts` (L73-76), replace hardcoded `required_mcps: []`:

```typescript
requirements: {
  required_capabilities: [],
  required_mcps: parsed.requirements.mcps.map(m => ({
    name: m.name,
    description: m.description,
    transport: m.transport,
    registry_url: m.registryUrl,
  })),
},
```

### 9.5 Install-time Validation

In `skill-validator.ts`, `validateSkill` signature extended:

```typescript
export function validateSkill(
  skill: ParsedSkill,
  environment: SupportedEnvironment,
  connectedMcpServers?: ReadonlySet<string>,  // NEW — names of currently connected servers
): SkillValidationResult {
  // ... existing checks ...

  if (skill.requirements.mcps.length > 0 && connectedMcpServers) {
    for (const mcp of skill.requirements.mcps) {
      if (!connectedMcpServers.has(mcp.name)) {
        warnings.push({
          type: 'missing_mcp',
          detail: `Skill requires MCP server "${mcp.name}" (${mcp.description}). Configure in Settings → MCP Servers.`,
          severity: 'warning',
        });
      }
    }
  }
}
```

Missing MCP is a **warning, not error** — consistent with `missing_bin` philosophy. Skill installs; related tools just won't be available until the MCP server is configured.

### 9.6 UI Guidance

Install result page renders MCP warnings with actionable links:

```
⚠️ This skill requires MCP server "github"
   Provides: GitHub API access via MCP
   [Configure in Settings →]  [View Setup Guide ↗]
```

- "Configure in Settings" navigates to McpConfigPanel
- "View Setup Guide" opens `registryUrl` in external browser

---

## 10. File Inventory

### New Files (10)

| # | File | Layer |
|---|------|-------|
| 1 | `apps/desktop/src-tauri/src/mcp_bridge/mod.rs` | Rust |
| 2 | `apps/desktop/src-tauri/src/mcp_bridge/process_manager.rs` | Rust |
| 3 | `apps/desktop/src-tauri/src/mcp_bridge/jsonrpc_framer.rs` | Rust |
| 4 | `apps/desktop/src-tauri/src/mcp_bridge/health.rs` | Rust |
| 5 | `apps/desktop/src-tauri/src/mcp_bridge/commands.rs` | Rust |
| 6 | `apps/desktop/src-tauri/src/mcp_bridge/types.rs` | Rust |
| 7 | `apps/desktop/src-tauri/src/mcp_bridge/error.rs` | Rust |
| 8 | `apps/web/src/lib/tauri-mcp-client.ts` | JS |
| 9 | `packages/core/src/mcp/auditing-tool-executor.ts` | JS |
| 10 | `packages/db-local/migrations/007_mcp_audit_log.sql` | DB |

### Modified Files (10)

| # | File | Change |
|---|------|--------|
| 1 | `apps/desktop/src-tauri/Cargo.toml` | +tokio (features: ["process"]), +thiserror |
| 2 | `apps/desktop/src-tauri/src/lib.rs` | `.plugin(mcp_bridge::init())` |
| 3 | `apps/web/src/runtime/AicsRuntimeProvider.tsx` | isTauri() factory swap + AuditingToolExecutor wrapping |
| 4 | `apps/web/src/components/settings/McpConfigPanel.tsx` | Disable stdio in browser |
| 5 | `packages/shared-types/src/events.ts` | +McpToolResultPayload, +`mcp.tool.result` |
| 6 | `packages/core/src/events/event-factories.ts` | +mcpToolResult factory |
| 7 | `packages/core/src/mcp/types.ts` | +ToolApprovalMode, +ToolPermissionPolicy (types only) |
| 8 | `packages/core/src/runtime/repositories.ts` | +McpAuditRow, +McpAuditRepository |
| 9 | `packages/db-local/src/schema.ts` | +mcpAuditLog table |
| 10 | `packages/install-core/src/openclaw/types.ts` | +RequiredMcp, extend SkillRequirements |

### Also Modified (install-core chain)

| # | File | Change |
|---|------|--------|
| 11 | `packages/install-core/src/openclaw/skill-parser.ts` | Parse `required-mcps` frontmatter |
| 12 | `packages/install-core/src/openclaw/skill-to-manifest.ts` | Map mcps to manifest |
| 13 | `packages/install-core/src/openclaw/skill-validator.ts` | +connectedMcpServers param, missing_mcp warnings |

---

## 11. Testing Strategy

| Layer | Test Type | Coverage |
|-------|-----------|----------|
| Rust mcp_bridge | `#[cfg(test)]` unit tests | process state machine, framer NDJSON parsing, health backoff timing, error types |
| TauriMcpClientFactory | Vitest unit (mock `invoke`) | stdio → IPC delegation, SSE → BrowserMcpClientFactory composition, error propagation |
| AuditingToolExecutor | Vitest unit | DB writes on success/failure, audit-failure-doesn't-block, event emission |
| McpAuditRepository | Vitest + memory impl | CRUD operations |
| Permissions | Vitest unit | Policy resolution, auto-approve path (P1), deny path type-check |
| Skill detection | Vitest unit | ParsedSkill with mcps → warnings, connected servers pass, validator signature |
| E2E | Manual (Tauri dev) | stdio server spawn → tool call → audit record in DB → kill → reconnect |

---

## 12. P1 vs P2 Scope Boundary

| Feature | P1 (this spec) | P2 (future) |
|---------|----------------|-------------|
| stdio transport | ✅ Full Rust bridge | — |
| SSE transport | ✅ Unchanged (composition) | — |
| Health monitor | ✅ Process liveness + call timeout | Configurable per-server thresholds |
| Reconnection | ✅ Exponential backoff, max 5 retries | User-configurable retry policy |
| Audit DB | ✅ `mcp_audit_log` table, every call | Audit viewer UI, export, retention policy |
| Permission types | ✅ Defined in types.ts | UI configuration panel |
| Permission enforcement | ✅ Auto-approve only | `ask_first_time`, `always_ask` modes |
| Approval UI | ❌ | Confirmation dialog, approval queue |
| required_mcps | ✅ Detection + warning | Auto-install suggestions |
| MCP server registry | ❌ | Marketplace MCP server listings |
| Windows support | Best-effort (TerminateProcess) | Full parity if demand warrants |

---

## Appendix: Spec Review Issues Addressed (rev 2)

| ID | Issue | Resolution |
|----|-------|------------|
| C1 | Audit table conflicts with existing `tool_calls` | Renamed to `mcp_audit_log`, completely separate table |
| C2 | Audit write assumes McpToolExecutor has repos/threadId | AuditingToolExecutor decorator pattern, wraps ToolExecutor |
| C3 | FK references `threads` (wrong table name) | Fixed to `graph_threads` |
| I1 | McpProcessConfig/McpSpawnResult undefined | Full Rust struct definitions added (§4.2) |
| I2 | SSE path implementation unclear | Composition: internal BrowserMcpClientFactory instance |
| I3 | Env whitelist too restrictive | Expanded: +SHELL, TMPDIR, LC_ALL, LC_CTYPE, XDG_CONFIG_HOME, XDG_DATA_HOME |
| I4 | "Zero core changes" contradicts type additions | Rephrased to "Zero core behavior changes" |
| I5 | required_mcps integration with ParsedSkill unclear | Full chain: YAML frontmatter → SkillRequirements.mcps → manifest → validator |
| I6 | Plugin registration unspecified | Explicit `tauri::plugin::Builder` pattern with `init()` function |
| S1 | tokio dep too broad | `tokio = { features = ["process"] }` only |
| S2 | Migration number unspecified | 007_mcp_audit_log.sql |
| S3 | String errors in Rust | thiserror enum `McpBridgeError` |
| S4 | connectedServers data source | Optional parameter on validateSkill() |
| S5 | Windows graceful shutdown | Documented: TerminateProcess, macOS/Linux primary |
