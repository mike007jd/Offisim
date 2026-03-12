# P3 MCP Full Experience — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production-grade MCP stdio support via Tauri Rust bridge, tool call audit trail, permission type system, and skill `required_mcps` detection.

**Architecture:** Rust `mcp_bridge` Tauri plugin manages subprocess lifecycle (spawn/kill/pipe, JSON-RPC NDJSON framing, health monitor with exponential backoff). JS-side `TauriMcpClientFactory` wraps IPC calls behind existing `McpClientFactory` interface. `AuditingToolExecutor` decorator wraps `ToolExecutor` to write `mcp_audit_log` records without modifying `McpToolExecutor`. Skill `required_mcps` flows through parser → manifest → validator chain.

**Tech Stack:** Rust (tokio::process, serde_json, thiserror), TypeScript, Tauri 2 IPC, SQLite (Drizzle ORM), Vitest

**Spec:** `Docs/superpowers/specs/2026-03-12-mcp-full-experience-design.md`

---

## Chunk 1: Foundation — Types, Events, DB Migration, Repository

Shared types and DB schema that all subsequent chunks depend on.

### Task 1: Add `mcp.tool.result` event type + `McpToolResultPayload`

**Files:**
- Modify: `packages/shared-types/src/events.ts`
- Modify: `packages/shared-types/src/index.ts`

- [ ] **Step 1: Add McpToolResultPayload and EventFamily entry**

In `packages/shared-types/src/events.ts`, after `McpToolCalledPayload` (line 197):

```typescript
export interface McpToolResultPayload {
  readonly serverName: string;
  readonly toolName: string;
  readonly employeeId: string;
  readonly toolCallId: string;
  readonly success: boolean;
  readonly latencyMs: number;
  readonly error?: string;
}
```

In the `EventFamily` union (around line 46), after `'mcp.tool.called'`:

```typescript
  | 'mcp.tool.result'
```

- [ ] **Step 2: Export new payload from index**

In `packages/shared-types/src/index.ts`, add `McpToolResultPayload` to the events re-export.

- [ ] **Step 3: Build shared-types to verify**

Run: `cd packages/shared-types && pnpm build`
Expected: Success, no errors

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/src/events.ts packages/shared-types/src/index.ts
git commit -m "feat(shared-types): add McpToolResultPayload and mcp.tool.result event"
```

### Task 2: Add `mcpToolResult` event factory

**Files:**
- Modify: `packages/core/src/events/event-factories.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add factory function**

In `packages/core/src/events/event-factories.ts`, after `mcpToolCalled` (line 372):

```typescript
export function mcpToolResult(
  companyId: string,
  serverName: string,
  toolName: string,
  employeeId: string,
  toolCallId: string,
  success: boolean,
  latencyMs: number,
  error?: string,
): RuntimeEvent<McpToolResultPayload> {
  return {
    type: 'mcp.tool.result',
    entityId: `${serverName}/${toolName}`,
    entityType: 'mcp',
    companyId,
    timestamp: Date.now(),
    payload: { serverName, toolName, employeeId, toolCallId, success, latencyMs, error },
  };
}
```

Add `McpToolResultPayload` to the imports from `@aics/shared-types`.

- [ ] **Step 2: Export from barrel**

In `packages/core/src/index.ts`, add `mcpToolResult` to the event-factories export.

- [ ] **Step 3: Typecheck**

Run: `pnpm turbo run typecheck --filter=@aics/core`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/events/event-factories.ts packages/core/src/index.ts
git commit -m "feat(core): add mcpToolResult event factory"
```

### Task 3: Add `ToolApprovalMode` and `ToolPermissionPolicy` types

**Files:**
- Modify: `packages/core/src/mcp/types.ts`

- [ ] **Step 1: Add types**

At the end of `packages/core/src/mcp/types.ts` (after `McpClientFactory`, line 42):

```typescript
/** P1: auto-approve all. P2 adds ask_first_time and always_ask enforcement. */
export type ToolApprovalMode = 'auto' | 'ask_first_time' | 'always_ask';

export interface ToolPermissionPolicy {
  readonly defaultMode: ToolApprovalMode;
  readonly overrides: ReadonlyArray<{
    readonly pattern: string;
    readonly mode: ToolApprovalMode;
  }>;
}
```

- [ ] **Step 2: Export from barrel**

Ensure `ToolApprovalMode` and `ToolPermissionPolicy` are exported from `packages/core/src/index.ts` (the MCP types line).

- [ ] **Step 3: Typecheck**

Run: `pnpm turbo run typecheck --filter=@aics/core`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/mcp/types.ts packages/core/src/index.ts
git commit -m "feat(core): add ToolApprovalMode and ToolPermissionPolicy types"
```

### Task 4: Add `getServerForTool()` to McpToolExecutor

**Files:**
- Modify: `packages/core/src/mcp/mcp-tool-executor.ts`
- Test: `packages/core/src/__tests__/unit/mcp-tool-executor.test.ts`

- [ ] **Step 1: Write failing test**

In the existing test file, add:

```typescript
it('getServerForTool returns server name for registered tool', async () => {
  await executor.addServer(mockConfig);
  expect(executor.getServerForTool('read_file')).toBe('test-server');
});

it('getServerForTool returns undefined for unknown tool', () => {
  expect(executor.getServerForTool('nonexistent')).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aics/core test -- --grep "getServerForTool"`
Expected: FAIL — `getServerForTool` is not a function

- [ ] **Step 3: Implement**

In `packages/core/src/mcp/mcp-tool-executor.ts`, after `dispose()` method (line 147):

```typescript
  /** Look up which server owns a given tool. Used by AuditingToolExecutor. */
  getServerForTool(toolName: string): string | undefined {
    return this.toolServerMap.get(toolName);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aics/core test -- --grep "getServerForTool"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mcp/mcp-tool-executor.ts packages/core/src/__tests__/unit/mcp-tool-executor.test.ts
git commit -m "feat(core): add getServerForTool() to McpToolExecutor"
```

### Task 5: `mcp_audit_log` DB migration + Drizzle schema + repository

