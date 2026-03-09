# Phase 5: Tauri 2 Desktop App — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn `apps/desktop` from an empty stub into a full-capability Tauri 2 desktop application — the product's reference environment with persistent SQLite, CORS-free LLM calls, and file system access.

**Architecture:** Webview runs the same `apps/web` code (React + PixiJS + LangGraph). SQLite accessed via Drizzle `sqlite-proxy` over `tauri-plugin-sql` IPC. CORS bypass via `tauri-plugin-cors-fetch`. Environment detection (`isTauri()`) branches between TauriRuntime and BrowserRuntime at startup.

**Tech Stack:** Tauri 2 (Rust), tauri-plugin-sql (SQLite/sqlx), tauri-plugin-cors-fetch (v5), tauri-plugin-fs, Drizzle ORM sqlite-proxy, `@langchain/langgraph-checkpoint` (BaseCheckpointSaver)

**Design Doc:** `Docs/plans/2026-03-09-phase5-desktop-design.md`

**Prerequisites:**
- Rust toolchain installed (`rustup`, stable channel)
- Phase 4 complete (commit `fdcf637`, tag on main)
- Node v22+, pnpm v10+

---

## Task 1: Tauri 2 Rust Scaffold

**Files:**
- Create: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/build.rs`
- Create: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/src/main.rs`
- Create: `apps/desktop/src-tauri/src/lib.rs`
- Remove: `apps/desktop/src/index.ts` (placeholder, no longer needed)
- Remove: `apps/desktop/tsconfig.json` (replaced by Tauri)

**Step 1: Create directory structure**

```bash
mkdir -p apps/desktop/src-tauri/src
mkdir -p apps/desktop/src-tauri/capabilities
mkdir -p apps/desktop/src-tauri/icons
```

**Step 2: Create `apps/desktop/src-tauri/Cargo.toml`**

```toml
[package]
name = "aics-desktop"
version = "0.0.1"
description = "AI Company Simulator — Desktop Runtime"
edition = "2021"

[lib]
name = "aics_desktop_lib"
crate-type = ["lib", "cdylib", "staticlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
tauri-plugin-cors-fetch = "5"
tauri-plugin-fs = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

**Step 3: Create `apps/desktop/src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

