# Phase 5: Tauri 2 Desktop App — Design Document

## Context

Phase 3-4 delivered a working web shell with chat, PixiJS office scene, and streaming
agent execution. But the web version has fundamental browser constraints:

- **No persistent storage** — MemorySaver, data lost on reload
- **CORS limitations** — Vite proxy required, some providers (Anthropic) don't work
- **No file system** — can't manage installed packages or workspace files
- **No SQLite** — the 21-table local runtime schema (db-local) is unused

Per PROJECT_CONSTITUTION §8: _"Desktop is the 1.0 reference environment."_

Phase 5 turns `apps/desktop` from an empty stub into a full-capability Tauri 2
desktop application — the product's reference environment.

## Architecture

```
┌─ Tauri 2 Application ──────────────────────────────────┐
│                                                         │
│  ┌─ Webview (apps/web build) ────────────────────────┐  │
│  │  React UI + PixiJS scene (unchanged)              │  │
│  │  @aics/core LangGraph (unchanged logic)           │  │
│  │                                                    │  │
│  │  Persistence adapter layer (NEW):                 │  │
│  │  ├── TauriDrizzleProxy: sqlite-proxy → invoke()   │  │
│  │  ├── TauriCheckpointSaver: LangGraph → invoke()   │  │
│  │  └── TauriRepositories: Drizzle repos over IPC    │  │
│  │                                                    │  │
│  │  Network:                                         │  │
│  │  └── fetch() → tauri-plugin-cors-fetch → native   │  │
│  │                                                    │  │
│  │  Environment detection:                           │  │
│  │  └── isTauri() ? TauriRuntime : BrowserRuntime    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Rust Backend (src-tauri/) ───────────────────────┐  │
│  │  Tauri plugins:                                   │  │
│  │  ├── tauri-plugin-sql (SQLite via sqlx)            │  │
│  │  ├── tauri-plugin-cors-fetch (CORS bypass)         │  │
│  │  ├── tauri-plugin-fs (file system)                 │  │
│  │  └── tauri-plugin-shell (optional: MCP/CLI)        │  │
│  │                                                    │  │
│  │  Custom commands:                                 │  │
│  │  ├── db_execute(sql, params) → rows               │  │
│  │  ├── db_checkpoint_get/put (LangGraph IPC)        │  │
│  │  ├── app_info() → version, data_dir               │  │
│  │  └── app_reset_db() → re-run migrations           │  │
│  │                                                    │  │
│  │  Startup:                                         │  │
│  │  └── SQLite init + migration on launch             │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Key Design Decisions

**D1: LangGraph stays in the webview (JS/TS).**
LangGraph has no Rust SDK. Moving it to Rust would require a full rewrite.
The webview runs the same @aics/core code as the browser version.

**D2: SQLite accessed via Drizzle sqlite-proxy over Tauri IPC.**
Webview has no native module support. Drizzle's `sqlite-proxy` driver generates
SQL in JS, sends it via `invoke('db_execute', { sql, params })` to Rust, which
executes with sqlx and returns results. No better-sqlite3 needed.

**D3: LLM calls go through tauri-plugin-cors-fetch.**
This plugin hooks `window.fetch()` transparently — OpenAI SDK's fetch calls
just work without code changes. No more Vite proxy, all providers work.

**D4: LangGraph checkpoints via custom IPC commands.**
LangGraph's checkpoint protocol (get/put/list) maps to 3 Tauri commands that
read/write the `checkpoints` and `writes` tables in SQLite. We write a
`TauriCheckpointSaver` implementing `BaseCheckpointSaver`.

**D5: Environment detection via `window.__TAURI__`.**
At runtime, `AicsRuntimeProvider` checks for Tauri presence and selects
the appropriate adapter: TauriRuntime (SQLite, native fetch) vs
BrowserRuntime (memory, Vite proxy).

## Scope

### In Scope (Phase 5)

| # | Deliverable |
|---|-------------|
| 1 | Tauri 2 project init (src-tauri/, Cargo.toml, tauri.conf.json) |
| 2 | Rust SQLite setup with sqlx + auto-migrations on startup |
| 3 | `db_execute` Tauri command (generic SQL proxy for Drizzle) |
| 4 | `TauriDrizzleProxy` — Drizzle sqlite-proxy adapter using invoke() |
| 5 | `TauriCheckpointSaver` — LangGraph checkpoint over IPC |
| 6 | `TauriRepositories` — Drizzle repos wrapping sqlite-proxy |
| 7 | tauri-plugin-cors-fetch integration (transparent CORS bypass) |
| 8 | tauri-plugin-fs integration (workspace file access) |
| 9 | Environment detection + runtime factory (Tauri vs Browser) |
| 10 | AicsRuntimeProvider desktop branch (use Tauri adapters) |
| 11 | DB seed: default company + 3 employees (Alice, Bob, Carol) |
| 12 | `tauri dev` + `tauri build` working on macOS |
| 13 | App window config (title, min size, icon) |
| 14 | Unit tests for TauriDrizzleProxy + TauriCheckpointSaver |
| 15 | Build verification (Rust + TS, all packages) |

### NOT in Scope

- Install flow UI (install-core integration → Phase 6)
- Multi-window / tray icon
- Auto-updater (tauri-plugin-updater → later)
- Code signing / notarization (release phase)
- Cross-platform CI (Linux/Windows builds → later)
- Local HTTP server on port 43111 (deferred — IPC is sufficient for 1.0)

## Tauri Configuration

### tauri.conf.json (key fields)

```json
{
  "productName": "AI Company Simulator",
  "identifier": "com.aics.desktop",
  "build": {
    "beforeDevCommand": "pnpm --filter @aics/web dev",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "pnpm --filter @aics/web build",
    "frontendDist": "../web/dist"
  },
  "app": {
    "windows": [{
      "title": "AI Company Simulator",
      "width": 1280,
      "height": 800,
      "minWidth": 1024,
      "minHeight": 700
    }]
  },
  "plugins": {
    "sql": { "preload": { "aics": "sqlite:aics.db" } },
    "fs": { "scope": { "allow": ["$APPDATA/**", "$DOWNLOAD/**"] } }
  }
}
```

### Cargo dependencies (src-tauri/Cargo.toml)

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
tauri-plugin-cors-fetch = "5"
tauri-plugin-fs = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

## Data Flow: Drizzle sqlite-proxy

```
  Webview (JS)                          Rust Backend
  ────────────                          ────────────
  Drizzle query
  db.select().from(employees)
      │
      ▼
  sqlite-proxy callback
  → invoke('db_execute', {
      sql: "SELECT * FROM employees",
      params: [],
      method: "all"
    })
      │
      ├──── Tauri IPC ────────────────► db_execute command
      │                                 │
      │                                 ▼
      │                                 sqlx::query(sql)
      │                                   .bind(params)
      │                                   .fetch_all(&pool)
      │                                 │
      ◄──── IPC response ─────────────┤
      │
      ▼
  Drizzle maps rows to typed objects
  → EmployeeRow[]