**Files:**
- Create: `Docs/03_migrations/aics_migrations_local_v0.1/006_mcp_audit_log.sql`
- Modify: `packages/db-local/src/schema.ts`
- Modify: `packages/core/src/runtime/repositories.ts`

- [ ] **Step 1: Create SQL migration**

Create `Docs/03_migrations/aics_migrations_local_v0.1/006_mcp_audit_log.sql`:

```sql
-- MCP tool call audit log (P3)
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
  approved_by    TEXT NOT NULL DEFAULT 'auto',
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_thread ON mcp_audit_log(thread_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_employee ON mcp_audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_server ON mcp_audit_log(server_name);
```

- [ ] **Step 2: Add Drizzle table definition**

In `packages/db-local/src/schema.ts`, after the last table definition (around line 340):

```typescript
export const mcpAuditLog = sqliteTable(
  'mcp_audit_log',
  {
    audit_id: text('audit_id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => graphThreads.thread_id),
    task_run_id: text('task_run_id').references(() => taskRuns.task_run_id, {
      onDelete: 'set null',
    }),
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

- [ ] **Step 3: Add repository types**

In `packages/core/src/runtime/repositories.ts`, after `MemoryRepository` (line 262):

```typescript
// --- MCP Audit ---

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

export type NewMcpAudit = McpAuditRow;

export interface McpAuditRepository {
  create(audit: NewMcpAudit): Promise<McpAuditRow>;
  listByThread(threadId: string): Promise<McpAuditRow[]>;
}
```

Add `mcpAudit: McpAuditRepository;` to the `RuntimeRepositories` interface (after `memories`, line 280).

- [ ] **Step 4: Typecheck**

Run: `pnpm turbo run typecheck`
Expected: May fail in files that construct RuntimeRepositories without `mcpAudit`. That's expected — will be fixed when memory implementations are updated.

- [ ] **Step 5: Add memory implementation stub**

Find where other memory repositories are created (likely `packages/core/src/runtime/memory-repositories.ts` or similar) and add a `McpAuditRepository` memory implementation:

```typescript
export class MemoryMcpAuditRepository implements McpAuditRepository {
  private readonly rows: McpAuditRow[] = [];

  async create(audit: NewMcpAudit): Promise<McpAuditRow> {
    this.rows.push(audit);
    return audit;
  }

  async listByThread(threadId: string): Promise<McpAuditRow[]> {
    return this.rows.filter(r => r.thread_id === threadId);
  }
}
```

Wire it into wherever `RuntimeRepositories` is constructed for tests/browser.

- [ ] **Step 6: Typecheck passes**

Run: `pnpm turbo run typecheck`
Expected: All 26 packages pass

- [ ] **Step 7: Commit**

```bash
git add Docs/03_migrations/ packages/db-local/src/schema.ts packages/core/src/runtime/repositories.ts
git commit -m "feat: add mcp_audit_log table, Drizzle schema, and McpAuditRepository"
```

### Task 6: `AuditingToolExecutor` decorator

**Files:**
- Create: `packages/core/src/mcp/auditing-tool-executor.ts`
- Create: `packages/core/src/__tests__/unit/auditing-tool-executor.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/__tests__/unit/auditing-tool-executor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditingToolExecutor } from '../../mcp/auditing-tool-executor.js';
import type { ToolExecutor, ToolCallRequest, ToolCallResponse } from '../../runtime/tool-executor.js';
import type { McpAuditRepository, McpAuditRow, NewMcpAudit } from '../../runtime/repositories.js';
import { EventBus } from '../../events/event-bus.js';

// Mock inner executor
function createMockExecutor(response: ToolCallResponse): ToolExecutor {
  return {
    execute: vi.fn().mockResolvedValue(response),
    listAvailable: vi.fn().mockResolvedValue([]),
  };
}

// Mock audit repo
function createMockAuditRepo(): McpAuditRepository & { rows: NewMcpAudit[] } {
  const rows: NewMcpAudit[] = [];
  return {
    rows,
    create: vi.fn(async (audit: NewMcpAudit) => { rows.push(audit); return audit as McpAuditRow; }),
    listByThread: vi.fn(async () => []),
  };
}

const CALL: ToolCallRequest = {
  toolCallId: 'tc-1',
  name: 'read_file',
  arguments: { path: '/tmp/test.txt' },
  employeeId: 'emp-1',
};

