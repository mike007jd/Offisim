# Desktop Runtime Guidance

Tauri 2 桌面壳，frontendDist 直接指 `../renderer/dist`。renderer 拥有新 UI framework：React 19 + Tailwind CSS v4 + shadcn/ui + assistant-ui + Motion for React + lucide-react + TanStack Query/Zustand/Form/Virtual + dnd-kit + react-resizable-panels + cmdk + Sonner。框架 source of truth 是 `../../Docs/UI_FRAMEWORK_STACK.md`。改 renderer 后直接跑 `pnpm --filter @offisim/desktop-renderer build` → `pnpm --filter @offisim/desktop build`。

## Capabilities & privileged invokes

- 特权 Tauri command 按用途拆 capability：项目 fs/shell 走 `offisim:fs-shell`（permission `fs-shell`），Pi Agent Host / session / MCP bridge 走 `offisim:agent-bridges`（permission `agent-bridges`）。
- 两条 capability 都允许 `main` + `main-live` 两个 window（live preview / release rebuild 都靠 `main-live`）。**不要**直接发到 child / preview / remote window，要扩 window 名先做安全 review。
- Plugin defaults 维护在 `src-tauri/capabilities/default.json`；Offisim 自家 command allowlist 维护在 `src-tauri/permissions/*.toml`。

## Plugin checklist (改前先核对)

`src-tauri/Cargo.toml` + `src-tauri/src/lib.rs` `.plugin(...)` + `capabilities/default.json` 三处必须同步，缺一个就是 runtime 静默 no-op：

- `tauri-plugin-single-instance` — **必须放在 `.plugin(...)` 链最前**；否则第二个 dev 实例会和已运行实例共用 SQLite，黑屏挂死
- `tauri-plugin-fs` — `fs:default` 仅作插件基线 + drag-drop 动态 scope（`lib.rs` `try_fs_scope().allow_file/allow_directory` 按拖入文件逐个放行）。**不要**再加 `fs:allow-app/temp-*-recursive`：webview 零 `@tauri-apps/plugin-fs` 使用，vault 写盘走 `runtime_vault_*` 自定义命令（`local_paths.rs`，std::fs），DB 走 `sql:`，附件走 `attachment_*`——全部绕过 plugin-fs capability，blanket 递归读写只是攻击面（S4，已于审计整改移除）
- `tauri-plugin-dialog` — `dialog:default` + `dialog:allow-open`（folder picker）
- `tauri-plugin-opener` — `opener:default` + `opener:allow-reveal-item-in-dir` + `opener:allow-open-path`（reveal in Finder）
- `tauri-plugin-sql` — `sql:default` + `sql:allow-{load,select,execute,close}`
- `cors-fetch` — `cors-fetch:default`
- `tauri-plugin-deep-link` — `deep-link:default`（`offisim://install`）

## Builtin tool sandbox

`src-tauri/src/builtin_tools.rs` 实现 `read_file` / `write_file` / `bash` / `project_read_file_preview` 等 builtin，仅注入已验证的 Offisim harness/gateway tool path（commits `3f618ce9` / `50c1e296`）。未验证 model transport 不暴露本机工具。硬上限不可绕：

- `MAX_PREVIEW_BYTES` = 64 KB（`project_read_file_preview`，UI 文件树唯一入口）
- `MAX_READ_BYTES` = 8 MB（`project_read_file`，agent tool lane）
- `MAX_WRITE_BYTES` = 8 MB
- `DEFAULT_MAX_OUTPUT_BYTES` = 1 MB（`bash` stdout/stderr 各自上限）

所有 path 必须 resolve 在 project `workspace_root` 内，越界拒绝。

Chat attachment IPC 归 `fs-shell` capability：`attachment_write` / `attachment_read` / `attachment_list` / `attachment_list_all` / `attachment_delete` 五个 command 必须同时出现在 `src-tauri/src/lib.rs` invoke handler、`permissions/fs-shell.toml` allowlist、以及 `scripts/check-attachment-capabilities.mjs` 的 build gate。`attachment_list_all` 只递归读 `.meta.json`，供桌面 GC 使用，禁止读取 `.bin`。

Project workspace file browsing from the webview must use the sandboxed Tauri commands `project_list_dir` / `project_read_file` / `project_read_file_preview` with a selected project `workspace_root`. Do not use `tauri-plugin-fs` directly for repo/project paths; plugin-fs is for app-owned/vault paths, not arbitrary workspace traversal.

Release/live validation is release `.app` only: rebuild `@offisim/desktop-renderer` and `@offisim/desktop`, launch the current worktree's exact `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app` path, then use Computer Use for window attach, interaction, screenshots, foregrounding, and closing. Do not use `open -b com.offisim.desktop` when multiple worktrees may share the bundle id, and do not use `osascript` / AppleScript as the desktop verification controller. Dev webview/browser results do not satisfy desktop runtime verification.

## Pi Agent Host

AI execution only goes through `src-tauri/src/pi_agent_host/` (mod/run/wire/payload/stream/bridge/provider/types) and the bundled
`resources/pi-agent-host.mjs` official Pi SDK host. Offisim passes the selected
project workspace as Pi `cwd`, forwards Pi JSONL events to the renderer, and
does not inject provider secrets, parse model catalogs, or run Claude/Codex
sidecars.

## Local SQLite

Offisim 已确认未上线，本地 SQLite 不保留历史升级合同。`packages/db-local/src/schema.sql` 是当前 baseline，`local_db.rs::ensure_schema` 只接受当前 `LOCAL_SCHEMA_VERSION`（真值以 `local_db.rs` 常量为准）或空库 bootstrap；旧本地库、无 stamp 库、其他版本库都是可丢弃开发产物，删除后重建。改 schema 时同步 `schema.sql` + `schema.ts`；不要新增迁移 SQL、兼容升级 helper 或 `MIGRATIONS` 注册。

## Release CSP / platform CORS coupling

Tauri release `.app` CSP `connect-src` 与 `apps/platform/src/startup.ts` `DEV_DEFAULT_ORIGINS` 是两条**独立但成对**的 allowlist：

- **Invariant A** — CSP `connect-src` ⊇ platform listen origins（`http://localhost:4100` / `https://localhost:4100` / `tauri://localhost`）
- **Invariant B** — platform CORS ⊇ `tauri://localhost`

任一侧漂移会被 `scripts/check-platform-tauri-origin-sync.mjs` 在 `apps/desktop` / `apps/platform` 的 `prebuild` 拦下（不变量：CSP `connect-src` SHALL ⊇ platform endpoint origins）。

## Rust 模块速查

| 文件 | 职责 |
|------|------|
| `lib.rs` | plugin 注册顺序 + command 注册（特权 command 必须挂 capability） |
| `builtin_tools.rs` | `read_file` / `write_file` / `bash` / 文件预览 sandbox |
| `pi_agent_host/` | official Pi SDK host bridge and JSONL event projection (split into focused modules, PR #20) |
| `local_db.rs` | SQLite bootstrap + connection pool |
| `local_paths.rs` | workspace_root resolution + 路径校验 helper |
| `mcp_bridge/` | desktop 专属 MCP bridge（web 没有） |
| `git.rs` | workspace-scoped `git_exec` command |
| `deep_link.rs` | `offisim://install` |
| `sidecar_stderr.rs` | sidecar 日志收集 |