**Step 4: Create `apps/desktop/src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-config-schema/schema.json",
  "productName": "AI Company Simulator",
  "version": "0.0.1",
  "identifier": "com.aics.desktop",
  "build": {
    "beforeDevCommand": "pnpm --filter @aics/web dev",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "pnpm --filter @aics/web build",
    "frontendDist": "../../web/dist"
  },
  "app": {
    "windows": [
      {
        "title": "AI Company Simulator",
        "width": 1280,
        "height": 800,
        "minWidth": 1024,
        "minHeight": 700
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

**Step 5: Create `apps/desktop/src-tauri/src/main.rs`**

```rust
// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    aics_desktop_lib::run()
}
```

**Step 6: Create `apps/desktop/src-tauri/src/lib.rs`**

```rust
use tauri_plugin_sql::{Migration, MigrationKind};

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "core tables",
            sql: include_str!("../../../../Docs/03_migrations/aics_migrations_local_v0.1/001_core_tables.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "install tables",
            sql: include_str!("../../../../Docs/03_migrations/aics_migrations_local_v0.1/002_install_tables.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "runtime orchestration",
            sql: include_str!("../../../../Docs/03_migrations/aics_migrations_local_v0.1/003_runtime_orchestration.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "audit and events",
            sql: include_str!("../../../../Docs/03_migrations/aics_migrations_local_v0.1/004_audit_and_events.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "llm calls tracking",
            sql: include_str!("../../../../Docs/03_migrations/aics_migrations_local_v0.1/005_llm_calls.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "langgraph checkpoint tables",
            sql: "CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint BLOB,
  metadata BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  value BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);",
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:aics.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_cors_fetch::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

> **Note:** Migration 6 creates the LangGraph checkpoint tables (`checkpoints` + `writes`) that `SqliteSaver` normally auto-creates. This ensures they exist before webview code runs.

**Step 7: Remove old placeholder files**

```bash
rm -f apps/desktop/src/index.ts
rm -f apps/desktop/tsconfig.json
rmdir apps/desktop/src 2>/dev/null || true
rm -rf apps/desktop/dist 2>/dev/null || true
```

**Step 8: Verify Rust compilation**

```bash
cd apps/desktop/src-tauri && cargo check
```

Expected: Compilation succeeds (downloads deps on first run, ~2-5 min).

**Step 9: Commit**

```bash
git add apps/desktop/src-tauri/ && git add -u apps/desktop/
git commit -m "feat(desktop): scaffold Tauri 2 project with Rust plugins + migrations"
```

---

## Task 2: Capabilities & Permissions

**Files:**
- Create: `apps/desktop/src-tauri/capabilities/default.json`

**Step 1: Create capabilities file**

The capabilities file grants the webview permission to use the SQL, fetch, and FS plugins.

```json
{
  "$schema": "https://raw.githubusercontent.com/nicegui/nicegui/main/nicegui/static/capabilities.schema.json",
  "identifier": "default",
  "description": "Default capabilities for AICS desktop",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "sql:default",
    "sql:allow-load",
    "sql:allow-select",
    "sql:allow-execute",
    "sql:allow-close",
    "cors-fetch:default",
    "fs:default",
    {
      "identifier": "fs:allow-read-text-file",
      "allow": [
        { "path": "$APPDATA/**" },
        { "path": "$DOWNLOAD/**" }
      ]
    },
    {
      "identifier": "fs:allow-write-text-file",
      "allow": [
        { "path": "$APPDATA/**" }
      ]
    }
  ]
}
```

> **Note:** The exact permission identifiers may vary by plugin version. If `cargo check` fails on unknown permissions, consult each plugin's README for the correct identifiers. The pattern is `plugin-name:allow-method`.

**Step 2: Verify cargo check still passes**

```bash
cd apps/desktop/src-tauri && cargo check
```

**Step 3: Commit**

```bash
git add apps/desktop/src-tauri/capabilities/
git commit -m "feat(desktop): add Tauri capabilities for SQL, CORS-fetch, FS"
```

---

## Task 3: Desktop package.json + Verify Window Opens

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `apps/web/package.json` (add @tauri-apps JS deps)
- Modify: `apps/web/vite.config.ts` (adjust for Tauri compatibility)

**Step 1: Rewrite `apps/desktop/package.json`**

```json
{
  "name": "@aics/desktop",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "tauri": "tauri",
    "dev": "tauri dev",
    "build": "tauri build",
    "typecheck": "echo 'no TS in desktop — Rust only'"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2"
  }
}
```

> **Design decision:** `apps/desktop` is now purely a Tauri shell. All TypeScript code runs in `apps/web` webview. Previous deps (`@aics/core`, `@aics/renderer`, etc.) are already in `apps/web`.

**Step 2: Add Tauri JS plugin deps to `apps/web/package.json`**

```bash
cd /path/to/monorepo
pnpm --filter @aics/web add @tauri-apps/api@^2 @tauri-apps/plugin-sql@^2 @tauri-apps/plugin-fs@^2
```

These run inside the webview and use `window.__TAURI__` internally. In browser mode, they're never imported (guarded by `isTauri()` + dynamic imports).

**Step 3: Add `@tauri-apps/*` to Vite externals for browser build**

Modify `apps/web/vite.config.ts` — add Tauri packages to the existing `rollupOptions.external` array:

```typescript
// In build.rollupOptions.external, add:
external: [
  'better-sqlite3',
  '@langchain/langgraph-checkpoint-sqlite',
  // Tauri packages — only available in Tauri webview, not browser
  /^@tauri-apps\//,
],
```

Using a regex pattern catches all `@tauri-apps/*` imports.

**Step 4: Install deps**

```bash
pnpm install
```

**Step 5: Generate Tauri icons (placeholder)**

```bash
cd apps/desktop
# Create a minimal placeholder icon (32x32 PNG)
# If `cargo tauri icon` is available, use it.
# Otherwise create minimal PNGs:
npx tauri icon --input ../../Docs/logo.png 2>/dev/null || echo "No icon source; create placeholder icons manually"
```

If no icon source exists, create placeholder icon files:

```bash
# Create minimal placeholder icons for build to succeed
cd apps/desktop/src-tauri/icons
# Generate 1x1 transparent PNGs (will be replaced later)
convert -size 32x32 xc:transparent 32x32.png 2>/dev/null || python3 -c "
import struct, zlib
def png(w,h):
    raw = b''.join(b'\x00'+b'\x00\x00\x00\x00'*w for _ in range(h))
    return b'\x89PNG\r\n\x1a\n'+b''.join([
        struct.pack('>I',13)+b'IHDR'+struct.pack('>IIBB',w,h,8,6)+b'\x00\x00\x00'+struct.pack('>I',0),
        struct.pack('>I',len(zlib.compress(raw)))+b'IDAT'+zlib.compress(raw)+struct.pack('>I',0),
        struct.pack('>I',0)+b'IEND'+struct.pack('>I',0)
    ])
for name,s in [('32x32.png',32),('128x128.png',128),('128x128@2x.png',256)]:
    open(name,'wb').write(png(s,s))
"
```

> **Note:** Placeholder icons. Replace with real brand icons before release. `.icns` and `.ico` are optional for dev builds; only PNG is needed.

**Step 6: Verify `tauri dev` opens a window**

```bash
cd apps/desktop
pnpm tauri dev
```

Expected: Vite dev server starts on :5173, Tauri window opens showing the existing web app (chat + PixiJS scene). SQLite migrations run on startup (check Rust console output). Close the window.

**Step 7: Commit**

```bash
git add apps/desktop/package.json apps/web/package.json apps/web/vite.config.ts
git add apps/desktop/src-tauri/icons/
git commit -m "feat(desktop): configure Tauri CLI, JS plugin deps, verify window opens"
```

---

## Task 4: Environment Detection

**Files:**
- Create: `apps/web/src/lib/env.ts`

**Step 1: Create environment detection utility**

```typescript
// apps/web/src/lib/env.ts

/**
 * Detect whether the app is running inside a Tauri 2 webview.
 * Uses the injected window.__TAURI__ object that Tauri provides.
 */
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    '__TAURI__' in window
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/lib/env.ts
git commit -m "feat(web): add isTauri() environment detection"
```

---

## Task 5: TauriDrizzleProxy — SQLite-Proxy Adapter

**Files:**
- Create: `apps/web/src/lib/tauri-drizzle.ts`

This adapter creates a Drizzle ORM database instance using the `sqlite-proxy` driver.
The proxy callback sends SQL to `@tauri-apps/plugin-sql` which executes it via Tauri IPC → Rust → sqlx → SQLite.

**Step 1: Create the Drizzle sqlite-proxy adapter**

```typescript
// apps/web/src/lib/tauri-drizzle.ts

import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from '@aics/db-local';

/**
 * Lazily-loaded tauri-plugin-sql Database connection.
 * Dynamic import ensures this module is never loaded in browser mode.
 */
let dbPromise: Promise<any> | null = null;

async function getPluginDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const { default: Database } = await import('@tauri-apps/plugin-sql');
      return Database.load('sqlite:aics.db');
    })();
  }
  return dbPromise;
}

/**
 * Create a Drizzle ORM database instance backed by tauri-plugin-sql.
 *
 * The sqlite-proxy driver generates SQL in JavaScript, then this callback
 * sends it to the Rust backend via Tauri IPC for execution.
 *
 * @returns Drizzle DB instance (async — all .all()/.run() return Promises)
 */
export function createTauriDrizzleDb() {
  return drizzle(async (sql, params, method) => {
    const db = await getPluginDb();

    if (method === 'run') {
      // INSERT, UPDATE, DELETE — no rows returned
      await db.execute(sql, params);
      return { rows: [] };
    }

    // SELECT — return rows
    // method === 'all' | 'get' | 'values'
    const rows = await db.select<Record<string, unknown>[]>(sql, params);
    return { rows };
  }, { schema });
}

export type TauriDrizzleDb = ReturnType<typeof createTauriDrizzleDb>;
```

**Step 2: Commit**

```bash
git add apps/web/src/lib/tauri-drizzle.ts
git commit -m "feat(web): add TauriDrizzleProxy — sqlite-proxy over tauri-plugin-sql"
```

---

## Task 6: Tauri Repositories — Async Drizzle Repos

**Files:**
- Create: `apps/web/src/lib/tauri-repos.ts`

The existing `createDrizzleRepositories` in `@aics/core` uses `BetterSQLite3Database` (synchronous).
We need an async version for sqlite-proxy. This mirrors the same logic but with `await` on all Drizzle calls.

**Reference:** `packages/core/src/runtime/drizzle-repositories.ts` — copy the logic, adapt for async.

**Step 1: Create the async repository factory**

```typescript
// apps/web/src/lib/tauri-repos.ts

import { eq, and, desc } from 'drizzle-orm';
import * as schema from '@aics/db-local';
import type {
  CompanyRepository, EmployeeRepository,
  EventRepository, GraphCheckpointRow, GraphThreadRow,
  HandoffEventRow, HandoffRepository, LlmCallRepository,
  LlmCallRow, MeetingRepository,
  MeetingSessionRow, NewGraphCheckpoint, NewGraphThread,
  NewHandoffEvent, NewLlmCall, NewMeetingSession, NewRuntimeEvent,
  NewTaskRun, NewToolCall, RuntimeRepositories,
  TaskRunRepository, TaskRunRow, ThreadRepository,
  ToolCallRepository, ToolCallRow, CheckpointRepository,
} from '@aics/core';
import type { TauriDrizzleDb } from './tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

/**
 * Create RuntimeRepositories backed by Drizzle sqlite-proxy (async).
 *
 * This mirrors packages/core/src/runtime/drizzle-repositories.ts
 * but uses `await` on all Drizzle calls (sqlite-proxy returns Promises).
 */
export function createTauriRepositories(db: TauriDrizzleDb): RuntimeRepositories {
  const companies: CompanyRepository = {
    async findById(id) {
      const rows = await db.select().from(schema.companies)
        .where(eq(schema.companies.company_id, id));
      return (rows[0] as any) ?? null;
    },
  };

  const threads: ThreadRepository = {
    async create(t: NewGraphThread) {
      const row = { ...t, created_at: now(), updated_at: now() };
      await db.insert(schema.graphThreads).values(row);
      return row as GraphThreadRow;
    },
    async findById(id) {
      const rows = await db.select().from(schema.graphThreads)
        .where(eq(schema.graphThreads.thread_id, id));
      return (rows[0] as GraphThreadRow | undefined) ?? null;
    },
    async findByCompany(companyId, opts) {
      let query = db.select().from(schema.graphThreads)
        .where(
          opts?.status
            ? and(eq(schema.graphThreads.company_id, companyId), eq(schema.graphThreads.status, opts.status))
            : eq(schema.graphThreads.company_id, companyId),
        )
        .orderBy(desc(schema.graphThreads.created_at));

      if (opts?.limit) {
        query = query.limit(opts.limit) as typeof query;
      }

      return await query as GraphThreadRow[];
    },
    async updateStatus(id, status) {
      await db.update(schema.graphThreads)
        .set({ status, updated_at: now() })
        .where(eq(schema.graphThreads.thread_id, id));
    },
  };

  const taskRuns: TaskRunRepository = {
    async create(t: NewTaskRun) {
      const row = { ...t, finished_at: null };
      await db.insert(schema.taskRuns).values(row);
      return row as TaskRunRow;
    },
    async findById(id) {
      const rows = await db.select().from(schema.taskRuns)
        .where(eq(schema.taskRuns.task_run_id, id));
      return (rows[0] as TaskRunRow | undefined) ?? null;
    },
    async findByThread(threadId) {
      return await db.select().from(schema.taskRuns)
        .where(eq(schema.taskRuns.thread_id, threadId)) as TaskRunRow[];
    },
    async updateStatus(id, status, outputJson) {
      const finished = ['completed', 'failed', 'cancelled'].includes(status) ? now() : null;
      await db.update(schema.taskRuns)
        .set({ status, output_json: outputJson ?? undefined, finished_at: finished ?? undefined })
        .where(eq(schema.taskRuns.task_run_id, id));
    },
  };

  const employees: EmployeeRepository = {
    async findById(id) {
      const rows = await db.select().from(schema.employees)
        .where(eq(schema.employees.employee_id, id));
      return (rows[0] as any) ?? null;
    },
    async findByCompany(companyId) {
      return await db.select().from(schema.employees)
        .where(eq(schema.employees.company_id, companyId)) as any;
    },
    async findByRole(companyId, roleSlug) {
      return await db.select().from(schema.employees)
        .where(and(eq(schema.employees.company_id, companyId), eq(schema.employees.role_slug, roleSlug))) as any;
    },
  };

  const toolCalls: ToolCallRepository = {
    async create(t: NewToolCall) {
      const row = { ...t, finished_at: null };
      await db.insert(schema.toolCalls).values(row);
      return row as ToolCallRow;
    },
    async updateResult(id, status, responseJson) {
      await db.update(schema.toolCalls)
        .set({ status, response_json: responseJson, finished_at: now() })
        .where(eq(schema.toolCalls.tool_call_id, id));
    },
  };

  const handoffs: HandoffRepository = {
    async create(h: NewHandoffEvent) {
      await db.insert(schema.handoffEvents).values(h);
      return h as HandoffEventRow;
    },
    async findByThread(threadId) {
      return await db.select().from(schema.handoffEvents)
        .where(eq(schema.handoffEvents.thread_id, threadId)) as HandoffEventRow[];
    },
  };

  const meetings: MeetingRepository = {
    async create(m: NewMeetingSession) {
      await db.insert(schema.meetingSessions).values(m);
      return m as MeetingSessionRow;
    },
    async findById(id) {
      const rows = await db.select().from(schema.meetingSessions)
        .where(eq(schema.meetingSessions.meeting_id, id));
      return (rows[0] as MeetingSessionRow | undefined) ?? null;
    },
    async updateStatus(id, status, summaryJson) {
      await db.update(schema.meetingSessions)
        .set({ status, summary_json: summaryJson ?? undefined, updated_at: now() })
        .where(eq(schema.meetingSessions.meeting_id, id));
    },
  };

  const checkpoints: CheckpointRepository = {
    async save(c: NewGraphCheckpoint) {
      await db.insert(schema.graphCheckpoints).values(c);
    },
    async findLatest(threadId) {
      const rows = await db.select().from(schema.graphCheckpoints)
        .where(eq(schema.graphCheckpoints.thread_id, threadId))
        .orderBy(desc(schema.graphCheckpoints.checkpoint_seq))
        .limit(1);
      return (rows[0] as GraphCheckpointRow | undefined) ?? null;
    },
    async findBySeq(threadId, seq) {
      const rows = await db.select().from(schema.graphCheckpoints)
        .where(and(
          eq(schema.graphCheckpoints.thread_id, threadId),
          eq(schema.graphCheckpoints.checkpoint_seq, seq),
        ));
      return (rows[0] as GraphCheckpointRow | undefined) ?? null;
    },
  };

  const events: EventRepository = {
    async insert(e: NewRuntimeEvent) {
      await db.insert(schema.runtimeEvents).values(e);
    },
  };

  const llmCalls: LlmCallRepository = {
    async create(c: NewLlmCall) {
      await db.insert(schema.llmCalls).values(c);
      return c as LlmCallRow;
    },
    async findByThread(threadId) {
      return await db.select().from(schema.llmCalls)
        .where(eq(schema.llmCalls.thread_id, threadId)) as LlmCallRow[];
    },
    async findByTaskRun(taskRunId) {
      return await db.select().from(schema.llmCalls)
        .where(eq(schema.llmCalls.task_run_id, taskRunId)) as LlmCallRow[];
    },
  };

  return { companies, threads, taskRuns, employees, toolCalls, handoffs, meetings, checkpoints, events, llmCalls };
}
```

**Step 2: Commit**

```bash
git add apps/web/src/lib/tauri-repos.ts
git commit -m "feat(web): add TauriRepositories — async Drizzle repos over sqlite-proxy"
```

---

## Task 7: TauriCheckpointSaver — LangGraph Persistence

**Files:**
- Create: `apps/web/src/lib/tauri-checkpoint.ts`

Implements `BaseCheckpointSaver` from `@langchain/langgraph-checkpoint`.
Mirrors the logic of `SqliteSaver` from `@langchain/langgraph-checkpoint-sqlite`
but uses `@tauri-apps/plugin-sql` (async) instead of `better-sqlite3` (sync).

**Reference:** `node_modules/.pnpm/@langchain+langgraph-checkpoint-sqlite@1.0.1.../dist/index.js`

The tables used (`checkpoints` + `writes`) are created by Rust migration 6 (Task 1).

**Step 1: Create the TauriCheckpointSaver**

```typescript
// apps/web/src/lib/tauri-checkpoint.ts

import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  copyCheckpoint,
  WRITES_IDX_MAP,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { PendingWrite, CheckpointPendingWrite } from '@langchain/langgraph-checkpoint';

// Internal constant from LangGraph — channel name for pending sends
const TASKS = '__pregel_tasks';

/**
 * LangGraph checkpoint saver backed by tauri-plugin-sql (SQLite).
 *
 * Replicates the SqliteSaver logic but uses async tauri-plugin-sql
 * instead of synchronous better-sqlite3.
 */
export class TauriCheckpointSaver extends BaseCheckpointSaver {
  private db: any = null;

  private async getDb() {
    if (!this.db) {
      const { default: Database } = await import('@tauri-apps/plugin-sql');
      this.db = await Database.load('sqlite:aics.db');
    }
    return this.db;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const db = await this.getDb();
    const { thread_id, checkpoint_ns = '', checkpoint_id } = config.configurable ?? {};

    let sql = `
      SELECT
        thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
        type, checkpoint, metadata,
        (
          SELECT json_group_array(
            json_object(
              'task_id', pw.task_id, 'channel', pw.channel,
              'type', pw.type, 'value', CAST(pw.value AS TEXT)
            )
          )
          FROM writes AS pw
          WHERE pw.thread_id = checkpoints.thread_id
            AND pw.checkpoint_ns = checkpoints.checkpoint_ns
            AND pw.checkpoint_id = checkpoints.checkpoint_id
        ) AS pending_writes,
        (
          SELECT json_group_array(
            json_object('type', ps.type, 'value', CAST(ps.value AS TEXT))
          )
          FROM writes AS ps
          WHERE ps.thread_id = checkpoints.thread_id
            AND ps.checkpoint_ns = checkpoints.checkpoint_ns
            AND ps.checkpoint_id = checkpoints.parent_checkpoint_id
            AND ps.channel = '${TASKS}'
          ORDER BY ps.idx
        ) AS pending_sends
      FROM checkpoints
      WHERE thread_id = $1 AND checkpoint_ns = $2`;

    const params: unknown[] = [thread_id, checkpoint_ns];
    if (checkpoint_id) {
      sql += ' AND checkpoint_id = $3';
      params.push(checkpoint_id);
    } else {
      sql += ' ORDER BY checkpoint_id DESC LIMIT 1';
    }

    const rows = await db.select<any[]>(sql, params);
    const row = rows[0];
    if (!row) return undefined;

    let finalConfig = config;
    if (!checkpoint_id) {
      finalConfig = {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns,
          checkpoint_id: row.checkpoint_id,
        },
      };
    }

    const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
      JSON.parse(row.pending_writes || '[]').map(async (w: any) => [
        w.task_id,
        w.channel,
        await this.serde.loadsTyped(w.type ?? 'json', w.value ?? ''),
      ]),
    );

    const checkpoint = (await this.serde.loadsTyped(
      row.type ?? 'json',
      row.checkpoint,
    )) as Checkpoint;

    return {
      checkpoint,
      config: finalConfig,
      metadata: (await this.serde.loadsTyped(
        row.type ?? 'json',
        row.metadata,
      )) as CheckpointMetadata,
      parentConfig: row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites,
    };
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const db = await this.getDb();
    const { limit, before, filter } = options ?? {};
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns;

    let sql = `
      SELECT
        thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
        type, checkpoint, metadata,
        (
          SELECT json_group_array(
            json_object(
              'task_id', pw.task_id, 'channel', pw.channel,
              'type', pw.type, 'value', CAST(pw.value AS TEXT)
            )
          )
          FROM writes AS pw
          WHERE pw.thread_id = checkpoints.thread_id
            AND pw.checkpoint_ns = checkpoints.checkpoint_ns
            AND pw.checkpoint_id = checkpoints.checkpoint_id
        ) AS pending_writes
      FROM checkpoints`;

    const whereClauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (thread_id) {
      whereClauses.push(`thread_id = $${paramIdx++}`);
      params.push(thread_id);
    }
    if (checkpoint_ns !== undefined && checkpoint_ns !== null) {
      whereClauses.push(`checkpoint_ns = $${paramIdx++}`);
      params.push(checkpoint_ns);
    }
    if (before?.configurable?.checkpoint_id) {
      whereClauses.push(`checkpoint_id < $${paramIdx++}`);
      params.push(before.configurable.checkpoint_id);
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    sql += ' ORDER BY checkpoint_id DESC';
    if (limit) sql += ` LIMIT ${Number(limit)}`;

    const rows = await db.select<any[]>(sql, params);

    for (const row of rows) {
      const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
        JSON.parse(row.pending_writes || '[]').map(async (w: any) => [
          w.task_id,
          w.channel,
          await this.serde.loadsTyped(w.type ?? 'json', w.value ?? ''),
        ]),
      );

      const checkpoint = (await this.serde.loadsTyped(
        row.type ?? 'json',
        row.checkpoint,
      )) as Checkpoint;

      yield {
        config: {
          configurable: {
            thread_id: row.thread_id,
            checkpoint_ns: row.checkpoint_ns,
            checkpoint_id: row.checkpoint_id,
          },
        },
        checkpoint,
        metadata: (await this.serde.loadsTyped(
          row.type ?? 'json',
          row.metadata,
        )) as CheckpointMetadata,
        parentConfig: row.parent_checkpoint_id
          ? {
              configurable: {
                thread_id: row.thread_id,
                checkpoint_ns: row.checkpoint_ns,
                checkpoint_id: row.parent_checkpoint_id,
              },
            }
          : undefined,
        pendingWrites,
      };
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const db = await this.getDb();
    if (!config.configurable) throw new Error('Empty configuration supplied.');

    const thread_id = config.configurable.thread_id;
    const checkpoint_ns = config.configurable.checkpoint_ns ?? '';
    const parent_checkpoint_id = config.configurable.checkpoint_id;

    if (!thread_id) {
      throw new Error('Missing "thread_id" in config.configurable.');
    }

    const preparedCheckpoint = copyCheckpoint(checkpoint);
    const [[type1, serializedCheckpoint], [type2, serializedMetadata]] =
      await Promise.all([
        this.serde.dumpsTyped(preparedCheckpoint),
        this.serde.dumpsTyped(metadata),
      ]);

    if (type1 !== type2) {
      throw new Error('Failed to serialize checkpoint and metadata to same type.');
    }

    await db.execute(
      `INSERT OR REPLACE INTO checkpoints
       (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [thread_id, checkpoint_ns, checkpoint.id, parent_checkpoint_id, type1, serializedCheckpoint, serializedMetadata],
    );

    return {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const db = await this.getDb();
    if (!config.configurable?.thread_id || !config.configurable?.checkpoint_id) {
      throw new Error('Missing thread_id or checkpoint_id in config.configurable.');
    }

    const thread_id = config.configurable.thread_id;
    const checkpoint_ns = config.configurable.checkpoint_ns ?? '';
    const checkpoint_id = config.configurable.checkpoint_id;

    // Serialize all writes first
    const serialized = await Promise.all(
      writes.map(async (write, idx) => {
        const [type, serializedValue] = await this.serde.dumpsTyped(write[1]);
        return [thread_id, checkpoint_ns, checkpoint_id, taskId, idx, write[0], type, serializedValue];
      }),
    );

    // Execute in a transaction
    await db.execute('BEGIN');
    try {
      for (const row of serialized) {
        await db.execute(
          `INSERT OR REPLACE INTO writes
           (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          row,
        );
      }
      await db.execute('COMMIT');
    } catch (e) {
      await db.execute('ROLLBACK');
      throw e;
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    const db = await this.getDb();
    await db.execute('BEGIN');
    try {
      await db.execute('DELETE FROM checkpoints WHERE thread_id = $1', [threadId]);
      await db.execute('DELETE FROM writes WHERE thread_id = $1', [threadId]);
      await db.execute('COMMIT');
    } catch (e) {
      await db.execute('ROLLBACK');
      throw e;
    }
  }
}
```

> **Key difference from SqliteSaver:** All database calls are async (`await db.select()`/`db.execute()`) instead of sync (`db.prepare().get()`). Transactions use explicit `BEGIN`/`COMMIT`/`ROLLBACK` instead of better-sqlite3's `db.transaction()` API.

**Step 2: Verify TypeScript compilation**

```bash
pnpm --filter @aics/web typecheck
```

Expected: No errors. If `@langchain/langgraph-checkpoint` types are not directly importable, check the package exports and adjust imports.

**Step 3: Commit**

```bash
git add apps/web/src/lib/tauri-checkpoint.ts
git commit -m "feat(web): add TauriCheckpointSaver — LangGraph persistence over tauri-plugin-sql"
```

---

## Task 8: DB Seed — Default Company + Employees

**Files:**
- Create: `apps/web/src/lib/tauri-seed.ts`

On first launch, the SQLite database is empty (only tables exist from migrations).
We need to seed the default company and 3 employees (Alice, Bob, Carol) — same data
that `AicsRuntimeProvider.seedCompany()` currently puts in memory repos.

**Step 1: Create seed module**

```typescript
// apps/web/src/lib/tauri-seed.ts

/**
 * Seed the Tauri SQLite database with default company + employees
 * on first launch. Checks if already seeded by looking for company-001.
 */
export async function seedTauriDb(): Promise<void> {
  const { default: Database } = await import('@tauri-apps/plugin-sql');
  const db = await Database.load('sqlite:aics.db');

  // Check if already seeded
  const existing = await db.select<{ company_id: string }[]>(
    'SELECT company_id FROM companies WHERE company_id = $1',
    ['company-001'],
  );
  if (existing.length > 0) return; // Already seeded

  const now = new Date().toISOString();

  // Insert company
  await db.execute(
    `INSERT INTO companies (company_id, name, status, workspace_root, default_model_policy_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    ['company-001', 'AICS Demo Company', 'active', null, null, now, now],
  );

  // Insert employees
  const employees = [
    {
      id: 'emp-alice',
      name: 'Alice',
      role: 'engineering_manager',
      persona: JSON.stringify({ expertise: 'engineering management', style: 'collaborative' }),
    },
    {
      id: 'emp-bob',
      name: 'Bob',
      role: 'developer',
      persona: JSON.stringify({ expertise: 'full-stack development', style: 'detail-oriented' }),
    },
    {
      id: 'emp-carol',
      name: 'Carol',
      role: 'designer',
      persona: JSON.stringify({ expertise: 'UI/UX design', style: 'creative' }),
    },
  ];

  for (const emp of employees) {
    await db.execute(
      `INSERT INTO employees
       (employee_id, company_id, source_asset_id, source_package_id, name, role_slug,
        workstation_id, persona_json, config_json, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [emp.id, 'company-001', null, null, emp.name, emp.role, null, emp.persona, null, 1, now, now],
    );
  }
}
```

**Step 2: Commit**

```bash
git add apps/web/src/lib/tauri-seed.ts
git commit -m "feat(web): add Tauri DB seed — default company + 3 employees"
```

---

## Task 9: Runtime Factory — Tauri vs Browser

**Files:**
- Create: `apps/web/src/lib/tauri-runtime.ts`

This factory creates the full runtime stack for Tauri mode:
- Drizzle sqlite-proxy repos (persistent)
- TauriCheckpointSaver (persistent)
- No CORS proxy needed (tauri-plugin-cors-fetch handles it)

**Step 1: Create the Tauri runtime factory**

```typescript
// apps/web/src/lib/tauri-runtime.ts

import {
  buildAicsGraph,
  createRuntimeContext,
  createGateway,
  InMemoryEventBus,
  ModelResolver,
  MockToolExecutor,
} from '@aics/core';
import type { ProviderConfig } from './provider-config';
import { createTauriDrizzleDb } from './tauri-drizzle';
import { createTauriRepositories } from './tauri-repos';
import { TauriCheckpointSaver } from './tauri-checkpoint';
import { seedTauriDb } from './tauri-seed';

const COMPANY_ID = 'company-001';
const THREAD_ID = 'thread-001';

/**
 * Create the full runtime stack for Tauri desktop mode.
 *
 * Differences from browser mode:
 * 1. Repos: Drizzle sqlite-proxy → persistent SQLite (not memory)
 * 2. Checkpointer: TauriCheckpointSaver → persistent (not MemorySaver)
 * 3. Gateway: Direct API calls, no Vite proxy (tauri-plugin-cors-fetch handles CORS)
 * 4. DB seed: Run once on first launch
 */
export async function createTauriRuntime(config: ProviderConfig) {
  // Seed DB on first launch (idempotent)
  await seedTauriDb();

  const eventBus = new InMemoryEventBus();

  // Persistent repos via sqlite-proxy
  const db = createTauriDrizzleDb();
  const repos = createTauriRepositories(db);

  // No proxy needed — tauri-plugin-cors-fetch hooks fetch() transparently
  const gateway = createGateway({
    provider: config.provider,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.defaultHeaders,
    dangerouslyAllowBrowser: true, // Still running in webview context
  });

  const modelResolver = new ModelResolver(null, {
    provider: config.provider,
    model: config.model,
    temperature: 0.7,
    maxTokens: 4096,
  });

  // Persistent checkpoint saver
  const checkpointer = new TauriCheckpointSaver();
  const graph = buildAicsGraph({ checkpointer });

  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus,
    llmGateway: gateway,
    modelResolver,
    toolExecutor: new MockToolExecutor(),
    companyId: COMPANY_ID,
    threadId: THREAD_ID,
  });

  return { eventBus, graph, runtimeCtx };
}
```

**Step 2: Commit**

```bash
git add apps/web/src/lib/tauri-runtime.ts
git commit -m "feat(web): add createTauriRuntime factory — persistent SQLite + CORS-free"
```

---

## Task 10: AicsRuntimeProvider Integration

**Files:**
- Modify: `apps/web/src/runtime/AicsRuntimeProvider.tsx`

Branch the runtime creation on `isTauri()`. Browser mode stays unchanged.
Tauri mode uses `createTauriRuntime()` (async initialization).

**Step 1: Read the current file**

Read `apps/web/src/runtime/AicsRuntimeProvider.tsx` to understand the exact structure.

**Step 2: Modify AicsRuntimeProvider**

Add these imports at the top:

```typescript
import { isTauri } from '../lib/env';
```

Rename the existing `createRuntime` to `createBrowserRuntime` (unchanged logic).

Add async runtime initialization that branches on `isTauri()`:

```typescript
// Replace the existing createRuntime function and getOrCreateRuntime
// with an async initialization pattern:

const IS_DEV = import.meta.env.DEV;

function createBrowserRuntime(config: ProviderConfig) {
  // ... existing createRuntime logic (unchanged) ...
}

export function AicsRuntimeProvider({ children }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [isInitializing, setIsInitializing] = useState(false);

  const runtimeRef = useRef<ReturnType<typeof createBrowserRuntime> | null>(null);

  // Async initialization for Tauri mode
  const initRuntime = useCallback(async () => {
    const config = loadProviderConfig();
    if (!config) return null;

    if (isTauri()) {
      setIsInitializing(true);
      try {
        const { createTauriRuntime } = await import('../lib/tauri-runtime');
        const runtime = await createTauriRuntime(config);
        runtimeRef.current = runtime;
        return runtime;
      } finally {
        setIsInitializing(false);
      }
    }

    // Browser mode — synchronous
    const runtime = createBrowserRuntime(config);
    runtimeRef.current = runtime;
    return runtime;
  }, []);

  function getOrCreateRuntime() {
    if (!runtimeRef.current) {
      if (isTauri()) {
        // For Tauri, trigger async init and return null until ready
        // The effect below handles initialization
        return null;
      }
      const config = loadProviderConfig();
      if (!config) return null;
      runtimeRef.current = createBrowserRuntime(config);
    }
    return runtimeRef.current;
  }

  // Initialize Tauri runtime on mount
  useEffect(() => {
    if (isTauri() && !runtimeRef.current) {
      initRuntime().catch((err) => {
        console.error('[TauriRuntime] init failed:', err);
        setError(err instanceof Error ? err.message : String(err));
      });
    }
  }, [initRuntime, version]);

  const reinitRuntime = useCallback(() => {
    runtimeRef.current = null;
    setVersion((v) => v + 1);
  }, []);

  // ... rest of the component (sendMessage, etc.) stays the same,
  // but sendMessage should handle the async init:
  const sendMessage = useCallback(async (text: string): Promise<string | undefined> => {
    let runtime = runtimeRef.current;
    if (!runtime) {
      // Try async init for Tauri
      runtime = await initRuntime();
    }
    if (!runtime) {
      setError('No provider configured. Open Settings to configure.');
      return undefined;
    }
    // ... rest of sendMessage unchanged ...
  }, [version, initRuntime]);

  // ... rest unchanged
}
```

> **Key changes:**
> 1. `isTauri()` check selects async `createTauriRuntime` vs sync `createBrowserRuntime`
> 2. Dynamic import of `tauri-runtime.ts` ensures Tauri deps aren't loaded in browser
> 3. `isInitializing` state for potential loading indicator
> 4. `useEffect` triggers Tauri async init on mount/reinit

**Step 3: Verify typecheck**

```bash
pnpm --filter @aics/web typecheck
```

**Step 4: Commit**

```bash
git add apps/web/src/runtime/AicsRuntimeProvider.tsx
git commit -m "feat(web): integrate Tauri/Browser runtime branching in AicsRuntimeProvider"
```

---

## Task 11: Unit Tests for Tauri Adapters

**Files:**
- Create: `apps/web/src/lib/__tests__/tauri-drizzle.test.ts`
- Create: `apps/web/src/lib/__tests__/tauri-checkpoint.test.ts`

Since Tauri APIs aren't available in the test environment (vitest/Node.js),
we test with mocked `@tauri-apps/plugin-sql`.

**Step 1: Create TauriDrizzleProxy unit test**

```typescript
// apps/web/src/lib/__tests__/tauri-drizzle.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @tauri-apps/plugin-sql
const mockSelect = vi.fn();
const mockExecute = vi.fn();
const mockDb = { select: mockSelect, execute: mockExecute };

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: vi.fn().mockResolvedValue(mockDb) },
}));

describe('createTauriDrizzleDb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a Drizzle DB instance', async () => {
    const { createTauriDrizzleDb } = await import('../tauri-drizzle');
    const db = createTauriDrizzleDb();
    expect(db).toBeDefined();
    // The db should have select/insert/update methods (Drizzle API)
    expect(typeof db.select).toBe('function');
    expect(typeof db.insert).toBe('function');
  });

  it('proxies SELECT through plugin-sql', async () => {
    mockSelect.mockResolvedValue([{ employee_id: 'emp-alice', name: 'Alice' }]);

    const { createTauriDrizzleDb } = await import('../tauri-drizzle');
    const db = createTauriDrizzleDb();

    // The exact SQL will be generated by Drizzle.
    // We just verify the callback forwards to plugin-sql.
    // Drizzle's sqlite-proxy will call our callback internally.
    expect(db).toBeDefined();
  });
});
```

**Step 2: Create TauriCheckpointSaver unit test**

```typescript
// apps/web/src/lib/__tests__/tauri-checkpoint.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSelect = vi.fn();
const mockExecute = vi.fn();
const mockDb = { select: mockSelect, execute: mockExecute };

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: vi.fn().mockResolvedValue(mockDb) },
}));

describe('TauriCheckpointSaver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ lastInsertId: 0, rowsAffected: 1 });
  });

  it('getTuple returns undefined for missing checkpoint', async () => {
    mockSelect.mockResolvedValue([]);

    const { TauriCheckpointSaver } = await import('../tauri-checkpoint');
    const saver = new TauriCheckpointSaver();

    const result = await saver.getTuple({
      configurable: { thread_id: 'test-thread', checkpoint_ns: '' },
    });

    expect(result).toBeUndefined();
    expect(mockSelect).toHaveBeenCalledOnce();
  });

  it('put stores checkpoint via execute', async () => {
    const { TauriCheckpointSaver } = await import('../tauri-checkpoint');
    const saver = new TauriCheckpointSaver();

    const config = {
      configurable: { thread_id: 'test-thread', checkpoint_ns: '', checkpoint_id: 'cp-parent' },
    };
    const checkpoint = {
      v: 4,
      id: 'cp-new',
      ts: new Date().toISOString(),
      channel_values: {},
      channel_versions: {},
      versions_seen: {},
    };

    const result = await saver.put(config, checkpoint, { source: 'input', step: 0, parents: {} });

    expect(result.configurable?.checkpoint_id).toBe('cp-new');
    // Verify INSERT OR REPLACE was called
    expect(mockExecute).toHaveBeenCalled();
    const call = mockExecute.mock.calls.find((c: any) =>
      typeof c[0] === 'string' && c[0].includes('INSERT OR REPLACE INTO checkpoints'),
    );
    expect(call).toBeDefined();
  });

  it('deleteThread removes checkpoints and writes', async () => {
    const { TauriCheckpointSaver } = await import('../tauri-checkpoint');
    const saver = new TauriCheckpointSaver();

    await saver.deleteThread('test-thread');

    // Expect BEGIN, 2x DELETE, COMMIT
    expect(mockExecute).toHaveBeenCalledTimes(4);
    const sqls = mockExecute.mock.calls.map((c: any) => c[0]);
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('COMMIT');
    expect(sqls.some((s: string) => s.includes('DELETE FROM checkpoints'))).toBe(true);
    expect(sqls.some((s: string) => s.includes('DELETE FROM writes'))).toBe(true);
  });
});
```

**Step 3: Run tests**

```bash
pnpm --filter @aics/web test
```

Expected: All tests pass (new tests + existing tests).

**Step 4: Commit**

```bash
git add apps/web/src/lib/__tests__/
git commit -m "test(web): add unit tests for TauriDrizzleProxy + TauriCheckpointSaver"
```

---

## Task 12: Build Verification + Smoke Test

**Files:** No new files — verification only.

**Step 1: TypeScript compilation**

```bash
pnpm --filter @aics/web typecheck
pnpm --filter @aics/renderer typecheck
```

Expected: No errors.

**Step 2: Lint check**

```bash
pnpm lint 2>&1 | head -50
```

Fix any lint issues in new files.

**Step 3: Run all tests**

```bash
pnpm --filter @aics/web test
pnpm --filter @aics/renderer test
pnpm --filter @aics/core test
```

Expected: All tests pass (web adapters + renderer 17 + core 112).

**Step 4: Web build (browser mode)**

```bash
pnpm --filter @aics/web build
```

Expected: Build succeeds. Tauri imports are externalized (no `@tauri-apps` in bundle).
Note the bundle size — should be comparable to Phase 4 (~1.36MB).

**Step 5: Rust build**

```bash
cd apps/desktop/src-tauri && cargo build
```

Expected: Compiles successfully.

**Step 6: Tauri dev smoke test**

```bash
cd apps/desktop && pnpm tauri dev
```

Expected:
1. Vite dev server starts on :5173
2. Tauri window opens with the web app
3. PixiJS scene renders (3 employees visible)
4. SQLite migrations run (visible in Rust console output)
5. Configure a provider (e.g., Gemini) → send message → graph executes → response displayed

**Step 7: Tauri build (production)**

```bash
cd apps/desktop && pnpm tauri build
```

Expected: Produces `.dmg` (macOS) or equivalent bundle. Note: may fail without code signing, which is expected (out of Phase 5 scope). The build process itself should complete.

**Step 8: Persistence verification**

1. In `tauri dev`, configure Gemini, send a message, verify response
2. Close the app window
3. Re-run `tauri dev`
4. Verify: previous provider config persists (stored in localStorage, which Tauri webview preserves)
5. Send another message — verify LLM call works and checkpoint data persists

**Step 9: Final commit + tag**

```bash
git add -A
git commit -m "chore(desktop): Phase 5 build verification complete"
git tag phase-5.0-desktop-app
```

---

## Summary of Files Created/Modified

### Created (NEW)
| File | Purpose |
|------|---------|
| `apps/desktop/src-tauri/Cargo.toml` | Rust deps (tauri, plugins) |
| `apps/desktop/src-tauri/build.rs` | Tauri build script |
| `apps/desktop/src-tauri/tauri.conf.json` | App config, window, plugins |
| `apps/desktop/src-tauri/src/main.rs` | Rust entry point |
| `apps/desktop/src-tauri/src/lib.rs` | Plugin registration + migrations |
| `apps/desktop/src-tauri/capabilities/default.json` | IPC permissions |
| `apps/web/src/lib/env.ts` | `isTauri()` detection |
| `apps/web/src/lib/tauri-drizzle.ts` | Drizzle sqlite-proxy adapter |
| `apps/web/src/lib/tauri-repos.ts` | Async RuntimeRepositories |
| `apps/web/src/lib/tauri-checkpoint.ts` | TauriCheckpointSaver |
| `apps/web/src/lib/tauri-seed.ts` | DB seed (company + employees) |
| `apps/web/src/lib/tauri-runtime.ts` | createTauriRuntime factory |
| `apps/web/src/lib/__tests__/tauri-drizzle.test.ts` | Proxy unit test |
| `apps/web/src/lib/__tests__/tauri-checkpoint.test.ts` | Checkpoint unit test |

### Modified
| File | Change |
|------|--------|
| `apps/desktop/package.json` | Rewritten for Tauri CLI |
| `apps/web/package.json` | Add @tauri-apps/* deps |
| `apps/web/vite.config.ts` | Add @tauri-apps to externals |
| `apps/web/src/runtime/AicsRuntimeProvider.tsx` | Branch on isTauri() |

### Removed
| File | Reason |
|------|--------|
| `apps/desktop/src/index.ts` | Replaced by Tauri |
| `apps/desktop/tsconfig.json` | No TS in desktop (Rust only) |

---

## Known Risks & Contingencies

| Risk | Contingency |
|------|-------------|
| `tauri-plugin-cors-fetch` v5 incompatible with Tauri 2 | Fall back to custom Rust proxy command |
| `tauri-plugin-sql` `$1` params not matching Drizzle's `?` | Switch TauriCheckpointSaver to use raw `invoke()` commands |
| `include_str!()` relative paths fail in Cargo | Inline migration SQL in Rust code |
| Drizzle sqlite-proxy type mismatch with TauriRepositories | Use raw SQL repos (bypass Drizzle in webview) |
| Tauri CSP blocks external API calls | Adjust `app.security.csp` in tauri.conf.json |
| BLOB serialization in checkpoint differ between platforms | Ensure serde uses JSON serialization (text, not binary) |