describe('AuditingToolExecutor', () => {
  let inner: ToolExecutor;
  let auditRepo: ReturnType<typeof createMockAuditRepo>;
  let eventBus: EventBus;
  let executor: AuditingToolExecutor;

  beforeEach(() => {
    inner = createMockExecutor({ success: true, result: 'file content' });
    auditRepo = createMockAuditRepo();
    eventBus = new EventBus();
    executor = new AuditingToolExecutor(inner, auditRepo, eventBus, 'company-1', 'thread-1');
  });

  it('delegates execute to inner executor and returns its result', async () => {
    const result = await executor.execute(CALL);
    expect(result).toEqual({ success: true, result: 'file content' });
    expect(inner.execute).toHaveBeenCalledWith(CALL);
  });

  it('writes audit record on success', async () => {
    await executor.execute(CALL);
    expect(auditRepo.create).toHaveBeenCalledTimes(1);
    const audit = auditRepo.rows[0]!;
    expect(audit.tool_name).toBe('read_file');
    expect(audit.employee_id).toBe('emp-1');
    expect(audit.error).toBeNull();
    expect(audit.approved_by).toBe('auto');
  });

  it('writes audit record on failure', async () => {
    inner = createMockExecutor({ success: false, result: null, error: 'permission denied' });
    executor = new AuditingToolExecutor(inner, auditRepo, eventBus, 'company-1', 'thread-1');
    await executor.execute(CALL);
    expect(auditRepo.rows[0]!.error).toBe('permission denied');
  });

  it('emits mcp.tool.result event', async () => {
    const events: unknown[] = [];
    eventBus.on('mcp.tool.result', (e) => events.push(e));
    await executor.execute(CALL);
    expect(events).toHaveLength(1);
  });

  it('does not block on audit repo failure', async () => {
    auditRepo.create = vi.fn().mockRejectedValue(new Error('DB down'));
    const result = await executor.execute(CALL);
    expect(result.success).toBe(true); // inner result still returned
  });

  it('delegates listAvailable to inner', async () => {
    await executor.listAvailable('c1');
    expect(inner.listAvailable).toHaveBeenCalledWith('c1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aics/core test -- --grep "AuditingToolExecutor"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AuditingToolExecutor**

Create `packages/core/src/mcp/auditing-tool-executor.ts`:

```typescript
import type { EventBus } from '../events/event-bus.js';
import { mcpToolResult } from '../events/event-factories.js';
import type { McpAuditRepository, NewMcpAudit } from '../runtime/repositories.js';
import type { ToolCallRequest, ToolCallResponse, ToolExecutor } from '../runtime/tool-executor.js';
import type { ToolDef } from '../llm/gateway.js';
import { generateId } from '../utils/generate-id.js';

/**
 * Decorator that wraps any ToolExecutor with audit logging and event emission.
 *
 * Writes to mcp_audit_log on every tool call (success or failure).
 * Audit failures are logged but never block the tool result.
 */
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
    const serverName = this.resolveServerName(call.name);

    // Audit write — failure must not block tool result
    try {
      const audit: NewMcpAudit = {
        audit_id: auditId,
        thread_id: this.threadId,
        task_run_id: null,
        employee_id: call.employeeId ?? 'unknown',
        server_name: serverName,
        tool_name: call.name,
        arguments_json: JSON.stringify(call.arguments),
        result_json: response.success ? JSON.stringify(response.result) : null,
        error: response.success ? null : (response.error ?? null),
        latency_ms: latencyMs,
        approved_by: 'auto',
        created_at: new Date().toISOString(),
      };
      await this.auditRepo.create(audit);
    } catch (dbError) {
      console.error('Failed to record MCP audit:', dbError);
    }

    // Emit result event
    this.eventBus.emit(
      mcpToolResult(
        this.companyId, serverName, call.name, call.employeeId ?? 'unknown',
        auditId, response.success, latencyMs, response.error,
      ),
    );

    return response;
  }

  private resolveServerName(toolName: string): string {
    if ('getServerForTool' in this.inner
        && typeof (this.inner as Record<string, unknown>).getServerForTool === 'function') {
      return ((this.inner as { getServerForTool(n: string): string | undefined }).getServerForTool(toolName)) ?? toolName;
    }
    return toolName;
  }
}
```

- [ ] **Step 4: Export from barrel**

In `packages/core/src/index.ts`, add:
```typescript
export { AuditingToolExecutor } from './mcp/auditing-tool-executor.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @aics/core test -- --grep "AuditingToolExecutor"`
Expected: 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/mcp/auditing-tool-executor.ts packages/core/src/__tests__/unit/auditing-tool-executor.test.ts packages/core/src/index.ts
git commit -m "feat(core): add AuditingToolExecutor decorator with audit DB + events"
```

---

## Chunk 2: Rust `mcp_bridge` Tauri Plugin

The Rust layer that manages MCP stdio subprocess lifecycle.

### Task 7: Rust project setup — deps + module structure

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/src/mcp_bridge/mod.rs`
- Create: `apps/desktop/src-tauri/src/mcp_bridge/types.rs`
- Create: `apps/desktop/src-tauri/src/mcp_bridge/error.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add Rust dependencies**

In `apps/desktop/src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
tokio = { version = "1", features = ["process", "io-util", "sync", "time", "macros"] }
thiserror = "1"
```

Note: `serde` and `serde_json` already present.

- [ ] **Step 2: Create types module**

Create `apps/desktop/src-tauri/src/mcp_bridge/types.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
pub struct McpProcessConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpSpawnResult {
    pub server_name: String,
    pub tools: Vec<McpToolInfo>,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolInfo {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpServerStatus {
    pub name: String,
    pub state: String,
    pub tool_count: u32,
    pub consecutive_failures: u32,
    pub pid: Option<u32>,
}

/// JSON-RPC 2.0 message (request, response, or notification).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcMessage {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl JsonRpcMessage {
    pub fn request(id: i64, method: &str, params: serde_json::Value) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id: Some(serde_json::Value::Number(id.into())),
            method: Some(method.into()),
            params: Some(params),
            result: None,
            error: None,
        }
    }

    pub fn notification(method: &str) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id: None,
            method: Some(method.into()),
            params: None,
            result: None,
            error: None,
        }
    }
}
```

- [ ] **Step 3: Create error module**

Create `apps/desktop/src-tauri/src/mcp_bridge/error.rs`:

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum McpBridgeError {
    #[error("Server '{0}' not found")]
    ServerNotFound(String),
    #[error("Server '{0}' is not ready (state: {1})")]
    ServerNotReady(String, String),
    #[error("Failed to spawn process '{0}': {1}")]
    SpawnFailed(String, String),
    #[error("Initialize handshake failed: {0}")]
    InitFailed(String),
    #[error("Tool call timed out after {0}ms")]
    CallTimeout(u64),
    #[error("JSON-RPC error: code={code}, message={message}")]
    JsonRpcError { code: i64, message: String },
    #[error("Process exited unexpectedly with code {0:?}")]
    ProcessExited(Option<i32>),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

impl From<McpBridgeError> for tauri::ipc::InvokeError {
    fn from(e: McpBridgeError) -> Self {
        tauri::ipc::InvokeError::from(e.to_string())
    }
}
```

- [ ] **Step 4: Create mod.rs with plugin init stub**

Create `apps/desktop/src-tauri/src/mcp_bridge/mod.rs`:

```rust
pub mod error;
pub mod types;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Wry,
};
use std::collections::HashMap;
use std::sync::Mutex;

/// Registry of managed MCP processes, shared across commands.
pub struct ProcessRegistry {
    // Will hold ManagedProcess entries in Task 8
    pub servers: Mutex<HashMap<String, ()>>,
}

impl ProcessRegistry {
    pub fn new() -> Self {
        Self {
            servers: Mutex::new(HashMap::new()),
        }
    }
}

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("mcp_bridge")
        .setup(|app, _api| {
            app.manage(ProcessRegistry::new());
            Ok(())
        })
        .build()
}
```

- [ ] **Step 5: Register plugin in lib.rs**

In `apps/desktop/src-tauri/src/lib.rs`, add `mod mcp_bridge;` at the top, and in `run()`:

```rust
mod mcp_bridge;

// ... in run():
        .plugin(tauri_plugin_fs::init())
        .plugin(mcp_bridge::init())        // NEW
        .run(tauri::generate_context!())
```

- [ ] **Step 6: Verify Rust compiles**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: Compiles successfully

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri/
git commit -m "feat(desktop): scaffold mcp_bridge Rust plugin with types and error module"
```

### Task 8: JSON-RPC framer + process manager

**Files:**
- Create: `apps/desktop/src-tauri/src/mcp_bridge/jsonrpc_framer.rs`
- Create: `apps/desktop/src-tauri/src/mcp_bridge/process_manager.rs`
- Modify: `apps/desktop/src-tauri/src/mcp_bridge/mod.rs`

- [ ] **Step 1: Implement JSON-RPC framer**

Create `apps/desktop/src-tauri/src/mcp_bridge/jsonrpc_framer.rs`:

```rust
use crate::mcp_bridge::types::JsonRpcMessage;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::{mpsc, oneshot};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Reads NDJSON from stdout, parses into JsonRpcMessage, dispatches to channel.
pub async fn read_loop(
    stdout: ChildStdout,
    tx: mpsc::UnboundedSender<JsonRpcMessage>,
) {
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<JsonRpcMessage>(trimmed) {
            Ok(msg) => {
                if tx.send(msg).is_err() {
                    break; // receiver dropped
                }
            }
            Err(e) => {
                eprintln!("[mcp_bridge] malformed JSON-RPC line: {e}");
            }
        }
    }
}

/// Writes a JsonRpcMessage as NDJSON (serialize + \n + flush).
pub async fn write_message(
    stdin: &mut BufWriter<ChildStdin>,
    msg: &JsonRpcMessage,
) -> Result<(), std::io::Error> {
    let bytes = serde_json::to_vec(msg)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    stdin.write_all(&bytes).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;
    Ok(())
}

/// Manages pending request-response correlation.
pub struct RequestTracker {
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<JsonRpcMessage>>>>,
    next_id: Arc<Mutex<i64>>,
}

impl RequestTracker {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(1)),
        }
    }

    pub fn next_id(&self) -> i64 {
        let mut id = self.next_id.lock().unwrap();
        let current = *id;
        *id += 1;
        current
    }

    pub fn register(&self, id: i64) -> oneshot::Receiver<JsonRpcMessage> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        rx
    }

    /// Try to match an incoming message to a pending request.
    /// Returns true if matched (response), false if not (notification).
    pub fn try_resolve(&self, msg: &JsonRpcMessage) -> bool {
        if let Some(id_val) = &msg.id {
            if let Some(id_num) = id_val.as_i64() {
                if let Some(tx) = self.pending.lock().unwrap().remove(&id_num) {
                    let _ = tx.send(msg.clone());
                    return true;
                }
            }
        }
        false
    }
}
```

- [ ] **Step 2: Implement process manager**

Create `apps/desktop/src-tauri/src/mcp_bridge/process_manager.rs`:

```rust
use crate::mcp_bridge::error::McpBridgeError;
use crate::mcp_bridge::jsonrpc_framer::{read_loop, write_message, RequestTracker};
use crate::mcp_bridge::types::*;
use std::collections::HashMap;
use tokio::io::BufWriter;
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};