```

## Data Flow: LangGraph Checkpoints

LangGraph's `BaseCheckpointSaver` has 3 methods:
- `getTuple(config)` → get latest checkpoint for thread
- `putWrites(config, writes, taskId)` → store pending writes
- `put(config, checkpoint, metadata, newVersions)` → store checkpoint

Each maps to a Tauri command:

```typescript
class TauriCheckpointSaver extends BaseCheckpointSaver {
  async getTuple(config) {
    return invoke('db_checkpoint_get', { threadId, checkpointId });
  }
  async put(config, checkpoint, metadata) {
    return invoke('db_checkpoint_put', { threadId, checkpoint, metadata });
  }
  async putWrites(config, writes, taskId) {
    return invoke('db_checkpoint_writes', { threadId, writes, taskId });
  }
}
```

The Rust side stores these in the `checkpoints` and `writes` tables that
`@langchain/langgraph-checkpoint-sqlite`'s SqliteSaver normally creates.
We replicate its schema exactly to maintain compatibility.

## Data Flow: LLM Calls (CORS bypass)

```
  Webview (JS)                          Tauri Plugin
  ────────────                          ────────────
  OpenAI SDK
  new OpenAI({ apiKey, baseURL })
      │
      ▼
  fetch('https://api.openai.com/...')
      │
      ▼ (hooked by cors-fetch plugin)
  tauri-plugin-cors-fetch
      │
      ├──── IPC ──────────────────────► Rust HTTP client
      │                                 (reqwest / hyper)
      │                                 │
      │                                 ▼
      │                                 api.openai.com
      │                                 (no CORS headers needed)
      │                                 │
      ◄──── IPC response ─────────────┤
      │
      ▼
  OpenAI SDK processes response
  (streaming SSE works natively!)
