# Desktop Runtime Guidance

Tauri 2 桌面壳，零 npm deps，frontendDist 直接指 `../../web/dist`。改完 `packages/ui-office` 必须先 `pnpm --filter @offisim/ui-office build` → 再 `pnpm --filter @offisim/desktop build`，否则 release `.app` 还是旧 UI。

## Capabilities & privileged invokes

- 特权 Tauri command 按用途拆 capability：项目 fs/shell 走 `offisim:fs-shell`（permission `fs-shell`），本地 agent / LLM / provider / session / kanban bridge 走 `offisim:agent-bridges`（permission `agent-bridges`）。
- 两条 capability 都允许 `main` + `main-live` 两个 window（live preview / release rebuild 都靠 `main-live`）。**不要**直接发到 child / preview / remote window，要扩 window 名先做安全 review。
- Plugin defaults 维护在 `src-tauri/capabilities/default.json`；Offisim 自家 command allowlist 维护在 `src-tauri/permissions/*.toml`。

## Plugin checklist (改前先核对)

`src-tauri/Cargo.toml` + `src-tauri/src/lib.rs` `.plugin(...)` + `capabilities/default.json` 三处必须同步，缺一个就是 runtime 静默 no-op：

- `tauri-plugin-single-instance` — **必须放在 `.plugin(...)` 链最前**；否则第二个 dev 实例会和已运行实例共用 SQLite，黑屏挂死
- `tauri-plugin-fs` — `fs:default` + `fs:allow-app-{read,write,meta}-recursive`（vault 写盘）
- `tauri-plugin-dialog` — `dialog:default` + `dialog:allow-open`（folder picker）
- `tauri-plugin-opener` — `opener:default` + `opener:allow-reveal-item-in-dir` + `opener:allow-open-path`（reveal in Finder）
- `tauri-plugin-sql` — `sql:default` + `sql:allow-{load,select,execute,close}`
- `cors-fetch` — `cors-fetch:default`
- `tauri-plugin-deep-link` — `deep-link:default`（`offisim://install`）

## Builtin tool sandbox

`src-tauri/src/builtin_tools.rs` 实现 `read_file` / `write_file` / `bash` / `project_read_file_preview` 等 builtin，仅 `gateway` lane 注入（commits `3f618ce9` / `50c1e296`），SDK lane 不暴露。硬上限不可绕：

- `MAX_PREVIEW_BYTES` = 64 KB（`project_read_file_preview`，UI 文件树唯一入口）
- `MAX_READ_BYTES` = 8 MB（`project_read_file`，agent tool lane）
- `MAX_WRITE_BYTES` = 8 MB
- `DEFAULT_MAX_OUTPUT_BYTES` = 1 MB（`bash` stdout/stderr 各自上限）

所有 path 必须 resolve 在 project `workspace_root` 内，越界拒绝。

Project workspace file browsing from the webview must use the sandboxed Tauri commands `project_list_dir` / `project_read_file` / `project_read_file_preview` with a selected project `workspace_root`. Do not use `tauri-plugin-fs` directly for repo/project paths; plugin-fs is for app-owned/vault paths, not arbitrary workspace traversal.

Release/live validation is release `.app` only: rebuild `@offisim/ui-office` and `@offisim/desktop`, launch `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app` via `open -b com.offisim.desktop`, and capture Offisim window screenshots. Dev webview/browser results do not satisfy desktop runtime verification.

## Credential isolation

`src-tauri/src/llm_transport.rs` + `runtime_secrets.rs` 让 LLM key 不越 Rust→JS 边界：

- `gateway` lane 走 `llm_fetch` + `llm_fetch_abort` command + `Channel<TransportEvent>` streaming IPC
- `claude-agent-sdk` lane 走 `claude_agent_execute`（`claude_agent_host.rs` sidecar，env 注入 provider secret）
- `codex-agent-sdk` lane 走 `codex_agent_execute`（`codex_agent_host.rs` + `resources/codex-agent-host.mjs`）
- `openai-agents-sdk` lane 复用 `llm_fetch` 作为 SDK transport override

Secret 落 `<app_local_data_dir>/runtime_secret.txt`（mode 0600，atomic tmp+rename），**不用 macOS Keychain**（`keyring` 3.x mock 丢写 + code-sign rebuild 触发 ACL prompt）。

## Local SQLite

未上线口径单基线 schema：`packages/db-local/src/schema.sql`，`local_db.rs` 启动时直接 bootstrap，不保留 migration 链（commit `ba7788c9`）。改 schema → 同步 `packages/db-local/src/schema.ts` + `schema.sql`。预发版需要清脏数据走 release run action（仓库已提供），不要手写 migration。

## Release CSP / platform CORS coupling

Tauri release `.app` CSP `connect-src` 与 `apps/platform/src/startup.ts` `DEV_DEFAULT_ORIGINS` 是两条**独立但成对**的 allowlist：

- **Invariant A** — CSP `connect-src` ⊇ platform listen origins（`http://localhost:4100` / `https://localhost:4100` / `tauri://localhost`）
- **Invariant B** — platform CORS ⊇ `tauri://localhost`

任一侧漂移会被 `scripts/check-platform-tauri-origin-sync.mjs` 在 `apps/desktop` / `apps/platform` 的 `prebuild` 拦下。完整规范见 `openspec/specs/desktop-llm-credential-isolation/spec.md` 的 `Tauri release \`.app\` CSP SHALL allow platform endpoint origins` Requirement。

## Rust 模块速查

| 文件 | 职责 |
|------|------|
| `lib.rs` | plugin 注册顺序 + command 注册（特权 command 必须挂 capability） |
| `builtin_tools.rs` | `read_file` / `write_file` / `bash` / 文件预览 sandbox |
| `llm_transport.rs` | `gateway` lane HTTP transport bridge |
| `claude_agent_host.rs` / `codex_agent_host.rs` | SDK lane sidecar |
| `runtime_secrets.rs` | provider secret atomic IO |
| `local_db.rs` | SQLite bootstrap + connection pool |
| `local_paths.rs` | workspace_root resolution + 路径校验 helper |
| `mcp_bridge/` | desktop 专属 MCP bridge（web 没有） |
| `kanban.rs` | kanban CAS transition |
| `git.rs` | `GitAutoCommitService` desktop 端 |
| `deep_link.rs` | `offisim://install` |
| `sessions.rs` / `resume.rs` | session / resume bridge |
| `sidecar_stderr.rs` | sidecar 日志收集 |