/// Safe environment variable whitelist inherited from parent process.
const ENV_WHITELIST: &[&str] = &[
    "PATH", "HOME", "USER", "LANG", "TERM", "SHELL",
    "TMPDIR", "LC_ALL", "LC_CTYPE",
    "XDG_CONFIG_HOME", "XDG_DATA_HOME",
];

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ProcessState {
    Starting,
    Ready,
    Unhealthy,
    Dead,
}

impl std::fmt::Display for ProcessState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Starting => write!(f, "starting"),
            Self::Ready => write!(f, "ready"),
            Self::Unhealthy => write!(f, "unhealthy"),
            Self::Dead => write!(f, "dead"),
        }
    }
}

pub struct ManagedProcess {
    pub child: Child,
    pub stdin: BufWriter<tokio::process::ChildStdin>,
    pub msg_rx: mpsc::UnboundedReceiver<JsonRpcMessage>,
    pub tracker: RequestTracker,
    pub config: McpProcessConfig,
    pub state: ProcessState,
    pub tools: Vec<McpToolInfo>,
    pub consecutive_failures: u32,
}

impl ManagedProcess {
    /// Spawn the child process, set up stdin/stdout framing, perform MCP initialize handshake.
    pub async fn spawn(config: McpProcessConfig) -> Result<Self, McpBridgeError> {
        // Build env: whitelist from parent + config overrides
        let mut env: HashMap<String, String> = HashMap::new();
        for key in ENV_WHITELIST {
            if let Ok(val) = std::env::var(key) {
                env.insert(key.to_string(), val);
            }
        }
        for (k, v) in &config.env {
            env.insert(k.clone(), v.clone());
        }

        let mut cmd = Command::new(&config.command);
        cmd.args(&config.args)
            .env_clear()
            .envs(&env)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            McpBridgeError::SpawnFailed(config.command.clone(), e.to_string())
        })?;

        let child_stdin = child.stdin.take()
            .ok_or_else(|| McpBridgeError::SpawnFailed(config.name.clone(), "no stdin".into()))?;
        let child_stdout = child.stdout.take()
            .ok_or_else(|| McpBridgeError::SpawnFailed(config.name.clone(), "no stdout".into()))?;

        let stdin = BufWriter::new(child_stdin);
        let (msg_tx, msg_rx) = mpsc::unbounded_channel();
        let tracker = RequestTracker::new();

        // Start read loop in background task
        let tracker_clone = tracker.clone_inner();
        tokio::spawn(async move {
            // Read loop parses NDJSON and sends to channel
            let (raw_tx, mut raw_rx) = mpsc::unbounded_channel();
            tokio::spawn(read_loop(child_stdout, raw_tx));

            while let Some(msg) = raw_rx.recv().await {
                // Try to resolve as response to pending request
                if !tracker_clone.try_resolve(&msg) {
                    // It's a notification or unmatched — forward to general channel
                    let _ = msg_tx.send(msg);
                }
            }
        });

        Ok(Self {
            child,
            stdin,
            msg_rx,
            tracker,
            config,
            state: ProcessState::Starting,
            tools: Vec::new(),
            consecutive_failures: 0,
        })
    }

    /// Perform MCP initialize handshake + tools/list.
    pub async fn initialize(&mut self) -> Result<(), McpBridgeError> {
        // 1. Send initialize request
        let init_id = self.tracker.next_id();
        let init_req = JsonRpcMessage::request(init_id, "initialize", serde_json::json!({
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {
                "name": "aics-desktop",
                "version": "0.1.0"
            }
        }));
        write_message(&mut self.stdin, &init_req).await
            .map_err(|e| McpBridgeError::InitFailed(e.to_string()))?;

        // 2. Wait for initialize response (10s timeout)
        let rx = self.tracker.register(init_id);
        let init_resp = timeout(Duration::from_secs(10), rx).await
            .map_err(|_| McpBridgeError::InitFailed("initialize timed out after 10s".into()))?
            .map_err(|_| McpBridgeError::InitFailed("channel closed".into()))?;

        if let Some(err) = &init_resp.error {
            return Err(McpBridgeError::JsonRpcError {
                code: err.code,
                message: err.message.clone(),
            });
        }

        // 3. Send notifications/initialized
        let init_notif = JsonRpcMessage::notification("notifications/initialized");
        write_message(&mut self.stdin, &init_notif).await
            .map_err(|e| McpBridgeError::InitFailed(e.to_string()))?;

        // 4. List tools
        let tools_id = self.tracker.next_id();
        let tools_req = JsonRpcMessage::request(tools_id, "tools/list", serde_json::json!({}));
        write_message(&mut self.stdin, &tools_req).await
            .map_err(|e| McpBridgeError::InitFailed(e.to_string()))?;

        let tools_rx = self.tracker.register(tools_id);
        let tools_resp = timeout(Duration::from_secs(10), tools_rx).await
            .map_err(|_| McpBridgeError::InitFailed("tools/list timed out".into()))?
            .map_err(|_| McpBridgeError::InitFailed("channel closed".into()))?;

        if let Some(result) = &tools_resp.result {
            if let Some(tools_arr) = result.get("tools").and_then(|t| t.as_array()) {
                self.tools = tools_arr.iter().filter_map(|t| {
                    Some(McpToolInfo {
                        name: t.get("name")?.as_str()?.to_string(),
                        description: t.get("description").and_then(|d| d.as_str()).unwrap_or("").to_string(),
                        input_schema: t.get("inputSchema").cloned().unwrap_or(serde_json::Value::Object(Default::default())),
                    })
                }).collect();
            }
        }

        self.state = ProcessState::Ready;
        Ok(())
    }

    /// Send a tools/call request and wait for response.
    pub async fn call_tool(&mut self, tool_name: &str, args: serde_json::Value) -> Result<serde_json::Value, McpBridgeError> {
        if self.state != ProcessState::Ready {
            return Err(McpBridgeError::ServerNotReady(
                self.config.name.clone(), self.state.to_string(),
            ));
        }

        let call_id = self.tracker.next_id();
        let req = JsonRpcMessage::request(call_id, "tools/call", serde_json::json!({
            "name": tool_name,
            "arguments": args,
        }));

        write_message(&mut self.stdin, &req).await?;

        let rx = self.tracker.register(call_id);
        let resp = timeout(Duration::from_secs(30), rx).await
            .map_err(|_| {
                self.consecutive_failures += 1;
                McpBridgeError::CallTimeout(30_000)
            })?
            .map_err(|_| McpBridgeError::ProcessExited(None))?;

        if let Some(err) = &resp.error {
            self.consecutive_failures += 1;
            return Err(McpBridgeError::JsonRpcError {
                code: err.code,
                message: err.message.clone(),
            });
        }

        self.consecutive_failures = 0;
        Ok(resp.result.unwrap_or(serde_json::Value::Null))
    }

    /// Graceful shutdown: send close, wait, then kill.
    pub async fn kill(&mut self) {
        // Best-effort: try to close stdin to signal EOF
        drop(self.stdin.get_ref());
        // Wait up to 5s for process to exit
        let _ = timeout(Duration::from_secs(5), self.child.wait()).await;
        // Force kill if still alive
        let _ = self.child.kill().await;
        self.state = ProcessState::Dead;
    }
}
```

Note: `RequestTracker` needs a `clone_inner` method. Update `jsonrpc_framer.rs` to add:

```rust
impl RequestTracker {
    // ... existing methods ...