```

**All providers work** — Anthropic, OpenAI, Gemini, Kimi, OpenRouter — because
the request goes through native HTTP, not the browser's fetch sandbox.

## Environment Detection

```typescript
// packages/core or apps/web shared lib:
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

// In AicsRuntimeProvider:
function createRuntime(config: ProviderConfig) {
  if (isTauri()) {
    return createTauriRuntime(config);  // SQLite + native fetch
  }
  return createBrowserRuntime(config);  // Memory + Vite proxy
}
```

### createTauriRuntime

```typescript
function createTauriRuntime(config: ProviderConfig) {
  const eventBus = new InMemoryEventBus();
  const db = createTauriDrizzleProxy();        // sqlite-proxy over IPC
  const repos = createDrizzleRepositories(db);  // existing db-local repos
  const checkpointer = new TauriCheckpointSaver();

  // No proxy needed — cors-fetch plugin handles it
  const gateway = createGateway({
    provider: config.provider,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.defaultHeaders,
    dangerouslyAllowBrowser: true,  // still in webview context
  });

  // ... rest same as browser
}
```

## File Structure

### apps/desktop/ (REWRITTEN from stub)
```
apps/desktop/
├── package.json           # Tauri CLI + workspace deps
├── src-tauri/
│   ├── Cargo.toml         # Rust deps
│   ├── build.rs           # Tauri build script
│   ├── tauri.conf.json    # App config
│   ├── capabilities/
│   │   └── default.json   # Permission grants
│   ├── icons/             # App icons
│   └── src/
│       ├── main.rs        # Entry point, plugin registration
│       ├── db.rs          # SQLite init, migrations, db_execute command
│       ├── checkpoint.rs  # LangGraph checkpoint IPC commands
│       └── lib.rs         # Module declarations
```

### apps/web/src/ (MODIFIED — adapter layer)
```
apps/web/src/
├── lib/
│   ├── env.ts             # NEW: isTauri() detection
│   ├── tauri-drizzle.ts   # NEW: Drizzle sqlite-proxy adapter
│   ├── tauri-checkpoint.ts # NEW: TauriCheckpointSaver
│   └── tauri-repos.ts     # NEW: repository factory for Tauri
├── runtime/
│   └── AicsRuntimeProvider.tsx  # MODIFIED: branch on isTauri()
```

### packages/db-local/ (UNCHANGED)
```
No changes needed! db-local only defines Drizzle schema.
The sqlite-proxy driver is injected at the app level.
```

## SQLite Migration Strategy

Tauri's `tauri-plugin-sql` supports migrations via Rust `Migration` structs.
We'll embed the same DDL from `Docs/03_migrations/aics_migrations_local_v0.1/`
into Rust code:

```rust
// src-tauri/src/db.rs
use tauri_plugin_sql::{Migration, MigrationKind};

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "core tables",
            sql: include_str!("../../Docs/03_migrations/aics_migrations_local_v0.1/001_core.sql"),
            kind: MigrationKind::Up,
        },
        // ... 002, 003, 004, 005
    ]
}
```

Migrations run automatically on app startup before the webview loads.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Drizzle sqlite-proxy perf (IPC per query) | Batch queries where possible; SQLite is fast enough for local use |
| LangGraph checkpoint protocol mismatch | Replicate SqliteSaver's exact table schema; test with checkpoint round-trip |
| tauri-plugin-cors-fetch SSE streaming | Plugin docs confirm SSE support; test with OpenAI streaming |
| Rust compile time slows dev loop | `tauri dev` uses hot-reload for frontend; Rust only recompiles on backend changes |
| App bundle size (+PixiJS +Tauri) | Tauri uses system webview (no bundled Chromium); total ~15MB vs Electron's 150MB |
| macOS Gatekeeper without code signing | Dev builds run unsigned; release signing is out of Phase 5 scope |

## Verification Criteria

1. `cargo tauri dev` → window opens, PixiJS scene renders
2. Configure Gemini → send message → graph executes → response displayed
3. Close app → reopen → previous data persists in SQLite
4. Anthropic provider works (no CORS issue)
5. `cargo tauri build` → .dmg/.app produced
6. Renderer tests: 17 pass
7. Core tests: 112 pass
8. Desktop-specific adapter tests pass