    pub fn clone_inner(&self) -> RequestTrackerInner {
        RequestTrackerInner {
            pending: Arc::clone(&self.pending),
        }
    }
}

pub struct RequestTrackerInner {
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<JsonRpcMessage>>>>,
}

impl RequestTrackerInner {
    pub fn try_resolve(&self, msg: &JsonRpcMessage) -> bool {
        if let Some(id_val) = &msg.id {
            if let Some(id_num) = id_val.as_i64() {
                if let Some(tx) = self.pending.lock().unwrap().remove(&id_num) {
                    let _ = tx.send(msg.clone());
                    return true;
                }
            }
        }
        false
    }
}
```

- [ ] **Step 3: Update mod.rs exports**

```rust
pub mod error;
pub mod jsonrpc_framer;
pub mod process_manager;
pub mod types;
```

- [ ] **Step 4: Verify Rust compiles**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: Compiles (may have warnings about unused code, that's OK)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/mcp_bridge/
git commit -m "feat(desktop): implement JSON-RPC framer and process manager for mcp_bridge"
```

### Task 9: Health monitor

**Files:**
- Create: `apps/desktop/src-tauri/src/mcp_bridge/health.rs`

- [ ] **Step 1: Implement health monitor**

Create `apps/desktop/src-tauri/src/mcp_bridge/health.rs`:

```rust
use crate::mcp_bridge::process_manager::{ManagedProcess, ProcessState};
use crate::mcp_bridge::jsonrpc_framer::write_message;
use crate::mcp_bridge::types::JsonRpcMessage;
use tokio::time::{interval, timeout, Duration};
use rand::Rng;

pub struct HealthConfig {
    pub interval: Duration,
    pub ping_timeout: Duration,
    pub max_retries: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
}

impl Default for HealthConfig {
    fn default() -> Self {
        Self {
            interval: Duration::from_secs(30),
            ping_timeout: Duration::from_secs(10),
            max_retries: 5,
            base_delay: Duration::from_secs(1),
            max_delay: Duration::from_secs(60),
        }
    }
}

/// Calculate backoff delay with ±20% jitter.
pub fn backoff_delay(attempt: u32, base: Duration, max: Duration) -> Duration {
    let exp = base.as_millis() as u64 * 2u64.pow(attempt.min(10));
    let capped = exp.min(max.as_millis() as u64);
    let jitter = {
        let mut rng = rand::thread_rng();
        let factor: f64 = rng.gen_range(0.8..1.2);
        (capped as f64 * factor) as u64
    };
    Duration::from_millis(jitter)
}

/// Check if process is still alive.
pub fn is_process_alive(process: &mut ManagedProcess) -> bool {
    match process.child.try_wait() {
        Ok(None) => true,   // still running
        Ok(Some(_)) => false, // exited
        Err(_) => false,     // error checking
    }
}
```

- [ ] **Step 2: Add to mod.rs**

```rust
pub mod health;
```

- [ ] **Step 3: Verify compiles**

Run: `cd apps/desktop/src-tauri && cargo check`

Note: `rand` crate needs to be added to Cargo.toml:
```toml
rand = "0.8"
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/
git commit -m "feat(desktop): add health monitor with exponential backoff"
```

### Task 10: Tauri IPC commands

**Files:**
- Create: `apps/desktop/src-tauri/src/mcp_bridge/commands.rs`
- Modify: `apps/desktop/src-tauri/src/mcp_bridge/mod.rs`

- [ ] **Step 1: Implement commands**

Create `apps/desktop/src-tauri/src/mcp_bridge/commands.rs`:

```rust
use crate::mcp_bridge::error::McpBridgeError;
use crate::mcp_bridge::process_manager::ManagedProcess;
use crate::mcp_bridge::types::*;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

pub struct ProcessRegistry {
    pub servers: Mutex<HashMap<String, ManagedProcess>>,
}

impl ProcessRegistry {
    pub fn new() -> Self {
        Self {
            servers: Mutex::new(HashMap::new()),
        }
    }
}

#[tauri::command(async)]
pub async fn mcp_spawn(
    config: McpProcessConfig,
    registry: State<'_, ProcessRegistry>,
) -> Result<McpSpawnResult, McpBridgeError> {
    let name = config.name.clone();

    // Kill existing if any
    {
        let mut servers = registry.servers.lock().unwrap();
        if let Some(mut old) = servers.remove(&name) {
            tokio::spawn(async move { old.kill().await });
        }
    }

    let mut process = ManagedProcess::spawn(config).await?;
    process.initialize().await?;

    let result = McpSpawnResult {
        server_name: name.clone(),
        tools: process.tools.clone(),
        state: "ready".into(),
    };

    registry.servers.lock().unwrap().insert(name, process);
    Ok(result)
}

#[tauri::command(async)]
pub async fn mcp_call_tool(
    server: String,
    tool: String,
    args: serde_json::Value,
    registry: State<'_, ProcessRegistry>,
) -> Result<serde_json::Value, McpBridgeError> {
    let mut servers = registry.servers.lock().unwrap();
    let process = servers.get_mut(&server)
        .ok_or_else(|| McpBridgeError::ServerNotFound(server.clone()))?;
    process.call_tool(&tool, args).await
}

#[tauri::command(async)]
pub async fn mcp_kill(
    server: String,
    registry: State<'_, ProcessRegistry>,
) -> Result<(), McpBridgeError> {
    let mut servers = registry.servers.lock().unwrap();
    if let Some(mut process) = servers.remove(&server) {
        process.kill().await;
    }
    Ok(())
}

#[tauri::command]
pub fn mcp_list_servers(
    registry: State<'_, ProcessRegistry>,
) -> Vec<McpServerStatus> {
    let servers = registry.servers.lock().unwrap();
    servers.iter().map(|(name, p)| McpServerStatus {
        name: name.clone(),
        state: p.state.to_string(),
        tool_count: p.tools.len() as u32,
        consecutive_failures: p.consecutive_failures,
        pid: p.child.id(),
    }).collect()
}

#[tauri::command(async)]
pub async fn mcp_reconnect(
    server: String,
    registry: State<'_, ProcessRegistry>,
) -> Result<McpSpawnResult, McpBridgeError> {
    let config = {
        let mut servers = registry.servers.lock().unwrap();
        let process = servers.remove(&server)
            .ok_or_else(|| McpBridgeError::ServerNotFound(server.clone()))?;
        let config = process.config.clone();
        // Kill old process in background
        tokio::spawn(async move {
            let mut p = process;
            p.kill().await;
        });
        config
    };

    // Re-spawn
    mcp_spawn(config, registry).await
}
```

- [ ] **Step 2: Update mod.rs**

Replace mod.rs entirely:

```rust
pub mod commands;
pub mod error;
pub mod health;
pub mod jsonrpc_framer;
pub mod process_manager;
pub mod types;

use commands::ProcessRegistry;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Wry,
};

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

- [ ] **Step 3: Add Tauri migration for mcp_audit_log**

In `apps/desktop/src-tauri/src/lib.rs`, add migration version 7:

```rust
Migration {
    version: 7,
    description: "mcp audit log",
    sql: include_str!("../../../../Docs/03_migrations/aics_migrations_local_v0.1/006_mcp_audit_log.sql"),
    kind: MigrationKind::Up,
},
```

- [ ] **Step 4: Verify full Rust build**

Run: `cd apps/desktop/src-tauri && cargo build`
Expected: Compiles (first build may take time downloading tokio)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/
git commit -m "feat(desktop): implement mcp_bridge IPC commands (spawn, call_tool, kill, list, reconnect)"
```

---

## Chunk 3: JS TauriMcpClientFactory + AicsRuntimeProvider Wiring

### Task 11: TauriMcpClientFactory

**Files:**
- Create: `apps/web/src/lib/tauri-mcp-client.ts`

- [ ] **Step 1: Implement factory**

Create `apps/web/src/lib/tauri-mcp-client.ts`:

```typescript
/**
 * MCP client factory for Tauri desktop environment.
 *
 * stdio transport → delegates to Rust mcp_bridge via Tauri IPC.
 * SSE transport → delegates to BrowserMcpClientFactory (composition).
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  McpClientFactory,
  McpConnection,
  McpServerConfig,
  McpToolDef,
} from '@aics/core';
import { BrowserMcpClientFactory } from './browser-mcp-client';

interface McpSpawnResult {
  server_name: string;
  tools: Array<{ name: string; description: string; input_schema: unknown }>;
  state: string;
}

export class TauriMcpClientFactory implements McpClientFactory {
  private readonly sseFallback = new BrowserMcpClientFactory();

  async createClient(config: McpServerConfig): Promise<McpConnection> {
    if (config.transport === 'sse') {
      return this.sseFallback.createClient(config);
    }

    if (!config.command) {
      throw new Error(
        `MCP server '${config.name}' uses stdio but has no command specified.`,
      );
    }

    const result = await invoke<McpSpawnResult>('plugin:mcp_bridge|mcp_spawn', {
      config: {
        name: config.name,
        command: config.command,
        args: config.args ?? [],
        env: config.env ?? {},
      },
    });

    const tools: McpToolDef[] = result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema,
    }));

    return {
      config,
      tools,
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        return invoke('plugin:mcp_bridge|mcp_call_tool', {
          server: config.name,
          tool: name,
          args,
        });
      },
      async close(): Promise<void> {
        await invoke('plugin:mcp_bridge|mcp_kill', { server: config.name });
      },
    };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/tauri-mcp-client.ts
git commit -m "feat(web): add TauriMcpClientFactory for stdio MCP via Rust bridge"
```

### Task 12: Wire AicsRuntimeProvider — factory swap + audit decorator

**Files:**
- Modify: `apps/web/src/runtime/AicsRuntimeProvider.tsx`

- [ ] **Step 1: Import and swap factory**

In `AicsRuntimeProvider.tsx`, around line 176-181, replace:

```typescript
  // --- MCP Tool Executor (real, SSE-only in browser) ---
  const mcpToolExecutor = new McpToolExecutor({
    eventBus,
    companyId: COMPANY_ID,
    clientFactory: new BrowserMcpClientFactory(),
  });
```

With:

```typescript
  // --- MCP Tool Executor ---
  const clientFactory = isTauri()
    ? new (await import('../lib/tauri-mcp-client')).TauriMcpClientFactory()
    : new BrowserMcpClientFactory();

  const mcpToolExecutor = new McpToolExecutor({
    eventBus,
    companyId: COMPANY_ID,
    clientFactory,
  });
```

Note: If `AicsRuntimeProvider` initialization isn't already async, the dynamic import may need to be in a `useEffect` or an async init function. Check the existing pattern — if Tauri runtime is already loaded lazily (it is, via `tauri-runtime.ts`), follow that pattern.

- [ ] **Step 2: Wrap with AuditingToolExecutor**

After the `mcpToolExecutor` creation, add:

```typescript
  // Wrap with auditing decorator
  const toolExecutor = new AuditingToolExecutor(
    mcpToolExecutor,
    repos.mcpAudit,
    eventBus,
    COMPANY_ID,
    THREAD_ID,
  );
```

And pass `toolExecutor` (not `mcpToolExecutor`) to `createRuntimeContext`.

- [ ] **Step 3: Typecheck**

Run: `pnpm turbo run typecheck --filter=@aics/web`
Expected: Pass (may need to update repos construction to include mcpAudit)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/runtime/AicsRuntimeProvider.tsx
git commit -m "feat(web): wire TauriMcpClientFactory + AuditingToolExecutor in runtime"
```

### Task 13: McpConfigPanel — disable stdio in browser

**Files:**
- Modify: `apps/web/src/components/settings/McpConfigPanel.tsx`

- [ ] **Step 1: Import isTauri and gate stdio option**

Find the transport `<select>` or radio group in `McpConfigPanel.tsx`. Add:

```typescript
import { isTauri } from '../../runtime/env';

// In the transport selector JSX:
<option value="stdio" disabled={!isTauri()}>
  Stdio (Local){!isTauri() ? ' — Desktop only' : ''}
</option>
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @aics/web build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/settings/McpConfigPanel.tsx
git commit -m "fix(web): disable stdio MCP option in browser environment"
```

---

## Chunk 4: Skill `required_mcps` Detection

### Task 14: Extend SkillRequirements with `mcps` field

**Files:**
- Modify: `packages/install-core/src/openclaw/types.ts`

- [ ] **Step 1: Add RequiredMcp type and extend SkillRequirements**

In `packages/install-core/src/openclaw/types.ts`, after `SkillRequirements` (line 30):

```typescript
export interface RequiredMcp {
  readonly name: string;
  readonly description: string;
  readonly transport: 'stdio' | 'sse' | 'either';
  readonly registryUrl?: string;
}
```

Add to `SkillRequirements`:

```typescript
export interface SkillRequirements {
  readonly bins?: readonly string[];
  readonly env?: readonly string[];
  readonly config?: readonly string[];
  readonly mcps?: readonly RequiredMcp[];
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/install-core/src/openclaw/types.ts
git commit -m "feat(install-core): add RequiredMcp type to SkillRequirements"
```

### Task 15: Parse `required-mcps` from YAML frontmatter

**Files:**
- Modify: `packages/install-core/src/openclaw/skill-parser.ts`
- Test: `packages/install-core/src/__tests__/unit/skill-parser.test.ts`

- [ ] **Step 1: Write failing test**

In the existing skill-parser test file, add:

```typescript
it('parses required-mcps from metadata', () => {
  const content = `---
name: GitHub Assistant
description: Works with GitHub
metadata: '{"openclaw.requires":{"mcps":[{"name":"github","description":"GitHub API","transport":"stdio","registry-url":"https://example.com"}]}}'
---
Instructions here
`;
  const result = parseSkill(content);
  expect(result.requirements.mcps).toHaveLength(1);
  expect(result.requirements.mcps![0]!.name).toBe('github');
  expect(result.requirements.mcps![0]!.transport).toBe('stdio');
  expect(result.requirements.mcps![0]!.registryUrl).toBe('https://example.com');
});

it('returns undefined mcps when not specified', () => {
  const content = `---
name: Simple Skill
description: No MCPs
---
Do stuff
`;
  const result = parseSkill(content);
  expect(result.requirements.mcps).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @aics/install-core test -- --grep "required-mcps"`
Expected: FAIL

- [ ] **Step 3: Update extractRequirements**

In `skill-parser.ts`, `extractRequirements()` (line 53-68), add MCP parsing:

```typescript
function extractRequirements(meta: Record<string, unknown>): SkillRequirements {
  const requires = meta['openclaw.requires'] as Record<string, unknown> | undefined;
  if (!requires || typeof requires !== 'object') return {};

  return {
    bins: Array.isArray(requires.bins)
      ? requires.bins.filter((b): b is string => typeof b === 'string')
      : undefined,
    env: Array.isArray(requires.env)
      ? requires.env.filter((e): e is string => typeof e === 'string')
      : undefined,
    config: Array.isArray(requires.config)
      ? requires.config.filter((c): c is string => typeof c === 'string')
      : undefined,
    mcps: Array.isArray(requires.mcps)
      ? requires.mcps
          .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
          .map((m) => ({
            name: String(m.name ?? ''),
            description: String(m.description ?? ''),
            transport: (['stdio', 'sse', 'either'].includes(String(m.transport))
              ? String(m.transport) as 'stdio' | 'sse' | 'either'
              : 'either'),
            registryUrl: typeof m['registry-url'] === 'string' ? m['registry-url'] : undefined,
          }))
      : undefined,
  };
}
```

Add `RequiredMcp` to the import from `./types.js`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @aics/install-core test`
Expected: All tests pass including new ones

- [ ] **Step 5: Commit**

```bash
git add packages/install-core/src/openclaw/skill-parser.ts packages/install-core/src/__tests__/
git commit -m "feat(install-core): parse required-mcps from OpenClaw frontmatter"
```

### Task 16: Map mcps to manifest

**Files:**
- Modify: `packages/install-core/src/openclaw/skill-to-manifest.ts`

- [ ] **Step 1: Update mapping**

In `skill-to-manifest.ts`, line 73-76, replace:

```typescript
    requirements: {
      required_capabilities: [],
      required_mcps: [],
    },
```

With:

```typescript
    requirements: {
      required_capabilities: [],
      required_mcps: (skill.requirements.mcps ?? []).map((m) => m.name),
    },
```

- [ ] **Step 2: Typecheck + test**

Run: `pnpm --filter @aics/install-core test && pnpm turbo run typecheck --filter=@aics/install-core`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add packages/install-core/src/openclaw/skill-to-manifest.ts
git commit -m "feat(install-core): map required_mcps names to manifest"
```

### Task 17: Extend skill-validator for `missing_mcp` warnings

**Files:**
- Modify: `packages/install-core/src/openclaw/skill-validator.ts`
- Test: `packages/install-core/src/__tests__/unit/skill-validator.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `skill-validator.test.ts`:

```typescript
it('returns missing_mcp warning for unconnected MCP server', () => {
  const skill: ParsedSkill = {
    ...baseSkill,
    requirements: {
      mcps: [{ name: 'github', description: 'GitHub API', transport: 'stdio' }],
    },
  };
  const result = validateSkill(skill, 'desktop', new Set());
  expect(result.valid).toBe(true);
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]!.type).toBe('missing_mcp');
  expect(result.warnings[0]!.severity).toBe('warning');
});

it('does not warn for connected MCP server', () => {
  const skill: ParsedSkill = {
    ...baseSkill,
    requirements: {
      mcps: [{ name: 'github', description: 'GitHub API', transport: 'stdio' }],
    },
  };
  const result = validateSkill(skill, 'desktop', new Set(['github']));
  expect(result.warnings).toHaveLength(0);
});

it('skips MCP check when connectedMcpServers not provided', () => {
  const skill: ParsedSkill = {
    ...baseSkill,
    requirements: {
      mcps: [{ name: 'github', description: 'GitHub API', transport: 'stdio' }],
    },
  };
  const result = validateSkill(skill, 'desktop');
  expect(result.warnings).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @aics/install-core test -- --grep "missing_mcp"`
Expected: FAIL

- [ ] **Step 3: Update validateSkill signature and add MCP check**

In `skill-validator.ts`, change function signature:

```typescript
export function validateSkill(
  skill: ParsedSkill,
  environment: SupportedEnvironment,
  connectedMcpServers?: ReadonlySet<string>,
): SkillValidationResult {
```

After the OS warning block (line 78), add:

```typescript
  // MCP server warnings
  if (skill.requirements.mcps && connectedMcpServers) {
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
```

- [ ] **Step 4: Run all tests**

Run: `pnpm --filter @aics/install-core test`
Expected: All pass (existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add packages/install-core/src/openclaw/skill-validator.ts packages/install-core/src/__tests__/
git commit -m "feat(install-core): add missing_mcp warning in skill validator"
```

---

## Chunk 5: Verification

### Task 18: Full typecheck + test suite

- [ ] **Step 1: Full typecheck**

Run: `pnpm turbo run typecheck`
Expected: All packages pass

- [ ] **Step 2: Core tests**

Run: `pnpm --filter @aics/core test`
Expected: All pass (161+ existing + ~8 new)

- [ ] **Step 3: Install-core tests**

Run: `pnpm --filter @aics/install-core test`
Expected: All pass (193+ existing + ~5 new)

- [ ] **Step 4: Web build**

Run: `pnpm --filter @aics/web build`
Expected: Build succeeds

- [ ] **Step 5: Rust build**

Run: `cd apps/desktop/src-tauri && cargo build`
Expected: Compiles

- [ ] **Step 6: Tag**

```bash
git tag p3-mcp-full-experience
```
